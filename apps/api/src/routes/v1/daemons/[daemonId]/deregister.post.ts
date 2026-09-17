import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { deregisterDaemon } from "../../../../features/daemon-connection/application/commands/deregisterDaemon";
import type { DaemonDisconnectionPort, DaemonRegistryPort } from "../../../../features/daemon-connection/domain/DaemonConnectionPort";
import {
  PROBLEM_MEDIA_TYPE,
  ProblemDetailSchema,
  buildProblemDetail,
} from "../../../../infrastructure/http/problemDetails";
import {
  DeregisterDaemonParamsSchema,
  DeregisterDaemonResponseSchema,
} from "../../../../features/daemon-connection/adapters/inbound/dto/daemonDto";

const deregisterDaemonRoute = createRoute({
  method: "post",
  path: "/v1/daemons/{daemonId}/deregister",
  request: { params: DeregisterDaemonParamsSchema },
  responses: {
    200: {
      content: { "application/json": { schema: DeregisterDaemonResponseSchema } },
      description: "Daemon deregistered; row retained with deregistered status.",
    },
    404: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Unknown daemon id.",
    },
    410: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Daemon already deregistered.",
    },
    422: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "Invalid daemon id.",
    },
  },
});

function deregisterProblemStatus(code: string): 404 | 410 | 422 {
  if (code === "DAEMON_NOT_FOUND") return 404;
  if (code === "DAEMON_ALREADY_DEREGISTERED") return 410;
  return 422;
}

function problemResponse(context: Context, status: 404 | 410 | 422, code: string, detail: string) {
  return context.json(
    buildProblemDetail({ status, code, detail, instance: context.req.path }),
    status,
    { "content-type": PROBLEM_MEDIA_TYPE },
  );
}

export function registerDeregisterDaemonRoute(
  app: OpenAPIHono,
  dependencies: {
    registry: DaemonRegistryPort;
    disconnection: DaemonDisconnectionPort;
  },
): void {
  app.openapi(deregisterDaemonRoute, async (context) => {
    const { daemonId } = context.req.valid("param");
    const result = await deregisterDaemon(
      dependencies.registry,
      dependencies.disconnection,
      daemonId,
    );
    if (result.ok) return context.json({ daemonId: result.value.daemonId, status: "deregistered" as const }, 200);
    const status = deregisterProblemStatus(result.error.code);
    return problemResponse(context, status, result.error.code, result.error.message);
  });
}
