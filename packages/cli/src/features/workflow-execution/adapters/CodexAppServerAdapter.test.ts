import { expect, test } from "bun:test";
import type { WorkflowDaemonCommand } from "@factory/workflow";
import { CodexAppServerAdapter } from "./CodexAppServerAdapter";
import type { AppServerTransport } from "./StdioAppServerTransport";

export const command: WorkflowDaemonCommand = {
  commandId: "command-1",
  executionId: "execution-1",
  runId: "run-1",
  daemonId: "daemon-1",
  kind: "execute",
  activity: {
    activityId: "requirements",
    name: "Requirements",
    instructions: "Establish requirements",
    execution: {
      kind: "agent",
      harness: "codex",
      model: "gpt-5.4",
      effort: "high",
    },
    humanInput: "approval",
    description: "",
    outcomes: [
      {
        name: "success",
        handoff: { targetActivityId: null, continuation: "approval" },
      },
    ],
  },
  workspace: { projectPath: "/project" },
  documents: [],
  documentContracts: [],
  kickoffPrompt: "Add a button",
};

class ProtocolBoundary implements AppServerTransport {
  requests: { method: string; params: Record<string, unknown> }[] = [];
  onMessage: (message: Record<string, unknown>) => void = () => {};
  async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.requests.push({ method, params });
    if (method === "model/list")
      return {
        data: [
          {
            model: "gpt-5.4",
            supportedReasoningEfforts: [{ reasoningEffort: "high" }],
          },
        ],
        nextCursor: null,
      };
    if (method === "thread/start")
      return {
        thread: { id: "session-1" },
        model: "gpt-5.4",
        reasoningEffort: "high",
      };
    if (method === "turn/start") {
      queueMicrotask(() => {
        this.onMessage({
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              text: '{"outcome":"success","question":null}',
            },
          },
        });
        this.onMessage({
          method: "turn/completed",
          params: { turn: { id: "turn-1", status: "completed" } },
        });
      });
      return { turn: { id: "turn-1" } };
    }
    return {};
  }
  notify(): void {}
  respond(_id: string | number, _result: unknown): void {}
  close(): void {}
}

test("Codex discovers supported efforts and sends explicit execution settings, worktree and completion schema over app-server", async () => {
  const transport = new ProtocolBoundary();
  const adapter = new CodexAppServerAdapter(
    () => transport,
    async () => "codex-cli 0.154.0",
  );
  expect(await adapter.discover()).toEqual({
    harness: "codex",
    version: "0.154.0",
    models: [{ model: "gpt-5.4", efforts: ["high"] }],
    questions: true,
    permissions: true,
    structuredOutput: true,
  });
  const events: unknown[] = [];
  const result = await adapter.execute(
    command,
    {
      worktreePath: "/run/worktree",
      branch: "codex/workflow-run-1",
      pinnedCommit: "abc",
    },
    "/run/documents",
    async (event) => {
      events.push(event);
    },
  );
  expect(result).toEqual({
    status: "completed",
    sessionId: "session-1",
    harnessTurnId: "turn-1",
    completion: {
      outcome: "success",
    },
  });
  expect(
    transport.requests.find((request) => request.method === "turn/start")
      ?.params,
  ).toMatchObject({
    threadId: "session-1",
    model: "gpt-5.4",
    effort: "high",
    cwd: "/run/worktree",
    outputSchema: { type: "object" },
  });
  expect(events).toContainEqual({
    type: "progress",
    message: "Codex conversation started (gpt-5.4, high).",
    sessionId: "session-1",
  });
});

test("a question persists the conversation identity and an answer resumes that conversation with the same explicit settings", async () => {
  const transport = new ProtocolBoundary();
  const request = transport.request.bind(transport);
  let turns = 0;
  transport.request = async (method, params) => {
    if (method === "thread/resume") {
      transport.requests.push({ method, params });
      return { thread: { id: "session-1" } };
    }
    if (method === "turn/start" && ++turns === 1) {
      transport.requests.push({ method, params });
      queueMicrotask(() => {
        transport.onMessage({
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              text: '{"outcome":"success","outputs":[],"question":"What should the button do?"}',
            },
          },
        });
        transport.onMessage({
          method: "turn/completed",
          params: { turn: { id: "turn-1", status: "completed" } },
        });
      });
      return { turn: { id: "turn-1" } };
    }
    return request(method, params);
  };
  const adapter = new CodexAppServerAdapter(
    () => transport,
    async () => "codex-cli 0.154.0",
  );
  const events: unknown[] = [];
  const workspace = {
    worktreePath: "/run/worktree",
    branch: "codex/workflow-run-1",
    pinnedCommit: "abc",
  };
  expect(
    await adapter.execute(
      { ...command, kickoffPrompt: null },
      workspace,
      "/run/documents",
      async (event) => {
        events.push(event);
      },
    ),
  ).toEqual({
    status: "waiting",
    sessionId: "session-1",
    harnessTurnId: "turn-1",
  });
  expect(events).toContainEqual({
    type: "question",
    message: "What should the button do?",
    sessionId: "session-1",
    harnessTurnId: "turn-1",
    interactionId: "execution-1:turn-1:question",
  });
  const result = await adapter.execute(
    {
      ...command,
      kind: "answer",
      commandId: "answer-1",
      sessionId: "session-1",
      interaction: {
        interactionId: "execution-1:turn-1:question",
        answer: "Save the form",
      },
    },
    workspace,
    "/run/documents",
    async () => {},
  );
  expect(result.status).toBe("completed");
  expect(transport.requests).toContainEqual({
    method: "thread/resume",
    params: expect.objectContaining({
      threadId: "session-1",
      model: "gpt-5.4",
      cwd: "/run/worktree",
    }),
  });
  expect(
    transport.requests.filter((item) => item.method === "turn/start").at(-1)
      ?.params.input,
  ).toEqual([{ type: "text", text: "Save the form", text_elements: [] }]);
});

test("native tool permission requests pause without completing and their answer resumes the suspended turn", async () => {
  const transport = new ProtocolBoundary();
  const request = transport.request.bind(transport);
  transport.request = async (method, params) => {
    if (method === "turn/start") {
      transport.requests.push({ method, params });
      queueMicrotask(() =>
        transport.onMessage({
          id: 41,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "session-1",
            turnId: "turn-1",
            command: "git status",
            reason: "Inspect checkout",
          },
        }),
      );
      return { turn: { id: "turn-1" } };
    }
    return request(method, params);
  };
  const responses: unknown[] = [];
  transport.respond = (id, result) => {
    responses.push({ id, result });
    queueMicrotask(() => {
      transport.onMessage({
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            text: '{"outcome":"success","outputs":[{"documentId":"criteria","content":"# Acceptance criteria\\nWorks."}],"question":null}',
          },
        },
      });
      transport.onMessage({
        method: "turn/completed",
        params: { turn: { id: "turn-1", status: "completed" } },
      });
    });
  };
  const adapter = new CodexAppServerAdapter(
    () => transport,
    async () => "codex-cli 0.154.0",
  );
  const events: { interactionId?: string; permissionRequest?: unknown }[] = [];
  const workspace = {
    worktreePath: "/run/worktree",
    branch: "codex/workflow-run-1",
    pinnedCommit: "abc",
  };
  expect(
    (
      await adapter.execute(
        command,
        workspace,
        "/run/documents",
        async (event) => {
          events.push(event);
        },
      )
    ).status,
  ).toBe("waiting");
  const permission = events.find((event) => event.interactionId);
  expect(permission).toMatchObject({
    type: "permission",
    sessionId: "session-1",
    message: "Inspect checkout",
  });
  const resumed = await adapter.execute(
    {
      ...command,
      kind: "answer",
      commandId: "answer-permission",
      sessionId: "session-1",
      interaction: {
        interactionId: permission!.interactionId!,
        answer: "",
        permission: "allow",
        permissionRequest: permission!.permissionRequest,
      },
    },
    workspace,
    "/run/documents",
    async () => {},
  );
  expect(resumed.status).toBe("completed");
  expect(responses).toEqual([{ id: 41, result: { decision: "accept" } }]);
}, 1000);

test("Codex completion reports the actual harness turn identity", async () => {
  const transport = new ProtocolBoundary();
  const adapter = new CodexAppServerAdapter(
    () => transport,
    async () => "codex-cli 0.154.0",
  );
  const result = await adapter.execute(
    command,
    {
      worktreePath: "/run/worktree",
      branch: "codex/run",
      pinnedCommit: "base",
    },
    "/run/documents",
    async () => {},
  );
  expect(result.harnessTurnId).toBe("turn-1");
});

test("a native permission answer after daemon restart requires recovery instead of starting an unapproved new turn", async () => {
  const transport = new ProtocolBoundary();
  const adapter = new CodexAppServerAdapter(
    () => transport,
    async () => "codex-cli 0.154.0",
  );
  const interruptedAnswer = {
    ...command,
    kind: "answer" as const,
    commandId: "native-answer-after-restart",
    sessionId: "session-1",
    interaction: {
      interactionId: "native-permission",
      answer: "",
      permission: "allow" as const,
      permissionRequest: {
        id: 41,
        method: "item/commandExecution/requestApproval",
        params: { threadId: "session-1", turnId: "turn-1" },
        interactionId: "native-permission",
      },
    },
  };
  await expect(
    adapter.execute(
      interruptedAnswer,
      {
        worktreePath: "/run/worktree",
        branch: "codex/run",
        pinnedCommit: "base",
      },
      "/run/documents",
      async () => {},
    ),
  ).rejects.toThrow("Native harness interaction was interrupted");
  expect(
    transport.requests.some((request) => request.method === "turn/start"),
  ).toBe(false);
});

test("an activity that prohibits human input does not receive interview instructions when the run started without a prompt", async () => {
  const transport = new ProtocolBoundary();
  const adapter = new CodexAppServerAdapter(
    () => transport,
    async () => "codex-cli 0.154.0",
  );
  await adapter.execute(
    {
      ...command,
      kickoffPrompt: null,
      activity: {
        ...command.activity,
        instructions: "Implement the approved plan.",
        humanInput: "off",
      },
    },
    {
      worktreePath: "/run/worktree",
      branch: "codex/workflow-run-1",
      pinnedCommit: "abc",
    },
    "/run/documents",
    async () => {},
  );
  const input = transport.requests.find(
    (request) => request.method === "turn/start",
  )?.params.input;
  expect(input).toEqual([
    {
      type: "text",
      text: expect.stringContaining("Human input mode: off."),
      text_elements: [],
    },
  ]);
  expect(JSON.stringify(input)).not.toContain("interview");
  expect(JSON.stringify(input)).not.toContain("ask at least one question");
});
