import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { type Actor, DomainError, ErrorSchema, OperationId } from "./contracts.ts";
import { newId } from "./crypto.ts";
import type { CommandMeta } from "./store.ts";

export type AccessLevel = "public" | "user" | "member" | "admin" | "publisher" | "moderator";
export interface Principal {
  userId: string;
  sessionId: string;
}
export interface IdentityPort {
  authenticate(request: Request): Promise<Principal>;
  authorize(principal: Principal, organizationId: string, level: AccessLevel): Promise<Actor>;
}
export interface ApiRequest<B = unknown, Q = unknown> {
  body: B;
  query: Q;
  params: Record<string, string>;
  actor: Actor;
  principal: Principal;
  operationId: string;
  correlationId: string;
  request: Request;
  context: Context;
  command(operation: string, request?: unknown): CommandMeta;
}
interface Endpoint<B, Q, R> {
  method: "get" | "post" | "put" | "delete" | "patch";
  path: string;
  summary: string;
  auth?: AccessLevel;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<Record<string, string>>;
  response: z.ZodType<R>;
  operationHeader?: string;
  verifyRaw?: (request: Request, bytes: Uint8Array) => Promise<void>;
  handler: (request: ApiRequest<B, Q>) => Promise<R> | R;
}

/** Every JSON route is registered once: validation and OpenAPI share its Zod schemas. */
export class ApiRouter {
  readonly app = new Hono<{ Variables: { correlationId: string } }>();
  readonly paths: Record<string, Record<string, unknown>> = {};
  constructor(private identity: IdentityPort) {
    this.app.use("*", secureHeaders());
    this.app.notFound(() => {
      throw new DomainError("not_found", "Resource unavailable", 404);
    });
    this.app.use(
      "*",
      bodyLimit({
        maxSize: 5 * 1024 * 1024,
        onError: () => {
          throw new DomainError(
            "payload_too_large",
            "Request exceeds the configured byte limit",
            413,
          );
        },
      }),
    );
    this.app.onError((error, context) => {
      const correlationId = context.get("correlationId") || newId();
      const known = error instanceof DomainError;
      const value = ErrorSchema.parse({
        code: known ? error.code : "internal_error",
        message: known ? error.message : "The operation could not be completed",
        correlationId,
        retry: known ? error.retry : "same_operation",
        ...(known && error.currentVersion !== undefined
          ? { currentVersion: error.currentVersion }
          : {}),
      });
      if (!known)
        process.stderr.write(
          `${JSON.stringify({ event: "request_failed", correlationId, error: error.name })}\n`,
        );
      return new Response(JSON.stringify(value), {
        status: known ? error.status : 500,
        headers: { "Content-Type": "application/json", "X-Correlation-Id": correlationId },
      });
    });
  }
  add<B = undefined, Q = undefined, R = unknown>(spec: Endpoint<B, Q, R>) {
    const auth = spec.auth ?? "member";
    const mutating = spec.method !== "get";
    const schema = (value: z.ZodType) =>
      z.toJSONSchema(value, { target: "openapi-3.0", unrepresentable: "throw", io: "input" });
    const path = `/api/v1${spec.path}`;
    const pathParams = [...spec.path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map(
      (match) => match[1],
    );
    const paramsSchema =
      spec.params ??
      z.strictObject(
        Object.fromEntries(
          pathParams.map((name) => [
            name,
            name === "id" || name.endsWith("Id") ? z.uuid() : z.string().min(1).max(160),
          ]),
        ),
      );
    const documentedParams = schema(paramsSchema).properties ?? {};
    const documentedPath = path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
    const parameters: unknown[] = pathParams.map((name) => ({
      name,
      in: "path",
      required: true,
      schema: documentedParams[name] ?? { type: "string" },
    }));
    if (auth !== "public" && auth !== "user")
      parameters.push({
        name: "X-Organization-Id",
        in: "header",
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    if (mutating)
      parameters.push({
        name: spec.operationHeader ?? "Idempotency-Key",
        in: "header",
        required: true,
        schema: schema(OperationId),
      });
    if (spec.query) {
      const querySchema = schema(spec.query);
      for (const [name, value] of Object.entries(querySchema.properties ?? {}))
        parameters.push({
          name,
          in: "query",
          required: querySchema.required?.includes(name) ?? false,
          schema: value,
        });
    }
    this.paths[documentedPath] ??= {};
    this.paths[documentedPath][spec.method] = {
      summary: spec.summary,
      operationId: `${spec.method}_${spec.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
      parameters,
      ...(auth === "public" ? {} : { security: [{ bearerAuth: [] }] }),
      ...(spec.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: schema(spec.body) } },
            },
          }
        : {}),
      responses: {
        "200": {
          description: "Durable operation outcome",
          content: { "application/json": { schema: schema(spec.response) } },
        },
        default: {
          description: "Explicit rejected, conflict, blocked or failed outcome",
          content: { "application/json": { schema: schema(ErrorSchema) } },
        },
      },
    };
    this.app.on(spec.method.toUpperCase(), path, async (context) => {
      const correlationId = newId();
      context.set("correlationId", correlationId);
      let principal: Principal | undefined;
      let actor: Actor | undefined;
      // Authenticate before parsing target identity or looking up a resource.
      if (auth !== "public") {
        principal = await this.identity.authenticate(context.req.raw);
        if (auth !== "user") {
          const organizationId = z
            .string()
            .uuid()
            .safeParse(context.req.header("X-Organization-Id"));
          if (!organizationId.success)
            throw new DomainError(
              "organization_required",
              "Select an authorized organization",
              403,
            );
          actor = await this.identity.authorize(principal, organizationId.data, auth);
        }
      }
      const authorityExpiresAt = new Date(Date.now() + 5000).toISOString();
      const operation = mutating
        ? OperationId.safeParse(context.req.header(spec.operationHeader ?? "Idempotency-Key"))
        : { success: true as const, data: correlationId };
      if (!operation.success)
        throw new DomainError(
          "operation_identity_required",
          "Send a stable Idempotency-Key for this command",
          400,
        );
      let body: B = undefined as B;
      if (spec.body) {
        let raw: unknown;
        if (spec.verifyRaw) {
          const bytes = new Uint8Array(await context.req.raw.arrayBuffer());
          await spec.verifyRaw(context.req.raw, bytes);
          try {
            raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          } catch {
            throw new DomainError("invalid_json", "The request must contain valid UTF-8 JSON", 400);
          }
        } else
          try {
            raw = await context.req.json();
          } catch {
            throw new DomainError("invalid_json", "The request must contain valid JSON", 400);
          }
        const result = spec.body.safeParse(raw);
        if (!result.success)
          throw new DomainError(
            "validation_error",
            result.error.issues
              .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
              .join("; ")
              .slice(0, 2000),
            400,
          );
        body = result.data;
      }
      let query: Q = undefined as Q;
      if (spec.query) {
        const result = spec.query.safeParse(context.req.query());
        if (!result.success)
          throw new DomainError("invalid_query", "The query parameters are invalid", 400);
        query = result.data;
      }
      const params = paramsSchema.safeParse(context.req.param());
      if (!params.success)
        throw new DomainError("invalid_path", "The path parameters are invalid", 400);
      const request: ApiRequest<B, Q> = {
        body,
        query,
        params: params.data,
        get actor() {
          if (!actor) throw new DomainError("unauthorized", "Organization access is required", 401);
          return actor;
        },
        get principal() {
          if (!principal) throw new DomainError("unauthorized", "Sign in to continue", 401);
          return principal;
        },
        operationId: operation.data,
        correlationId,
        request: context.req.raw,
        context,
        command: (operationName, payload = body) => ({
          organizationId: request.actor.organizationId,
          actorId: request.actor.userId,
          operation: operationName,
          operationId: operation.data,
          request: payload,
          correlationId,
          ...(auth !== "public" ? { authorityExpiresAt } : {}),
        }),
      };
      const output = spec.response.parse(await spec.handler(request));
      return context.json(output, 200, { "X-Correlation-Id": correlationId });
    });
  }
  document() {
    return {
      openapi: "3.0.3",
      info: { title: "Agents Assemble", version: "1.0.0" },
      paths: this.paths,
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    };
  }
}

export function envelope<T extends z.ZodType>(data: T) {
  return z
    .object({
      id: z.string().uuid(),
      organizationId: z.string().uuid(),
      kind: z.string(),
      version: z.number().int().positive(),
      data,
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .strict();
}
