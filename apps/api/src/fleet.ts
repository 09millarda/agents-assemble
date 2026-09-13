import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { SUPPORTED_RUNNER_CAPABILITIES } from "@aa/catalog/definition";
import { type Actor, DomainError } from "@aa/platform/contracts";
import type { ApiRequest, ApiRouter } from "@aa/platform/http";
import type { CommandMeta, ContextStore } from "@aa/platform/store";
import { z } from "zod";
import {
  artifactReadResponseSchema,
  artifactReadSchema,
  artifactRefSchema,
  artifactUploadSchema,
  capabilitySchema,
  checkpointRefSchema,
  enrollmentRequestSchema,
  enrollmentResponseSchema,
  launchAuthorizationRequestSchema,
  launchAuthorizationResponseSchema,
  PROTOCOL_VERSION,
  payloadDigest,
  type RunnerCommand,
  reconcileRequestSchema,
  reconcileResponseSchema,
  scopeSchema,
} from "../../../packages/runner/src/protocol.ts";
import { checkpointSchema } from "../../../packages/runner/src/workspace.ts";
import { RunnerCertificateAuthority, type RunnerPeer } from "./tls.ts";
export const recordedCheckpointSchema = z.union([
  z.strictObject({
    repositoryId: z.string(),
    repositoryUrl: z.url(),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    source: z.literal("registered-baseline"),
  }),
  checkpointSchema.extend({
    acceptedManifest: z.string(),
    writerCoverage: z.literal("incomplete"),
  }),
]);
export type RecordedCheckpoint = z.infer<typeof recordedCheckpointSchema> & { digest: string };

export type RunnerPrincipal = {
  organizationId: string;
  runnerId: string;
  journalId: string;
  credentialGeneration: number;
  authorityEpoch: number;
  decisionExpiresAt: string;
  requestDigest: string;
};
export interface FleetExecutionPort {
  artifactRead?(
    principal: RunnerPrincipal,
    request: z.infer<typeof artifactReadSchema>,
  ): Promise<z.infer<typeof artifactReadResponseSchema>>;
  authorizeLaunch?(
    principal: RunnerPrincipal,
    request: z.infer<typeof launchAuthorizationRequestSchema>,
  ): Promise<z.infer<typeof launchAuthorizationResponseSchema>>;
  reconcile(
    principal: RunnerPrincipal,
    request: z.infer<typeof reconcileRequestSchema>,
  ): Promise<{ commands: RunnerCommand[]; acceptedReceiptIds: string[] }>;
  revoked?(principal: {
    organizationId: string;
    runnerId: string;
    authorityEpoch: number;
    operationId: string;
  }): Promise<void>;
  artifact?(
    principal: RunnerPrincipal,
    request: z.infer<typeof artifactUploadSchema>,
  ): Promise<z.infer<typeof artifactRefSchema>>;
  checkpoint?(
    principal: RunnerPrincipal,
    request: {
      operationId: string;
      scope: z.infer<typeof scopeSchema>;
      checkpoint: z.infer<typeof checkpointSchema>;
    },
  ): Promise<z.infer<typeof checkpointRefSchema>>;
}
interface Enrollment {
  runnerId: string;
  name: string;
  expiresAt: string;
  used: boolean;
  rotation: boolean;
  authorityGeneration: number;
}
interface Runner {
  name: string;
  journalId: string;
  status: "active" | "revoked";
  credentialGeneration: number;
  authorityEpoch: number;
  lastSequence: number;
  lastSeenAt: string | null;
  capabilities: z.infer<typeof capabilitySchema> | null;
}
interface Credential {
  runnerId: string;
  generation: number;
  fingerprint256: string;
  expiresAt: string;
  active: boolean;
  publicKeyDigest: string;
}
const runnerDataSchema = z.strictObject({
  name: z.string(),
  journalId: z.string(),
  status: z.enum(["active", "revoked"]),
  credentialGeneration: z.int(),
  authorityEpoch: z.int(),
  lastSequence: z.int(),
  lastSeenAt: z.iso.datetime().nullable(),
  capabilities: capabilitySchema.nullable(),
});
const runnerViewSchema = z.strictObject({
  id: z.string(),
  version: z.int(),
  ...runnerDataSchema.shape,
});
export class Fleet {
  readonly authority: RunnerCertificateAuthority;
  private key: Buffer | undefined;
  constructor(
    readonly store: ContextStore,
    readonly config: {
      deploymentId: string;
      stateDirectory: string;
      hostname?: string;
      recheck?: (actor: Actor) => Promise<unknown>;
    },
    private execution: FleetExecutionPort = {
      reconcile: async () => ({ commands: [], acceptedReceiptIds: [] }),
    },
  ) {
    this.authority = new RunnerCertificateAuthority(config.stateDirectory);
  }
  async initialize(): Promise<void> {
    await this.authority.initialize(this.config.hostname);
    this.key = await this.authority.enrollmentKey();
  }
  async recordCheckpoint(meta: CommandMeta, data: z.infer<typeof recordedCheckpointSchema>) {
    const value = recordedCheckpointSchema.parse(data);
    return this.store.command({ ...meta, request: value }, (tx) =>
      tx.put<RecordedCheckpoint>("checkpoint", randomUUID(), {
        ...value,
        digest: payloadDigest(value),
      }),
    );
  }
  async getCheckpoint(organizationId: string, id: string) {
    return this.store.read(organizationId, (tx) =>
      tx.require<RecordedCheckpoint>("checkpoint", id),
    );
  }
  async eligibleRunners(organizationId: string) {
    return this.store.read(organizationId, async (tx) => {
      const now = await tx.now(),
        credentials = await tx.all<Credential>("credential"),
        runners = await tx.all<Runner>("runner");
      return runners
        .filter(
          (row) =>
            row.data.status === "active" &&
            row.data.lastSeenAt &&
            now.getTime() - Date.parse(row.data.lastSeenAt) < 30000 &&
            credentials.some(
              (credential) =>
                credential.data.runnerId === row.id &&
                credential.data.generation === row.data.credentialGeneration &&
                credential.data.active &&
                new Date(credential.data.expiresAt) > now,
            ),
        )
        .map((row) => ({
          id: row.id,
          journalId: row.data.journalId,
          nativeLoginReady: row.data.capabilities?.nativeLoginReady ?? false,
          codexVersion: row.data.capabilities?.codexVersion ?? "unavailable",
          credentialGeneration: row.data.credentialGeneration,
          capabilities:
            row.data.capabilities?.platform === "linux" &&
            row.data.capabilities.codexVersion === "0.153.4" &&
            row.data.capabilities.protocolVersion === "aa-runner/1"
              ? [...SUPPORTED_RUNNER_CAPABILITIES]
              : [],
        }));
    });
  }
  private token(organizationId: string, enrollmentId: string): string {
    if (!this.key) throw new Error("fleet_not_initialized");
    const body = Buffer.from(JSON.stringify({ organizationId, enrollmentId })).toString(
      "base64url",
    );
    return `${body}.${createHmac("sha256", this.key).update(body).digest("base64url")}`;
  }
  private verifyToken(token: string): { organizationId: string; enrollmentId: string } {
    if (!this.key) throw new Error("fleet_not_initialized");
    const [body, signature, ...extra] = token.split(".");
    const expected = createHmac("sha256", this.key)
      .update(body ?? "")
      .digest("base64url");
    if (
      extra.length ||
      !signature ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new DomainError("invalid_enrollment", "Enrollment authorization is invalid", 403);
    try {
      return z
        .strictObject({ organizationId: z.uuid(), enrollmentId: z.uuid() })
        .parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    } catch {
      throw new DomainError("invalid_enrollment", "Enrollment authorization is invalid", 403);
    }
  }
  private async principal(req: ApiRequest, requestDigest: string): Promise<RunnerPrincipal> {
    const peer = (req.context.env as { runnerPeer?: RunnerPeer } | undefined)?.runnerPeer;
    if (
      !peer?.authorized ||
      !z.uuid().safeParse(peer.organizationId).success ||
      !z.uuid().safeParse(peer.runnerId).success
    )
      throw new DomainError(
        "runner_mtls_required",
        "Connect with an enrolled runner certificate through the runner TLS listener",
        401,
      );
    return this.store.read(peer.organizationId, async (tx) => {
      const runner = await tx.require<Runner>("runner", peer.runnerId);
      const credential = (await tx.list<Credential>("credential")).find(
        (item) =>
          item.data.runnerId === peer.runnerId && item.data.fingerprint256 === peer.fingerprint256,
      );
      const now = await tx.now();
      if (
        runner.data.status !== "active" ||
        !credential?.data.active ||
        credential.data.generation !== runner.data.credentialGeneration ||
        Date.parse(credential.data.expiresAt) <= now.getTime()
      )
        throw new DomainError(
          "runner_authority_revoked",
          "Runner credentials expired or were revoked",
          403,
        );
      return {
        organizationId: peer.organizationId,
        runnerId: peer.runnerId,
        journalId: runner.data.journalId,
        credentialGeneration: credential.data.generation,
        authorityEpoch: runner.data.authorityEpoch,
        decisionExpiresAt: new Date(
          Math.min(now.getTime() + 5000, Date.parse(credential.data.expiresAt)),
        ).toISOString(),
        requestDigest,
      };
    });
  }
  register(router: ApiRouter): void {
    router.add({
      method: "post",
      path: "/runner/artifacts/read",
      summary:
        "Read only an exact immutable artifact reference authorized by the current action inputs",
      auth: "public",
      body: artifactReadSchema,
      response: artifactReadResponseSchema,
      handler: async (req) => {
        const principal = await this.principal(req, payloadDigest(req.body));
        if (
          req.body.scope.runnerId !== principal.runnerId ||
          req.body.scope.organizationId !== principal.organizationId ||
          req.body.scope.journalId !== principal.journalId ||
          req.body.scope.deploymentId !== this.config.deploymentId
        )
          throw new DomainError(
            "runner_scope_mismatch",
            "Artifact read scope does not match authenticated runner authority",
            403,
          );
        if (!this.execution.artifactRead)
          throw new DomainError(
            "artifact_read_unavailable",
            "Artifact read authority is not configured",
            503,
          );
        return this.execution.artifactRead(principal, req.body);
      },
    });
    router.add({
      method: "post",
      path: "/runner/authorize-launch",
      summary:
        "Revalidate the existing exact bounded assignment immediately before a protected native launch",
      auth: "public",
      body: launchAuthorizationRequestSchema,
      response: launchAuthorizationResponseSchema,
      handler: async (req) => {
        const principal = await this.principal(req, payloadDigest(req.body));
        if (
          req.body.scope.runnerId !== principal.runnerId ||
          req.body.scope.organizationId !== principal.organizationId ||
          req.body.scope.journalId !== principal.journalId ||
          req.body.scope.deploymentId !== this.config.deploymentId
        )
          throw new DomainError(
            "runner_scope_mismatch",
            "The exact launch scope does not match authenticated runner authority",
            403,
          );
        if (!this.execution.authorizeLaunch)
          throw new DomainError(
            "launch_authority_unavailable",
            "The protected launch authority port is unavailable",
            503,
          );
        return this.execution.authorizeLaunch(principal, req.body);
      },
    });
    router.add({
      method: "post",
      path: "/runner/artifacts",
      summary: "Persist bounded invocation-authorized artifact bytes without copying credentials",
      auth: "public",
      body: artifactUploadSchema,
      response: artifactRefSchema,
      handler: async (req) => {
        const principal = await this.principal(req, payloadDigest(req.body));
        if (
          req.body.scope.runnerId !== principal.runnerId ||
          req.body.scope.organizationId !== principal.organizationId ||
          req.body.scope.journalId !== principal.journalId
        )
          throw new DomainError(
            "runner_scope_mismatch",
            "Artifact scope does not match runner authority",
            403,
          );
        if (!this.execution.artifact)
          throw new DomainError(
            "artifact_port_unavailable",
            "Artifact storage is not configured for this assignment",
            503,
          );
        return this.execution.artifact(principal, req.body);
      },
    });
    router.add({
      method: "post",
      path: "/runner/checkpoints",
      summary: "Register an exact verified Git checkpoint for the admitted invocation",
      auth: "public",
      body: z.strictObject({
        version: z.literal(PROTOCOL_VERSION),
        operationId: z.string(),
        scope: scopeSchema,
        checkpoint: checkpointSchema,
      }),
      response: checkpointRefSchema,
      handler: async (req) => {
        const principal = await this.principal(req, payloadDigest(req.body));
        if (
          req.body.scope.runnerId !== principal.runnerId ||
          req.body.scope.organizationId !== principal.organizationId ||
          req.body.scope.journalId !== principal.journalId
        )
          throw new DomainError(
            "runner_scope_mismatch",
            "Checkpoint scope does not match runner authority",
            403,
          );
        if (!this.execution.checkpoint)
          throw new DomainError(
            "checkpoint_port_unavailable",
            "Checkpoint storage is not configured for this assignment",
            503,
          );
        return this.execution.checkpoint(principal, req.body);
      },
    });
    router.add({
      method: "post",
      path: "/fleet/enrollments",
      summary: "Authorize one runner enrollment or credential rotation",
      auth: "admin",
      body: z.strictObject({
        name: z.string().min(1).max(100),
        runnerId: z.uuid().optional(),
        ttlSeconds: z.int().min(60).max(3600).default(600),
      }),
      response: z.strictObject({
        enrollmentId: z.uuid(),
        runnerId: z.uuid(),
        enrollmentToken: z.string(),
        expiresAt: z.iso.datetime(),
      }),
      handler: async (req) => {
        await this.config.recheck?.(req.actor);
        const record = await this.store.command(req.command("authorize-enrollment"), async (tx) => {
          if (req.body.runnerId) await tx.require("runner", req.body.runnerId);
          const enrollmentId = randomUUID(),
            runnerId = req.body.runnerId ?? randomUUID(),
            expiresAt = new Date(
              (await tx.now()).getTime() + req.body.ttlSeconds * 1000,
            ).toISOString();
          await tx.put("enrollment", enrollmentId, {
            runnerId,
            name: req.body.name,
            expiresAt,
            used: false,
            rotation: !!req.body.runnerId,
            authorityGeneration: req.actor.authorityGeneration,
          } satisfies Enrollment);
          return { enrollmentId, runnerId, expiresAt };
        });
        return {
          ...record,
          enrollmentToken: this.token(req.actor.organizationId, record.enrollmentId),
        };
      },
    });
    router.add({
      method: "post",
      path: "/fleet/enroll",
      summary: "Consume an exact enrollment authorization after local key proof of possession",
      auth: "public",
      body: enrollmentRequestSchema,
      response: enrollmentResponseSchema,
      handler: async (req) => {
        const token = this.verifyToken(req.body.enrollmentToken);
        if (req.operationId !== req.body.operationId)
          throw new DomainError(
            "operation_identity_mismatch",
            "Header and enrollment operation must match",
            409,
          );
        const { enrollmentToken: _, ...enrollmentRequest } = req.body;
        return this.store.command(
          {
            organizationId: token.organizationId,
            actorId: "runner-enrollment",
            operation: "enroll",
            operationId: req.body.operationId,
            request: { ...enrollmentRequest, tokenIdentity: token.enrollmentId },
          },
          async (tx) => {
            const enrollment = await tx.require<Enrollment>("enrollment", token.enrollmentId);
            if (
              enrollment.data.used ||
              Date.parse(enrollment.data.expiresAt) <= (await tx.now()).getTime()
            )
              throw new DomainError(
                "enrollment_expired",
                "Enrollment authorization is expired or consumed",
                403,
              );
            const old = await tx.get<Runner>("runner", enrollment.data.runnerId);
            if (old && old.data.journalId !== req.body.journalId)
              throw new DomainError(
                "journal_incarnation_changed",
                "Enroll a new runner after journal loss; previous writer obligations remain unresolved",
                409,
              );
            let issued: Awaited<ReturnType<RunnerCertificateAuthority["sign"]>>;
            try {
              issued = await this.authority.sign(
                req.body.csrPem,
                enrollment.data.runnerId,
                token.organizationId,
              );
            } catch {
              throw new DomainError(
                "invalid_key_proof",
                "The certificate request must prove possession of the local private key",
                400,
              );
            }
            const generation = (old?.data.credentialGeneration ?? 0) + 1;
            for (const credential of await tx.list<Credential>("credential"))
              if (credential.data.runnerId === enrollment.data.runnerId && credential.data.active)
                await tx.put(
                  "credential",
                  credential.id,
                  { ...credential.data, active: false },
                  credential.version,
                );
            await tx.put("credential", randomUUID(), {
              runnerId: enrollment.data.runnerId,
              generation,
              fingerprint256: issued.fingerprint256,
              expiresAt: issued.expiresAt,
              active: true,
              publicKeyDigest: issued.publicKeyDigest,
            } satisfies Credential);
            const saved = await tx.put(
              "runner",
              enrollment.data.runnerId,
              {
                name: enrollment.data.name,
                journalId: req.body.journalId,
                status: "active",
                credentialGeneration: generation,
                authorityEpoch: (old?.data.authorityEpoch ?? 0) + 1,
                lastSequence: old?.data.lastSequence ?? 0,
                lastSeenAt: old?.data.lastSeenAt ?? null,
                capabilities: old?.data.capabilities ?? null,
              } satisfies Runner,
              old?.version ?? 0,
            );
            await tx.put(
              "enrollment",
              enrollment.id,
              { ...enrollment.data, used: true },
              enrollment.version,
            );
            await tx.emit("fleet.credential_changed", saved, {
              runnerId: saved.id,
              generation,
              authorityEpoch: saved.data.authorityEpoch,
            });
            return {
              version: PROTOCOL_VERSION,
              runnerId: saved.id,
              organizationId: token.organizationId,
              deploymentId: this.config.deploymentId,
              credentialGeneration: generation,
              certificatePem: issued.certificatePem,
              caPem: await this.authority.caPem(),
              expiresAt: issued.expiresAt,
            };
          },
        );
      },
    });
    router.add({
      method: "get",
      path: "/runners",
      summary: "Inspect enrolled runners, credentials, capability and connectivity",
      response: z.strictObject({ items: z.array(runnerViewSchema) }),
      handler: async (req) =>
        this.store.read(req.actor.organizationId, async (tx) => ({
          items: (await tx.list<Runner>("runner")).map((item) => ({
            id: item.id,
            version: item.version,
            ...item.data,
          })),
        })),
    });
    router.add({
      method: "post",
      path: "/runners/:id/revoke",
      summary: "Revoke future runner authority while retaining history and writer obligations",
      auth: "admin",
      body: z.strictObject({
        expectedVersion: z.int().positive(),
        reason: z.string().min(1).max(1000),
      }),
      response: z.strictObject({
        status: z.literal("revocation_pending"),
        authorityEpoch: z.int(),
        writerCoverage: z.literal("incomplete"),
      }),
      handler: async (req) => {
        await this.config.recheck?.(req.actor);
        const result = await this.store.command(
          req.command("revoke-runner", { runnerId: req.params.id, ...req.body }),
          async (tx) => {
            const runner = await tx.require<Runner>("runner", req.params.id);
            const data = {
              ...runner.data,
              status: "revoked" as const,
              authorityEpoch: runner.data.authorityEpoch + 1,
            };
            const saved = await tx.put("runner", runner.id, data, req.body.expectedVersion);
            await tx.emit("fleet.revoked", saved, {
              runnerId: runner.id,
              authorityEpoch: data.authorityEpoch,
              reason: req.body.reason,
            });
            return {
              status: "revocation_pending" as const,
              authorityEpoch: data.authorityEpoch,
              writerCoverage: "incomplete" as const,
            };
          },
        );
        await this.execution.revoked?.({
          organizationId: req.actor.organizationId,
          runnerId: req.params.id,
          authorityEpoch: result.authorityEpoch,
          operationId: req.operationId,
        });
        return result;
      },
    });
    router.add({
      method: "post",
      path: "/runner/reconcile",
      summary:
        "Reconcile durable daemon receipts through verified mTLS and bounded current authority",
      auth: "public",
      body: reconcileRequestSchema,
      response: reconcileResponseSchema,
      handler: async (req) => {
        const principal = await this.principal(req, payloadDigest(req.body));
        if (principal.runnerId !== req.body.runnerId || principal.journalId !== req.body.journalId)
          throw new DomainError(
            "runner_scope_mismatch",
            "The enrolled runner and journal must match the authenticated certificate",
            403,
          );
        await this.store.command(
          {
            organizationId: principal.organizationId,
            actorId: principal.runnerId,
            operation: "runner-heartbeat",
            operationId: req.operationId,
            request: req.body,
          },
          async (tx) => {
            const runner = await tx.require<Runner>("runner", principal.runnerId);
            if (
              runner.data.status !== "active" ||
              runner.data.authorityEpoch !== principal.authorityEpoch
            )
              throw new DomainError(
                "runner_authority_changed",
                "Runner authority changed before receipt acceptance",
                403,
              );
            if (req.body.sequence < runner.data.lastSequence)
              throw new DomainError(
                "journal_sequence_regressed",
                "Local journal continuity is uncertain; retain previous writer obligations",
                409,
              );
            await tx.put(
              "runner",
              runner.id,
              {
                ...runner.data,
                lastSequence: req.body.sequence,
                lastSeenAt: (await tx.now()).toISOString(),
                capabilities: req.body.capabilities,
              },
              runner.version,
            );
            return { recorded: true };
          },
        );
        const authority = await this.principal(req, payloadDigest(req.body));
        const result = await this.execution.reconcile(authority, req.body);
        return {
          version: PROTOCOL_VERSION,
          serverTime: new Date().toISOString(),
          revoked: false,
          commands: result.commands,
          acceptedReceiptIds: result.acceptedReceiptIds,
        };
      },
    });
    router.add({
      method: "post",
      path: "/runner/de-enroll",
      summary: "Retire this runner without deleting unresolved historical work",
      auth: "public",
      body: z.strictObject({
        version: z.literal(PROTOCOL_VERSION),
        runnerId: z.string(),
        journalId: z.string(),
        operationId: z.string(),
      }),
      response: z.strictObject({ status: z.literal("revocation_pending") }),
      handler: async (req) => {
        const principal = await this.principal(req, payloadDigest(req.body));
        if (principal.runnerId !== req.body.runnerId || principal.journalId !== req.body.journalId)
          throw new DomainError(
            "runner_scope_mismatch",
            "Runner identity does not match the authenticated certificate",
            403,
          );
        return this.store.command(
          {
            organizationId: principal.organizationId,
            actorId: principal.runnerId,
            operation: "runner-de-enroll",
            operationId: req.body.operationId,
            request: req.body,
          },
          async (tx) => {
            const runner = await tx.require<Runner>("runner", principal.runnerId);
            const saved = await tx.put(
              "runner",
              runner.id,
              { ...runner.data, status: "revoked", authorityEpoch: runner.data.authorityEpoch + 1 },
              runner.version,
            );
            await tx.emit("fleet.revoked", saved, {
              runnerId: runner.id,
              authorityEpoch: saved.data.authorityEpoch,
              reason: "operator_de_enrollment",
            });
            return { status: "revocation_pending" as const };
          },
        );
      },
    });
  }
}
