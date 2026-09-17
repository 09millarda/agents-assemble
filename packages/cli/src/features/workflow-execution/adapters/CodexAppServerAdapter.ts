import { WorkflowExecutionError } from "../domain/WorkflowExecutionError";
import type {
  CompletionContract,
  HarnessCapability,
  WorkflowDaemonCommand,
  WorkspaceResult,
} from "@factory/workflow";
import type {
  HarnessEvent,
  HarnessExecutionPort,
  HarnessResult,
} from "../domain/HarnessExecutionPort";
import {
  StdioAppServerTransport,
  type AppServerTransport,
} from "./StdioAppServerTransport";
import { runLocalProcess } from "./runLocalProcess";

export const SUPPORTED_CODEX_VERSION = "0.154.0";
interface LiveSession {
  transport: AppServerTransport;
  sessionId: string;
  command: WorkflowDaemonCommand;
  emit: (event: HarnessEvent) => Promise<void>;
  turnId: string;
  finalMessage: string;
  resolve: (result: HarnessResult) => void;
  reject: (error: Error) => void;
  events: Promise<void>;
  pending?: {
    id: string | number;
    method: string;
    params: Record<string, unknown>;
    interactionId: string;
  };
}
type ModelEntry = {
  model: string;
  supportedReasoningEfforts: { reasoningEffort: string }[];
};

export class CodexAppServerAdapter implements HarnessExecutionPort {
  private capability?: HarnessCapability;
  private readonly sessions = new Map<string, LiveSession>();
  constructor(
    private readonly createTransport: () => AppServerTransport = () =>
      new StdioAppServerTransport(),
    private readonly readVersion: () => Promise<string> = () =>
      runLocalProcess("codex", ["--version"]),
  ) {}
  private async initialize(): Promise<AppServerTransport> {
    const version = await this.readVersion();
    if (version.trim() !== `codex-cli ${SUPPORTED_CODEX_VERSION}`)
      throw new Error(
        `Unsupported Codex CLI: ${version}. Install ${SUPPORTED_CODEX_VERSION}.`,
      );
    const transport = this.createTransport();
    try {
      await transport.request("initialize", {
        clientInfo: {
          name: "factory-daemon",
          title: "Factory Daemon",
          version: "0.0.0",
        },
        capabilities: { experimentalApi: true },
      });
      transport.notify("initialized");
      return transport;
    } catch (error) {
      transport.close();
      throw error;
    }
  }
  async discover(): Promise<HarnessCapability> {
    const transport = await this.initialize();
    const models: HarnessCapability["models"] = [];
    try {
      let cursor: string | undefined;
      do {
        const page = await transport.request("model/list", {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        for (const entry of page.data as ModelEntry[])
          models.push({
            model: entry.model,
            efforts: entry.supportedReasoningEfforts.map(
              (effort) => effort.reasoningEffort,
            ),
          });
        cursor =
          typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      } while (cursor);
    } finally {
      transport.close();
    }
    this.capability = {
      harness: "codex",
      version: SUPPORTED_CODEX_VERSION,
      models,
      questions: true,
      permissions: true,
      structuredOutput: true,
    };
    return this.capability;
  }
  async execute(
    command: WorkflowDaemonCommand,
    workspace: WorkspaceResult,
    inputsPath: string,
    emit: (event: HarnessEvent) => Promise<void>,
  ): Promise<HarnessResult> {
    if (
      command.interaction?.permissionRequest &&
      !this.sessions.get(command.executionId)?.pending &&
      !command.recoveryAuthorized
    ) {
      throw new WorkflowExecutionError(
        "HARNESS_INTERACTION_INTERRUPTED",
        "Native harness interaction was interrupted by daemon restart. Inspect preserved work, then explicitly retry or cancel.",
        workspace,
      );
    }
    const settings = command.activity.execution;
    const capability = this.capability ?? (await this.discover());
    if (
      !capability.models.some(
        (entry) =>
          entry.model === settings.model &&
          entry.efforts.includes(settings.effort),
      )
    )
      throw new Error(
        `Unsupported Codex model/effort: ${settings.model}/${settings.effort}.`,
      );
    const existing = this.sessions.get(command.executionId);
    if (existing?.pending)
      return this.answerPendingRequest(existing, command, emit);
    const transport = await this.initialize();
    try {
      const started = await transport.request(
        command.sessionId ? "thread/resume" : "thread/start",
        {
          ...(command.sessionId ? { threadId: command.sessionId } : {}),
          model: settings.model,
          cwd: workspace.worktreePath,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          config: { model_reasoning_effort: settings.effort },
          ...(command.sessionId ? {} : { allowProviderModelFallback: false }),
        },
      );
      if (typeof started.model === "string" && started.model !== settings.model)
        throw new Error(
          `Codex resolved unexpected model ${started.model}; requested ${settings.model}.`,
        );
      const sessionId = (started.thread as { id: string }).id;
      await emit({
        type: "progress",
        message: `Codex conversation started (${settings.model}, ${settings.effort}).`,
        sessionId,
      });
      const session: LiveSession = {
        transport,
        sessionId,
        command,
        emit,
        turnId: "",
        finalMessage: "",
        resolve: () => {},
        reject: () => {},
        events: Promise.resolve(),
      };
      this.sessions.set(command.executionId, session);
      transport.onMessage = (message) => {
        session.events = session.events
          .then(() => this.handleMessage(session, message))
          .catch((error: unknown) =>
            session.reject(
              error instanceof Error ? error : new Error(String(error)),
            ),
          );
      };
      const completion = this.awaitResult(session);
      const turn = await transport.request("turn/start", {
        threadId: sessionId,
        cwd: workspace.worktreePath,
        model: settings.model,
        effort: settings.effort,
        input: [
          {
            type: "text",
            text:
              command.interaction?.answer ?? this.prompt(command),
            text_elements: [],
          },
        ],
        outputSchema: this.outputSchema(command),
      });
      session.turnId = (turn.turn as { id: string }).id;
      return await completion;
    } catch (error) {
      transport.close();
      this.sessions.delete(command.executionId);
      throw error;
    }
  }
  private awaitResult(session: LiveSession): Promise<HarnessResult> {
    return new Promise((resolve, reject) => {
      session.resolve = resolve;
      session.reject = reject;
    });
  }
  private finishSession(session: LiveSession, result: HarnessResult): void {
    session.resolve(result);
    if (!session.pending) {
      this.sessions.delete(session.command.executionId);
      session.transport.close();
    }
  }
  private async handleMessage(
    session: LiveSession,
    message: Record<string, unknown>,
  ): Promise<void> {
    const params = (message.params ?? {}) as Record<string, unknown>;
    if (message.method === "turn/started") {
      session.turnId = (params.turn as { id: string }).id;
      await session.emit({
        type: "progress",
        message: "Codex turn started.",
        sessionId: session.sessionId,
        harnessTurnId: session.turnId,
      });
    }
    if (
      (typeof message.id === "number" || typeof message.id === "string") &&
      typeof message.method === "string"
    ) {
      const isQuestion = message.method === "item/tool/requestUserInput";
      const isPermission = [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/permissions/requestApproval",
      ].includes(message.method);
      if (!isQuestion && !isPermission) {
        session.transport.respond(message.id, { decision: "decline" });
        throw new Error(`Unsupported Codex server request: ${message.method}`);
      }
      if (isQuestion && session.command.activity.humanInput === "off") {
        await this.cancel(session.command.executionId);
        throw new Error("Activity prohibits human input.");
      }
      const interactionId = `${session.command.executionId}:${String(params.turnId)}:${String(message.id)}`;
      session.pending = {
        id: message.id,
        method: message.method,
        params,
        interactionId,
      };
      const questions = (params.questions ?? []) as { question: string }[];
      await session.emit({
        type: isQuestion ? "question" : "permission",
        message: isQuestion
          ? questions.map((question) => question.question).join("\n")
          : String(
              params.reason ??
                params.command ??
                "Codex requests tool permission.",
            ),
        sessionId: session.sessionId,
        harnessTurnId: String(params.turnId),
        interactionId,
        permissionRequest: session.pending,
      });
      session.resolve({
        status: "waiting",
        sessionId: session.sessionId,
        harnessTurnId: String(params.turnId),
      });
    }
    if (message.method === "item/completed") {
      const item = params.item as { type?: string; text?: string };
      if (item.type === "agentMessage") session.finalMessage = item.text ?? "";
    }
    if (message.method === "item/agentMessage/delta")
      await session.emit({
        type: "progress",
        message: String(params.delta ?? ""),
        sessionId: session.sessionId,
        harnessTurnId:
          typeof params.turnId === "string"
            ? params.turnId
            : session.turnId || undefined,
      });
    if (
      message.method === "factory/transportError" ||
      message.method === "error"
    )
      throw new Error(String(params.message ?? JSON.stringify(params)));
    if (message.method === "turn/completed") {
      const turn = params.turn as {
        id: string;
        status: string;
        error?: unknown;
      };
      if (turn.status !== "completed")
        throw new Error(
          `Codex turn ${turn.status}: ${JSON.stringify(turn.error)}`,
        );
      try {
        const result = JSON.parse(session.finalMessage) as {
          question?: string | null;
        };
        if (typeof result.question === "string" && result.question.trim()) {
          if (session.command.activity.humanInput === "off")
            throw new Error(
              `Activity prohibits human input: ${result.question}`,
            );
          await session.emit({
            type: "question",
            message: result.question,
            sessionId: session.sessionId,
            harnessTurnId: turn.id,
            interactionId: `${session.command.executionId}:${turn.id}:question`,
          });
          this.finishSession(session, {
            status: "waiting",
            sessionId: session.sessionId,
            harnessTurnId: turn.id,
          });
        } else
          this.finishSession(session, {
            status: "completed",
            sessionId: session.sessionId,
            harnessTurnId: turn.id,
            completion: this.parseCompletion(
              session.finalMessage,
              session.command,
            ),
          });
      } catch (error) {
        throw new Error(
          `Malformed Codex output: ${session.finalMessage}. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  private async answerPendingRequest(
    session: LiveSession,
    command: WorkflowDaemonCommand,
    emit: (event: HarnessEvent) => Promise<void>,
  ): Promise<HarnessResult> {
    const pending = session.pending!;
    if (command.interaction?.interactionId !== pending.interactionId)
      throw new Error("Stale harness interaction response.");
    session.command = command;
    session.emit = emit;
    const result = this.awaitResult(session);
    session.pending = undefined;
    if (pending.method === "item/tool/requestUserInput") {
      const answers = Object.fromEntries(
        (pending.params.questions as { id: string }[]).map((question) => [
          question.id,
          { answers: [command.interaction!.answer] },
        ]),
      );
      session.transport.respond(pending.id, { answers });
    } else if (pending.method === "item/permissions/requestApproval") {
      session.transport.respond(pending.id, {
        permissions:
          command.interaction?.permission === "allow"
            ? pending.params.permissions
            : {},
        scope: "turn",
      });
    } else
      session.transport.respond(pending.id, {
        decision:
          command.interaction?.permission === "allow" ? "accept" : "decline",
      });
    return result;
  }
  async cancel(executionId: string): Promise<void> {
    const session = this.sessions.get(executionId);
    if (!session) return;
    try {
      if (session.turnId)
        await session.transport.request("turn/interrupt", {
          threadId: session.sessionId,
          turnId: session.turnId,
        });
    } finally {
      session.transport.close();
      session.reject(new Error("Codex execution cancelled."));
      this.sessions.delete(executionId);
    }
  }
  private parseCompletion(
    text: string,
    command: WorkflowDaemonCommand,
  ): CompletionContract {
    const parsed = JSON.parse(text) as CompletionContract;
    if (
      !command.activity.outcomes.some(
        (outcome) => outcome.name === parsed.outcome,
      )
    )
      throw new Error(`Malformed Codex completion: ${text}`);
    return { outcome: parsed.outcome };
  }
  private prompt(command: WorkflowDaemonCommand): string {
    return `${command.activity.instructions}\n\n${command.kickoffPrompt ?? "No kickoff prompt was supplied."}\n\nReturn a named outcome. Human input mode: ${command.activity.humanInput}. ${this.humanInputInstructions(command)}`;
  }
  private humanInputInstructions(command: WorkflowDaemonCommand): string {
    switch (command.activity.humanInput) {
      case "off":
        return "Complete using the supplied context. Do not ask questions; question must be null.";
      case "input":
        return "Ask at least one question before completion. Open the conversation yourself when no kickoff prompt was supplied. Return a question string while gathering input; otherwise question must be null.";
      case "approval":
        return "Ask questions only when needed. Return a question string while gathering input; otherwise question must be null.";
    }
  }
  private outputSchema(
    command: WorkflowDaemonCommand,
  ): Record<string, unknown> {
    return {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "question"],
      properties: {
        outcome: {
          type: "string",
          enum: command.activity.outcomes.map((outcome) => outcome.name),
        },
        question: { type: ["string", "null"] },
      },
    };
  }
}
