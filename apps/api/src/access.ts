import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { type Actor, DomainError, Role } from "@aa/platform/contracts";
import { digest, newId } from "@aa/platform/crypto";
import type { AccessLevel, ApiRouter, IdentityPort, Principal } from "@aa/platform/http";
import type { ContextStore } from "@aa/platform/store";
import { z } from "zod";
import type { ExternalIdentityPort } from "./workos.ts";

export const SYSTEM_ORGANIZATION = "00000000-0000-4000-8000-000000000000";
const emailSchema = z
  .string()
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());
interface User {
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
}
interface Membership {
  userId: string;
  organizationId: string;
  role: Actor["role"];
  active: boolean;
  authorityGeneration: number;
}
interface Session {
  userId: string;
  expiresAt: string;
  external?: { subject: string; sessionId: string };
}
const publicUserSchema = z
  .object({ id: z.string().uuid(), email: z.string().email(), name: z.string() })
  .strict();
const orgSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    role: Role,
    authorityGeneration: z.number().int(),
  })
  .strict();
const passwordHash = (password: string, salt: string) =>
  scryptSync(password, salt, 64).toString("hex");
export class LocalAccess implements IdentityPort {
  constructor(
    readonly store: ContextStore,
    private sessionKey: string,
    private external?: ExternalIdentityPort,
  ) {
    if (sessionKey.length < 32)
      throw new Error("A session signing key of at least 32 characters is required");
  }
  private publicationPolicyId?: string;
  async configurePublicationPolicy(deploymentId: string, invitedOrganizations: string[]) {
    const invited = z.array(z.uuid()).max(10000).parse(invitedOrganizations),
      hash = digest({ deploymentId, kind: "publication-invitations" });
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const policy = { invitedOrganizations: [...new Set(invited)].sort() };
    await this.store.command(
      {
        organizationId: SYSTEM_ORGANIZATION,
        actorId: "installation-operator",
        operation: "configure-publication-invitations",
        operationId: newId(),
        request: { deploymentId, ...policy },
      },
      async (tx) => {
        const prior = await tx.get<typeof policy>("publication-policy", id);
        if (prior && digest(prior.data) === digest(policy)) return prior;
        const updated = await tx.put("publication-policy", id, policy, prior?.version ?? 0);
        await tx.emit("access.publication_policy_changed", updated, {
          policyId: id,
          generation: updated.version,
        });
        return updated;
      },
    );
    this.publicationPolicyId = id;
  }
  async publicationInvited(actor: Actor) {
    await this.recheck(actor, "publisher");
    if (!this.publicationPolicyId) return false;
    const id = this.publicationPolicyId;
    return this.store.read(SYSTEM_ORGANIZATION, async (tx) =>
      (
        await tx.require<{ invitedOrganizations: string[] }>("publication-policy", id)
      ).data.invitedOrganizations.includes(actor.organizationId),
    );
  }
  private sign(sessionId: string) {
    return `${sessionId}.${createHmac("sha256", this.sessionKey).update(sessionId).digest("base64url")}`;
  }
  async bootstrap(input: {
    email: string;
    name: string;
    password: string;
    organizationName: string;
  }) {
    const email = emailSchema.parse(input.email);
    z.string().min(12).max(1024).parse(input.password);
    return this.store.command(
      {
        organizationId: SYSTEM_ORGANIZATION,
        actorId: "bootstrap",
        operation: "bootstrap",
        operationId: email,
        request: input,
      },
      async (tx) => {
        const users = await tx.all<User>("user");
        if (users.some((user) => user.data.email === email))
          throw new DomainError("account_exists", "This email is already registered");
        const userId = newId(),
          organizationId = newId(),
          salt = randomBytes(16).toString("hex");
        await tx.put("user", userId, {
          email,
          name: input.name,
          passwordHash: passwordHash(input.password, salt),
          salt,
        });
        await tx.put("organization", organizationId, { name: input.organizationName });
        await tx.put("membership", newId(), {
          userId,
          organizationId,
          role: "admin",
          active: true,
          authorityGeneration: 1,
        } satisfies Membership);
        return { userId, organizationId };
      },
    );
  }
  async authenticate(request: Request): Promise<Principal> {
    const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    const sessionId = token?.split(".")[0];
    if (!sessionId || !z.string().uuid().safeParse(sessionId).success || !token)
      throw new DomainError("unauthorized", "Sign in to continue", 401);
    const signature = this.sign(sessionId);
    if (
      Buffer.byteLength(signature) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(token))
    )
      throw new DomainError("unauthorized", "Sign in to continue", 401);
    const local = await this.store.read(SYSTEM_ORGANIZATION, async (tx) => {
      const session = await tx.get<Session>("session", sessionId);
      if (!session || new Date(session.data.expiresAt) <= (await tx.now()))
        throw new DomainError("unauthorized", "Your session expired; sign in again", 401);
      return { userId: session.data.userId, sessionId, external: session.data.external };
    });
    if (
      local.external &&
      (!this.external ||
        !(await this.external.active(local.external.subject, local.external.sessionId)))
    )
      throw new DomainError("unauthorized", "Provider session is no longer active", 401);
    return { userId: local.userId, sessionId };
  }
  async authorize(
    principal: Principal,
    organizationId: string,
    level: AccessLevel,
  ): Promise<Actor> {
    return this.store.read(SYSTEM_ORGANIZATION, async (tx) => {
      const membership = (await tx.all<Membership>("membership")).find(
        (row) =>
          row.data.userId === principal.userId &&
          row.data.organizationId === organizationId &&
          row.data.active,
      );
      if (
        !membership ||
        (level !== "member" &&
          level !== "user" &&
          membership.data.role !== "admin" &&
          membership.data.role !== level)
      )
        throw new DomainError(
          "forbidden",
          "This operation is unavailable with your current access",
          403,
        );
      return {
        userId: principal.userId,
        organizationId,
        role: membership.data.role,
        authorityGeneration: membership.data.authorityGeneration,
      };
    });
  }
  async recheck(actor: Actor, level: AccessLevel = "member") {
    const current = await this.authorize(
      { userId: actor.userId, sessionId: "operation" },
      actor.organizationId,
      level,
    );
    if (current.authorityGeneration !== actor.authorityGeneration)
      throw new DomainError("authority_changed", "Access changed; refresh before continuing", 403);
    return current;
  }
  async organizations() {
    return this.store.read(SYSTEM_ORGANIZATION, (tx) => tx.all<{ name: string }>("organization"));
  }
  async isMember(userId: string, organizationId: string) {
    return this.store.read(
      SYSTEM_ORGANIZATION,
      async (tx) =>
        (await tx.all<Membership>("membership", { userId, organizationId, active: true })).length >
        0,
    );
  }
  private registerExternal(router: ApiRouter, external: ExternalIdentityPort) {
    const resultSchema = z.strictObject({ token: z.string(), expiresAt: z.iso.datetime() });
    type Flow = {
      verifier: string;
      expiresAt: string;
      status: "pending" | "exchanging" | "completed";
      codeDigest?: string;
      sessionId?: string;
      sessionExpiresAt?: string;
    };
    router.add({
      method: "post",
      path: "/auth/workos/start",
      summary: "Start browser-bound PKCE authentication",
      auth: "public",
      body: z.strictObject({}),
      response: z.strictObject({ authorizationUrl: z.url(), state: z.uuid(), proof: z.string() }),
      handler: async (req) => {
        const flow = await this.store.command(
          {
            organizationId: SYSTEM_ORGANIZATION,
            actorId: "login",
            operation: "external-start",
            operationId: req.operationId,
            request: {},
          },
          async (tx) =>
            tx.put<Flow>("identity-flow", newId(), {
              verifier: randomBytes(32).toString("base64url"),
              expiresAt: new Date((await tx.now()).getTime() + 600000).toISOString(),
              status: "pending",
            }),
        );
        return {
          authorizationUrl: external.authorization(flow.id, flow.data.verifier),
          state: flow.id,
          proof: this.sign(flow.id),
        };
      },
    });
    router.add({
      method: "post",
      path: "/auth/workos/complete",
      summary: "Exchange one exact browser-bound code for an application session",
      auth: "public",
      body: z.strictObject({
        state: z.uuid(),
        proof: z.string().max(200),
        code: z.string().min(1).max(2048),
      }),
      response: resultSchema,
      handler: async (req) => {
        const expected = this.sign(req.body.state);
        if (
          Buffer.byteLength(expected) !== Buffer.byteLength(req.body.proof) ||
          !timingSafeEqual(Buffer.from(expected), Buffer.from(req.body.proof))
        )
          throw new DomainError(
            "invalid_login_state",
            "Return to the browser that started sign-in",
            403,
          );
        const codeDigest = digest(req.body.code),
          flow = await this.store.command(
            {
              organizationId: SYSTEM_ORGANIZATION,
              actorId: "login",
              operation: "external-claim",
              operationId: newId(),
              request: { state: req.body.state, codeDigest },
            },
            async (tx) => {
              const row = await tx.require<Flow>("identity-flow", req.body.state);
              if (row.data.status === "completed" && row.data.codeDigest === codeDigest) return row;
              if (row.data.status !== "pending" || new Date(row.data.expiresAt) <= (await tx.now()))
                throw new DomainError(
                  "login_restart_required",
                  "Sign-in is expired or its outcome is uncertain; start a new sign-in",
                  409,
                );
              return tx.put<Flow>(
                "identity-flow",
                row.id,
                { ...row.data, status: "exchanging", codeDigest },
                row.version,
              );
            },
          );
        if (flow.data.status === "completed" && flow.data.sessionId && flow.data.sessionExpiresAt)
          return { token: this.sign(flow.data.sessionId), expiresAt: flow.data.sessionExpiresAt };
        const identity = await external.exchange(req.body.code, flow.data.verifier);
        const session = await this.store.command(
          {
            organizationId: SYSTEM_ORGANIZATION,
            actorId: identity.subject,
            operation: "external-session",
            operationId: req.body.state,
            request: { state: req.body.state, codeDigest },
          },
          async (tx) => {
            const linked = (
              await tx.all<{ subject: string; userId: string }>("external-identity", {
                subject: identity.subject,
              })
            )[0];
            const existing = linked
              ? await tx.require<User>("user", linked.data.userId)
              : (await tx.all<User>("user", { email: identity.email }))[0];
            if (!existing)
              throw new DomainError(
                "invitation_required",
                "An administrator must create your account or invitation before sign-in",
                403,
              );
            if (!linked)
              await tx.put("external-identity", newId(), {
                subject: identity.subject,
                userId: existing.id,
              });
            const sessionId = newId(),
              expiresAt = identity.expiresAt;
            await tx.put<Session>("session", sessionId, {
              userId: existing.id,
              expiresAt,
              external: { subject: identity.subject, sessionId: identity.sessionId },
            });
            const latest = await tx.require<Flow>("identity-flow", flow.id);
            await tx.put<Flow>(
              "identity-flow",
              flow.id,
              { ...latest.data, status: "completed", sessionId, sessionExpiresAt: expiresAt },
              latest.version,
            );
            return { sessionId, expiresAt };
          },
        );
        return { token: this.sign(session.sessionId), expiresAt: session.expiresAt };
      },
    });
  }
  register(router: ApiRouter) {
    router.add({
      method: "get",
      path: "/auth/providers",
      summary: "Read configured sign-in adapter",
      auth: "public",
      response: z.strictObject({ adapter: z.enum(["local", "workos"]) }),
      handler: () => ({ adapter: this.external ? "workos" : "local" }),
    });
    if (this.external) this.registerExternal(router, this.external);
    router.add({
      method: "post",
      path: "/auth/login",
      summary: "Sign in using the local identity adapter",
      auth: "public",
      body: z
        .object({ email: z.string().email().max(254), password: z.string().min(1).max(1024) })
        .strict(),
      response: z.object({ token: z.string(), expiresAt: z.string().datetime() }).strict(),
      handler: async (req) => {
        if (this.external)
          throw new DomainError(
            "external_sign_in_required",
            "Use the configured identity provider to sign in",
            403,
          );
        const result = await this.store.command(
          {
            organizationId: SYSTEM_ORGANIZATION,
            actorId: "login",
            operation: "login",
            operationId: req.operationId,
            request: req.body,
          },
          async (tx) => {
            const user = (await tx.all<User>("user")).find(
              (row) => row.data.email === req.body.email.toLowerCase(),
            );
            const computed = passwordHash(
              req.body.password,
              user?.data.salt ?? "unknown-account-padding",
            );
            if (
              !user ||
              !timingSafeEqual(
                Buffer.from(computed, "hex"),
                Buffer.from(user.data.passwordHash, "hex"),
              )
            )
              throw new DomainError("invalid_credentials", "Email or password is incorrect", 401);
            const sessionId = newId(),
              expiresAt = new Date((await tx.now()).getTime() + 8 * 60 * 60 * 1000).toISOString();
            await tx.put("session", sessionId, { userId: user.id, expiresAt });
            return { sessionId, expiresAt };
          },
        );
        return { token: this.sign(result.sessionId), expiresAt: result.expiresAt };
      },
    });
    router.add({
      method: "get",
      path: "/auth/session",
      summary: "Inspect signed-in identity and authorized organizations",
      auth: "user",
      response: z.object({ user: publicUserSchema, organizations: z.array(orgSchema) }).strict(),
      handler: async (req) =>
        this.store.read(SYSTEM_ORGANIZATION, async (tx) => {
          const user = await tx.require<User>("user", req.principal.userId);
          const memberships = (await tx.all<Membership>("membership")).filter(
            (row) => row.data.userId === user.id && row.data.active,
          );
          const organizations = await Promise.all(
            memberships.map(async (membership) => ({
              id: membership.data.organizationId,
              name: (
                await tx.require<{ name: string }>("organization", membership.data.organizationId)
              ).data.name,
              role: membership.data.role,
              authorityGeneration: membership.data.authorityGeneration,
            })),
          );
          return {
            user: { id: user.id, email: user.data.email, name: user.data.name },
            organizations,
          };
        }),
    });
    router.add({
      method: "post",
      path: "/auth/logout",
      summary: "Expire the current session",
      auth: "user",
      body: z.object({}).strict(),
      response: z.object({ status: z.literal("signed_out") }).strict(),
      handler: async (req) =>
        this.store.command(
          {
            organizationId: SYSTEM_ORGANIZATION,
            actorId: req.principal.userId,
            operation: "logout",
            operationId: req.operationId,
            request: { sessionId: req.principal.sessionId },
          },
          async (tx) => {
            const session = await tx.require<Session>("session", req.principal.sessionId);
            await tx.put(
              "session",
              session.id,
              { ...session.data, expiresAt: (await tx.now()).toISOString() },
              session.version,
            );
            return { status: "signed_out" as const };
          },
        ),
    });
    router.add({
      method: "get",
      path: "/members",
      summary: "List current organization membership",
      auth: "admin",
      response: z
        .object({
          items: z.array(
            z
              .object({
                id: z.string().uuid(),
                userId: z.string().uuid(),
                email: z.string(),
                name: z.string(),
                role: Role,
                active: z.boolean(),
                version: z.number().int(),
                authorityGeneration: z.number().int(),
              })
              .strict(),
          ),
        })
        .strict(),
      handler: async (req) =>
        this.store.read(SYSTEM_ORGANIZATION, async (tx) => {
          const memberships = (await tx.all<Membership>("membership")).filter(
            (row) => row.data.organizationId === req.actor.organizationId,
          );
          return {
            items: await Promise.all(
              memberships.map(async (membership) => {
                const user = await tx.require<User>("user", membership.data.userId);
                return {
                  id: membership.id,
                  userId: user.id,
                  email: user.data.email,
                  name: user.data.name,
                  role: membership.data.role,
                  active: membership.data.active,
                  version: membership.version,
                  authorityGeneration: membership.data.authorityGeneration,
                };
              }),
            ),
          };
        }),
    });
    router.add({
      method: "post",
      path: "/members/:id/revoke",
      summary: "Revoke organization membership with a new authority generation",
      auth: "admin",
      body: z
        .object({
          expectedVersion: z.number().int().positive(),
          reason: z.string().min(1).max(1000),
        })
        .strict(),
      response: z
        .object({ status: z.literal("revoked"), authorityGeneration: z.number().int() })
        .strict(),
      handler: async (req) =>
        this.store.command(
          {
            ...req.command("revoke-member", { id: req.params.id, ...req.body }),
            organizationId: SYSTEM_ORGANIZATION,
          },
          async (tx) => {
            const target = await tx.require<Membership>("membership", req.params.id);
            if (target.data.organizationId !== req.actor.organizationId)
              throw new DomainError("not_found", "Member unavailable", 404);
            if (
              target.data.role === "admin" &&
              (await tx.all<Membership>("membership")).filter(
                (row) =>
                  row.data.organizationId === req.actor.organizationId &&
                  row.data.active &&
                  row.data.role === "admin",
              ).length <= 1
            )
              throw new DomainError(
                "last_admin",
                "Invite another administrator before revoking the final administrator",
              );
            const data = {
              ...target.data,
              active: false,
              authorityGeneration: target.data.authorityGeneration + 1,
            };
            const saved = await tx.put("membership", target.id, data, req.body.expectedVersion);
            await tx.emit("access.revoked", saved, {
              organizationId: req.actor.organizationId,
              userId: target.data.userId,
              generation: data.authorityGeneration,
              reason: req.body.reason,
            });
            return { status: "revoked" as const, authorityGeneration: data.authorityGeneration };
          },
        ),
    });
    router.add({
      method: "post",
      path: "/invitations",
      summary: "Create an invitation for an organization member",
      auth: "admin",
      body: z.object({ email: z.string().email(), role: Role }).strict(),
      response: z
        .object({ id: z.string().uuid(), token: z.string(), expiresAt: z.string().datetime() })
        .strict(),
      handler: async (req) => {
        const result = await this.store.command(
          { ...req.command("invite"), organizationId: SYSTEM_ORGANIZATION },
          async (tx) => {
            const id = newId(),
              expiresAt = new Date((await tx.now()).getTime() + 7 * 86400_000).toISOString();
            await tx.put("invitation", id, {
              email: req.body.email.toLowerCase(),
              role: req.body.role,
              organizationId: req.actor.organizationId,
              expiresAt,
              used: false,
            });
            return { id, expiresAt };
          },
        );
        return { ...result, token: this.sign(result.id) };
      },
    });
    router.add({
      method: "post",
      path: "/auth/accept-invitation",
      summary: "Accept an exact invitation and establish local identity",
      auth: "public",
      body: z
        .object({
          token: z.string().max(1024),
          name: z.string().min(1).max(100),
          password: z.string().min(12).max(1024),
        })
        .strict(),
      response: z.object({ organizationId: z.string().uuid(), userId: z.string().uuid() }).strict(),
      handler: async (req) => {
        const id = req.body.token.split(".")[0];
        if (!z.string().uuid().safeParse(id).success || req.body.token !== this.sign(id))
          throw new DomainError("invalid_invitation", "Invitation is invalid", 403);
        return this.store.command(
          {
            organizationId: SYSTEM_ORGANIZATION,
            actorId: "invitee",
            operation: "accept-invitation",
            operationId: req.operationId,
            request: req.body,
          },
          async (tx) => {
            const invite = await tx.require<{
              email: string;
              role: Actor["role"];
              organizationId: string;
              expiresAt: string;
              used: boolean;
            }>("invitation", id);
            if (invite.data.used || new Date(invite.data.expiresAt) <= (await tx.now()))
              throw new DomainError(
                "expired_invitation",
                "Invitation has expired or was already used",
                403,
              );
            const existing = (await tx.all<User>("user", { email: invite.data.email }))[0];
            if (
              existing &&
              !timingSafeEqual(
                Buffer.from(passwordHash(req.body.password, existing.data.salt), "hex"),
                Buffer.from(existing.data.passwordHash, "hex"),
              )
            )
              throw new DomainError(
                "invalid_credentials",
                "Use the existing account password to accept this invitation",
                401,
              );
            const userId = existing?.id ?? newId(),
              salt = randomBytes(16).toString("hex");
            if (!existing)
              await tx.put("user", userId, {
                email: invite.data.email,
                name: req.body.name,
                salt,
                passwordHash: passwordHash(req.body.password, salt),
              });
            const membership = (
              await tx.all<Membership>("membership", {
                userId,
                organizationId: invite.data.organizationId,
              })
            )[0];
            await tx.put(
              "membership",
              membership?.id ?? newId(),
              {
                userId,
                organizationId: invite.data.organizationId,
                role: invite.data.role,
                active: true,
                authorityGeneration: (membership?.data.authorityGeneration ?? 0) + 1,
              },
              membership?.version ?? 0,
            );
            await tx.put("invitation", id, { ...invite.data, used: true }, invite.version);
            return { userId, organizationId: invite.data.organizationId };
          },
        );
      },
    });
  }
}
