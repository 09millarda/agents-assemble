import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { type JsonSchema, validateValue } from "../../catalog/src/definition.ts";
import { resolveEnvironment } from "./environment.ts";
import { RunnerJournal } from "./journal.ts";
import {
  CodexNative,
  doctor,
  type NativeEvent,
  NativeRejected,
  nativeEnvironment,
  redactOutput,
} from "./native.ts";
import {
  artifactReadResponseSchema,
  artifactRefSchema,
  artifactUploadSchema,
  canonicalJson,
  checkpointRefSchema,
  launchAuthorizationResponseSchema,
  nativeQuestionSchema,
  PROTOCOL_VERSION,
  type RunnerCommand,
  reconcileResponseSchema,
  type StartCommand,
} from "./protocol.ts";
import { lowPrivilegeCommand, nativeSource, ProtectedSupervisor } from "./supervisor.ts";
import { type RunnerConfig, RunnerTransport } from "./transport.ts";
import { createCheckpoint, prepareWorkspace } from "./workspace.ts";

type LiveAttempt = {
  native: CodexNative;
  command: StartCommand;
  threadId: string;
  turnId: string;
  continuationClosed: boolean;
  inputSequence: number;
};
const exec = promisify(execFile);
export class RunnerDaemon {
  readonly journal: RunnerJournal;
  private transport: RunnerTransport;
  private supervisor: ProtectedSupervisor | undefined;
  private supervisorVerified = false;
  private live = new Map<string, LiveAttempt>();
  private tasks = new Map<string, Promise<void>>();
  private stopped = false;
  private revoked = false;
  private connectedAt = 0;
  private serverAt = 0;
  private capabilities: Awaited<ReturnType<typeof doctor>> | undefined;
  constructor(
    readonly directory: string,
    readonly config: RunnerConfig,
  ) {
    this.supervisor = config.supervisor ? new ProtectedSupervisor(config.supervisor) : undefined;
    this.journal = new RunnerJournal(join(directory, "journal"), config.journalId);
    this.journal.recoverUncertain();
    this.transport = new RunnerTransport(config.serviceUrl, config);
  }
  private authorized(command: RunnerCommand): boolean {
    return (
      !this.revoked &&
      performance.now() - this.connectedAt < 10000 &&
      this.serverAt + (performance.now() - this.connectedAt) < Date.parse(command.expiresAt) &&
      command.scope.runnerId === this.config.runnerId &&
      command.scope.journalId === this.config.journalId &&
      command.scope.organizationId === this.config.organizationId &&
      command.scope.deploymentId === this.config.deploymentId
    );
  }
  async tick(): Promise<void> {
    if (this.supervisor && !this.supervisorVerified) {
      await this.supervisor.verify(this.directory);
      this.supervisorVerified = true;
      await this.recoverProtectedScopes();
    }
    this.capabilities ??= await doctor(
      this.config.codexBinary,
      this.config.supervisor
        ? {
            sourceEnvironment: nativeSource(this.config.supervisor),
            launcher: lowPrivilegeCommand(
              this.config.codexBinary,
              ["app-server", "--stdio"],
              this.config.supervisor,
            ),
            versionLauncher: lowPrivilegeCommand(
              this.config.codexBinary,
              ["--version"],
              this.config.supervisor,
            ),
          }
        : {},
    );
    const started = performance.now();
    const response = reconcileResponseSchema.parse(
      await this.transport.post("/api/v1/runner/reconcile", {
        version: PROTOCOL_VERSION,
        runnerId: this.config.runnerId,
        journalId: this.journal.journalId,
        sequence: this.journal.sequence,
        capabilities: this.capabilities,
        receipts: this.journal.pendingReceipts(),
      }),
    );
    this.connectedAt = performance.now();
    this.serverAt = Date.parse(response.serverTime) + (this.connectedAt - started);
    this.revoked = response.revoked;
    this.journal.acknowledge(response.acceptedReceiptIds);
    if (response.revoked) {
      await this.interruptLive("runner_revoked");
      return;
    }
    for (const command of [...response.commands].sort(
      (a, b) => Number(b.kind === "interrupt") - Number(a.kind === "interrupt"),
    )) {
      if (this.tasks.has(command.commandId)) continue;
      try {
        const received = this.journal.receive(command);
        if (received.fresh) this.journal.receipt(command, "received");
        if (received.state.stage !== "received") continue;
        if (!this.authorized(command)) {
          this.reject(command, "expired_or_mismatched_authority");
          continue;
        }
        const task = this.dispatch(command)
          .catch(() => {
            this.journal.stage(command.commandId, "outcome_unknown", {
              reason: "unexpected_runner_failure",
            });
            this.journal.receipt(command, "outcome_unknown", {
              reason: "unexpected_runner_failure",
              writerCoverage: "incomplete",
            });
          })
          .finally(() => this.tasks.delete(command.commandId));
        this.tasks.set(command.commandId, task);
      } catch {
        /* Conflict leaves the accepted bytes and prior verdict intact. */
      }
    }
  }
  private reject(command: RunnerCommand, reason: string): void {
    this.journal.stage(command.commandId, "rejected", { reason });
    this.journal.receipt(command, "rejected", { reason });
  }
  private async authorizeLaunch(command: RunnerCommand): Promise<void> {
    if (!this.authorized(command)) throw new Error("launch_authority_expired");
    const started = performance.now();
    const decision = launchAuthorizationResponseSchema.parse(
      await this.transport.post("/api/v1/runner/authorize-launch", {
        version: PROTOCOL_VERSION,
        commandId: command.commandId,
        scope: command.scope,
        payloadDigest: command.payloadDigest,
      }),
    );
    const lifetime = Date.parse(decision.expiresAt) - Date.parse(decision.serverTime);
    if (
      decision.commandId !== command.commandId ||
      decision.payloadDigest !== command.payloadDigest ||
      canonicalJson(decision.scope) !== canonicalJson(command.scope) ||
      lifetime <= performance.now() - started ||
      lifetime > 5000 ||
      Date.parse(decision.expiresAt) > Date.parse(command.expiresAt) ||
      !this.authorized(command)
    )
      throw new Error("launch_authority_invalid");
  }
  private async dispatch(command: RunnerCommand): Promise<void> {
    if (["start", "prepare", "check"].includes(command.kind)) {
      try {
        await this.authorizeLaunch(command);
      } catch {
        this.reject(command, "launch_authority_unavailable");
        return;
      }
    }
    if (command.kind === "start") {
      await this.start(command);
      return;
    }
    if (command.kind === "prepare" || command.kind === "check") {
      await this.deterministic(command);
      return;
    }
    const live = this.live.get(command.scope.invocationId);
    if (
      !live ||
      canonicalJson(live.command.scope) !== canonicalJson(command.scope) ||
      live.threadId !== command.payload.threadId ||
      live.turnId !== command.payload.turnId
    ) {
      this.reject(command, "native_target_unavailable");
      return;
    }
    if (
      (command.kind === "steer" || command.kind === "answer") &&
      (live.continuationClosed ||
        (command.kind === "steer" && command.payload.sequence !== live.inputSequence + 1))
    ) {
      this.reject(command, "input_order_or_continuation_blocked");
      return;
    }
    if (command.kind === "interrupt") live.continuationClosed = true;
    if (!this.authorized(command)) {
      this.reject(command, "dispatch_authority_expired");
      return;
    }
    this.journal.stage(command.commandId, "sending");
    try {
      if (command.kind === "steer") {
        await live.native.steer(
          live.threadId,
          live.turnId,
          command.payload.inputId,
          `[${command.payload.actorId}] ${command.payload.text}`,
        );
        live.inputSequence = command.payload.sequence;
      } else if (command.kind === "answer") {
        await live.native.answer(
          command.payload,
          Math.max(
            1,
            Math.min(
              30000,
              Date.parse(command.expiresAt) -
                (this.serverAt + performance.now() - this.connectedAt),
            ),
          ),
        );
      } else {
        await live.native.interrupt(live.threadId, live.turnId);
      }
      this.journal.stage(command.commandId, "delivered");
      this.journal.receipt(command, "delivered", {
        threadId: live.threadId,
        turnId: live.turnId,
        meaning:
          command.kind === "interrupt" ? "native_interrupt_acknowledged" : "native_input_accepted",
        writerCoverage: "incomplete",
        ...(command.kind === "answer"
          ? {
              questionId: command.payload.questionId,
              requestId: command.payload.requestId,
              itemId: command.payload.itemId,
            }
          : {}),
      });
    } catch (error) {
      // Only the pinned -32600 exact-target rejection establishes that this call was rejected before delivery.
      if (error instanceof NativeRejected && error.code === -32600)
        this.reject(command, "native_exact_target_rejected");
      else {
        live.continuationClosed = true;
        this.journal.stage(command.commandId, "outcome_unknown");
        this.journal.receipt(command, "outcome_unknown", { reason: "native_delivery_uncertain" });
      }
    }
  }
  private async deterministic(
    command: Extract<RunnerCommand, { kind: "prepare" | "check" }>,
  ): Promise<void> {
    this.journal.stage(command.commandId, "launch_intent");
    try {
      if (
        command.payload.repository.commit !== command.payload.checkpoint.commit ||
        command.payload.repository.repositoryId !== command.payload.checkpoint.repositoryId
      )
        throw new Error("checkpoint_scope_mismatch");
      const resolved = await resolveEnvironment(command, this.config.secretFile),
        root = this.config.supervisor?.workRoot ?? join(this.directory, "workspaces");
      await mkdir(root, { recursive: true, mode: 0o700 });
      await this.authorizeLaunch(command);
      const workspace = await prepareWorkspace(root, command, this.config.supervisor);
      await this.authorizeLaunch(command);
      let output: unknown = { checkpoint: command.payload.checkpoint };
      if (command.kind === "check") {
        if (!command.payload.commands?.length || !command.payload.spec)
          throw new Error("checks_policy_missing");
        let passed = true;
        const evidence: unknown[] = [];
        for (const argv of command.payload.commands) {
          await this.authorizeLaunch(command);
          let result: { stdout: string; stderr: string; exitCode: number };
          try {
            const launch = lowPrivilegeCommand(argv[0], argv.slice(1), this.config.supervisor);
            const completed = await exec(launch.command, launch.args, {
              cwd: workspace.directory,
              env: nativeEnvironment(resolved.environment, nativeSource(this.config.supervisor)),
              timeout: Math.min(
                command.payload.timeoutSeconds * 1000,
                Math.max(
                  1,
                  Date.parse(command.expiresAt) -
                    this.serverAt -
                    performance.now() +
                    this.connectedAt,
                ),
              ),
              maxBuffer: 262144,
            });
            result = { ...completed, exitCode: 0 };
          } catch (error) {
            const failure = error as Error & {
              code?: unknown;
              stdout?: string;
              stderr?: string;
              killed?: boolean;
            };
            if (failure.killed || typeof failure.code !== "number")
              throw new Error("check_outcome_unknown");
            result = {
              stdout: failure.stdout ?? "",
              stderr: failure.stderr ?? "",
              exitCode: failure.code,
            };
            passed = false;
          }
          evidence.push({
            argv,
            exitCode: result.exitCode,
            stdout: redactOutput(result.stdout, resolved.values, 32768),
            stderr: redactOutput(result.stderr, resolved.values, 32768),
          });
        }
        const artifact = artifactRefSchema.parse(
          await this.transport.post("/api/v1/runner/artifacts", {
            version: PROTOCOL_VERSION,
            operationId: `${command.commandId}.checks`,
            scope: command.scope,
            mediaType: "application/json",
            content: JSON.stringify({
              checkpoint: command.payload.checkpoint,
              spec: command.payload.spec,
              commands: evidence,
            }),
          }),
        );
        output = {
          passed,
          spec: command.payload.spec,
          checkpoint: command.payload.checkpoint,
          evidence: artifact,
        };
      }
      this.journal.stage(command.commandId, "completed", { output });
      this.journal.receipt(command, "completed", {
        output,
        environmentReceipt: resolved.receipt,
        writerCoverage: "incomplete",
        automaticTakeover: false,
      });
    } catch {
      this.journal.stage(command.commandId, "outcome_unknown");
      this.journal.receipt(command, "outcome_unknown", {
        reason: "deterministic_execution_or_artifact_outcome_uncertain",
        writerCoverage: "incomplete",
      });
    }
  }
  private async start(command: StartCommand): Promise<void> {
    if (!this.capabilities?.nativeLoginReady) {
      this.reject(command, "reauthentication_required");
      return;
    }
    this.journal.stage(command.commandId, "launch_intent");
    let native: CodexNative | undefined;
    try {
      const resolved = await resolveEnvironment(command, this.config.secretFile);
      const workspaceRoot = this.config.supervisor?.workRoot ?? join(this.directory, "workspaces");
      await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
      await this.authorizeLaunch(command);
      const workspace = await prepareWorkspace(workspaceRoot, command, this.config.supervisor);
      await this.authorizeLaunch(command);
      let outputBytes = 0;
      let outputSequence = 0;
      let overflow = false;
      let finalText = "";
      const earlyQuestions: NativeEvent[] = [];
      let complete: (value: unknown) => void = () => {};
      let failed: (error: Error) => void = () => {};
      const completion = new Promise<unknown>((resolve, reject) => {
        complete = resolve;
        failed = reject;
      });
      // A loss may arrive during native initialization, before the terminal wait is installed.
      void completion.catch(() => {});
      const onEvent = (event: NativeEvent) => {
        if (event.method === "native/connectionLost") {
          failed(new Error("native_connection_lost"));
          return;
        }
        const target = this.live.get(command.scope.invocationId);
        const captures = [
          "native/question",
          "turn/completed",
          "item/agentMessage/delta",
          "item/commandExecution/outputDelta",
          "item/completed",
        ];
        if (captures.includes(event.method) && !target) {
          earlyQuestions.push(event);
          return;
        }
        if (target && captures.includes(event.method)) {
          const identity = z
            .object({
              threadId: z.string(),
              turnId: z.string().optional(),
              turn: z.object({ id: z.string() }).passthrough().optional(),
            })
            .passthrough()
            .safeParse(event.params);
          if (
            !identity.success ||
            identity.data.threadId !== target.threadId ||
            (identity.data.turnId ?? identity.data.turn?.id) !== target.turnId
          )
            return;
        }
        if (event.method === "turn/completed") {
          complete(event.params);
          return;
        }
        if (event.method === "native/question") {
          if (!this.live.has(command.scope.invocationId)) {
            earlyQuestions.push(event);
            return;
          }
          const raw = JSON.stringify(event.params),
            safe = redactOutput(raw, resolved.values, 131072);
          if (safe.text !== raw || safe.truncated) {
            failed(new Error("question_contains_secret"));
            return;
          }
          const params = z.object({ autoResolutionMs: z.number().nullable() }).parse(event.params);
          const expiresAt = new Date(
            Math.min(
              Date.parse(command.expiresAt),
              this.serverAt +
                performance.now() -
                this.connectedAt +
                Math.min(params.autoResolutionMs ?? 300000, 300000),
            ),
          ).toISOString();
          const question = nativeQuestionSchema.parse({
            ...z.record(z.string(), z.unknown()).parse(event.params),
            expiresAt,
          });
          this.journal.receipt(command, "question", question);
          return;
        }
        if (
          ![
            "item/agentMessage/delta",
            "item/commandExecution/outputDelta",
            "item/completed",
          ].includes(event.method) ||
          overflow
        )
          return;
        const params = z
          .object({
            threadId: z.string().optional(),
            turnId: z.string().optional(),
            itemId: z.string().optional(),
            delta: z.string().optional(),
            item: z
              .object({
                id: z.string(),
                type: z.string(),
                text: z.string().optional(),
                status: z.string().optional(),
                exitCode: z.number().nullable().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .safeParse(event.params);
        if (!params.success) return;
        if (
          params.data.item &&
          !["agentMessage", "commandExecution"].includes(params.data.item.type)
        )
          return;
        if (params.data.item?.type === "agentMessage" && event.method === "item/completed")
          finalText = params.data.item.text ?? "";
        const raw = params.data.delta ?? params.data.item?.text ?? "";
        const safe = redactOutput(raw, resolved.values);
        outputBytes += Buffer.byteLength(safe.text);
        if (outputBytes > 1024 * 1024) {
          overflow = true;
          this.journal.receipt(command, "gap", {
            reason: "capture_overflow",
            throughSequence: outputSequence,
            limitBytes: 1024 * 1024,
          });
          const attempt = this.live.get(command.scope.invocationId);
          if (attempt) {
            attempt.continuationClosed = true;
            void attempt.native.interrupt(attempt.threadId, attempt.turnId).catch(() => {});
          }
          return;
        }
        this.journal.receipt(command, "output", {
          captureSequence: ++outputSequence,
          kind: event.method,
          itemId: params.data.itemId ?? params.data.item?.id ?? "unknown",
          text: safe.text,
          truncated: safe.truncated,
          snapshot: event.method === "item/completed",
        });
      };
      const launcher = this.supervisor ? await this.supervisor.prepare(command) : undefined;
      await this.authorizeLaunch(command);
      native = new CodexNative({
        launcher,
        sourceEnvironment: nativeSource(this.config.supervisor),
        binary: this.config.codexBinary,
        cwd: workspace.directory,
        environment: resolved.environment,
        onEvent,
        onToolCall: async (call) => {
          if (!this.authorized(command)) throw new Error("artifact_authority_expired");
          const target = this.live.get(command.scope.invocationId);
          if (!target || call.threadId !== target.threadId || call.turnId !== target.turnId)
            throw new Error("artifact_native_target_mismatch");
          if (call.tool === "aa_read_artifact") {
            const args = z.strictObject({ reference: artifactRefSchema }).parse(call.arguments);
            return artifactReadResponseSchema.parse(
              await this.transport.post("/api/v1/runner/artifacts/read", {
                version: PROTOCOL_VERSION,
                operationId: call.callId,
                scope: command.scope,
                reference: args.reference,
              }),
            );
          }
          if (call.tool === "aa_create_artifact") {
            const args = z
              .strictObject({
                mediaType: z.enum(["text/markdown", "text/plain", "application/json"]),
                content: z.string().max(262144),
              })
              .parse(call.arguments);
            const safe = redactOutput(args.content, resolved.values, 262144);
            if (safe.truncated || safe.text !== args.content)
              throw new Error("artifact_contains_secret");
            return artifactRefSchema.parse(
              await this.transport.post(
                "/api/v1/runner/artifacts",
                artifactUploadSchema.parse({
                  version: PROTOCOL_VERSION,
                  operationId: call.callId,
                  scope: command.scope,
                  ...args,
                }),
              ),
            );
          }
          if (call.tool === "aa_checkpoint") {
            z.strictObject({}).parse(call.arguments);
            const checkpoint = await createCheckpoint(
              workspace,
              command,
              resolved.values,
              call.callId,
            );
            return checkpointRefSchema.parse(
              await this.transport.post("/api/v1/runner/checkpoints", {
                version: PROTOCOL_VERSION,
                operationId: call.callId,
                scope: command.scope,
                checkpoint,
              }),
            );
          }
          throw new Error("unsupported_native_tool");
        },
      });
      await native.initialize();
      const started = await native.start(command, workspace.directory, () =>
        this.authorizeLaunch(command),
      );
      const live = { native, command, ...started, continuationClosed: false, inputSequence: 0 };
      this.live.set(command.scope.invocationId, live);
      this.journal.stage(command.commandId, "running", started);
      this.journal.receipt(command, "running", {
        ...started,
        environmentReceipt: resolved.receipt,
        workspace: workspace.directory,
      });
      for (const question of earlyQuestions) onEvent(question);
      const remaining = Math.max(
        0,
        Date.parse(command.expiresAt) - (this.serverAt + performance.now() - this.connectedAt),
      );
      let timer: NodeJS.Timeout | undefined;
      const terminal = await Promise.race([
        completion,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("grant_expired")), remaining);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      const result = z
        .object({
          threadId: z.string(),
          turn: z
            .object({
              id: z.string(),
              status: z.enum(["completed", "failed", "interrupted", "inProgress"]),
            })
            .passthrough(),
        })
        .passthrough()
        .parse(terminal);
      if (result.threadId !== started.threadId || result.turn.id !== started.turnId)
        throw new Error("native_terminal_target_mismatch");
      if (result.turn.status !== "completed") {
        const status = result.turn.status === "interrupted" ? "interrupted" : "failed";
        this.journal.stage(command.commandId, status);
        this.journal.receipt(command, status, {
          threadId: started.threadId,
          turnId: started.turnId,
          writerCoverage: "incomplete",
          recovery: "manual_reconciliation_required",
        });
        return;
      }
      const checkpoint = await createCheckpoint(workspace, command, resolved.values);
      const checkpointRef = checkpointRefSchema.parse(
        await this.transport.post("/api/v1/runner/checkpoints", {
          version: PROTOCOL_VERSION,
          operationId: `${command.commandId}.final-checkpoint`,
          scope: command.scope,
          checkpoint,
        }),
      );
      let output: unknown = { checkpoint: checkpointRef };
      if (command.payload.outputSchema) {
        if (redactOutput(finalText, resolved.values, 262144).text !== finalText)
          throw new Error("structured_result_contains_secret");
        output = validateValue(JSON.parse(finalText), command.payload.outputSchema as JsonSchema);
      }
      this.journal.stage(command.commandId, "completed", { checkpoint, output });
      this.journal.receipt(command, "completed", {
        checkpoint,
        output,
        runtime: started,
        environmentReceipt: resolved.receipt,
        writerCoverage: "incomplete",
        automaticTakeover: false,
      });
    } catch (error) {
      const reason =
        error instanceof Error && /^[a-z_]+(?::[A-Z_]+)?$/.test(error.message)
          ? error.message
          : "native_or_checkpoint_outcome_uncertain";
      this.journal.stage(command.commandId, "outcome_unknown", { reason });
      this.journal.receipt(command, "outcome_unknown", {
        reason,
        writerCoverage: "incomplete",
        recovery: "manual_reconciliation_required",
      });
    } finally {
      native?.close();
      if (this.supervisor) await this.recordProtectedStop(command);
      this.live.delete(command.scope.invocationId);
    }
  }
  private async recordProtectedStop(command: StartCommand): Promise<void> {
    if (!this.supervisor) return;
    try {
      const receipt = await this.supervisor.stopAndReport(command);
      this.journal.receipt(command, "observation", {
        protectedObservation: receipt,
        writerCoverage: "incomplete",
        automaticTakeover: false,
      });
    } catch {
      this.journal.receipt(command, "observation", {
        reason: "scope_unknown",
        writerCoverage: "incomplete",
        automaticTakeover: false,
      });
    }
  }
  private async recoverProtectedScopes(): Promise<void> {
    for (const state of this.journal.states())
      if (
        state.command.kind === "start" &&
        state.stage !== "received" &&
        state.stage !== "rejected"
      )
        await this.recordProtectedStop(state.command);
  }
  private async interruptLive(reason: string): Promise<void> {
    for (const live of this.live.values()) {
      if (live.continuationClosed) continue;
      live.continuationClosed = true;
      this.journal.receipt(live.command, "outcome_unknown", {
        reason,
        writerCoverage: "incomplete",
      });
      await live.native.interrupt(live.threadId, live.turnId).catch(() => {});
      if (this.supervisor) await this.recordProtectedStop(live.command);
    }
  }
  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.tick();
      } catch {
        await this.interruptLive("service_disconnected");
      }
      if (!this.stopped)
        await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
    }
    await this.interruptLive("daemon_stopping");
    for (const live of this.live.values()) live.native.close();
  }
  stop(): void {
    this.stopped = true;
  }
  async drain(): Promise<void> {
    await Promise.all(this.tasks.values());
  }
  close(): void {
    this.journal.close();
  }
}
