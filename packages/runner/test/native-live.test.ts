import { expect, it } from "vitest";
import { doctor } from "../src/native.ts";

it.skipIf(process.env.AA_NATIVE_READINESS !== "1")(
  "reports existing pinned native login without exporting account data",
  async () => {
    const capabilities = await doctor(process.env.AA_CODEX_BINARY ?? "codex");
    expect(capabilities).toMatchObject({
      platform: "linux",
      codexVersion: "0.153.4",
      nativeLoginReady: true,
      nativeAuthentication: "chatgpt",
      writerCoverage: "incomplete",
      automaticTakeover: false,
    });
    expect(Object.keys(capabilities)).not.toContain("account");
  },
);

it.skipIf(process.env.AA_NATIVE_CONFORMANCE !== "1")(
  "qualifies the explicitly selected native model with exact settings, structured output, steer, interrupt and typed questions",
  async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises"),
      { join } = await import("node:path"),
      { tmpdir } = await import("node:os"),
      { execFile } = await import("node:child_process"),
      { promisify } = await import("node:util");
    const { CodexNative } = await import("../src/native.ts"),
      { RunnerJournal } = await import("../src/journal.ts"),
      { makeCommand } = await import("./support.ts"),
      { payloadDigest, nativeQuestionSchema } = await import("../src/protocol.ts");
    const model = process.env.AA_NATIVE_MODEL,
      effort = process.env.AA_NATIVE_EFFORT;
    if (!model || effort !== "low")
      throw new Error(
        "Choose exact AA_NATIVE_MODEL and AA_NATIVE_EFFORT=low after verifying model/list; this test does not substitute models.",
      );
    const directory = await mkdtemp(join(tmpdir(), "aa-live-conformance-"));
    await promisify(execFile)("git", ["init", directory]);
    await writeFile(
      join(directory, "README.md"),
      "Isolated read-only native conformance fixture.\n",
    );
    try {
      for (const action of ["structured", "interrupt", "question"] as const) {
        const interrupt = action === "interrupt",
          questionMode = action === "question";
        const command = makeCommand();
        command.commandId = `live-${action}`;
        command.scope.invocationId = command.commandId;
        command.payload.runtime = {
          ...command.payload.runtime,
          model,
          effort,
          sandbox: "read-only",
        };
        command.payload.prompt = questionMode
          ? 'This is a read-only question capability test. Before returning your result, call request_user_input with one nonsensitive question: Which fixture color should be chosen?, and options Blue and Green. Wait for the answer, then return {"ok":true}. Do not call any other tool, execute commands or read or modify files.'
          : interrupt
            ? "Without tools or file modifications, carefully derive the first 100 primes and verify their sum before returning the requested JSON."
            : "Do not use tools or modify files. Return exactly the requested structured JSON with ok=true.";
        command.payload.outputSchema = {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        };
        command.payloadDigest = payloadDigest(command.payload);
        command.expiresAt = new Date(Date.now() + 90000).toISOString();
        let complete: (value: unknown) => void = () => {},
          failed: (error: Error) => void = () => {},
          text = "";
        let question: ReturnType<typeof nativeQuestionSchema.parse> | undefined,
          answerConfirmed = false;
        const completion = new Promise((resolve, reject) => {
          complete = resolve;
          failed = reject;
        });
        void completion.catch(() => {});
        let started: () => void = () => {};
        const startedEvent = new Promise<void>((resolve) => {
          started = resolve;
        });
        const native = new CodexNative({
          binary: process.env.AA_CODEX_BINARY ?? "codex",
          cwd: directory,
          onEvent: (event) => {
            if (event.method === "native/question") {
              question = nativeQuestionSchema.parse({
                ...nativeQuestionSchema.omit({ expiresAt: true }).parse(event.params),
                expiresAt: command.expiresAt,
              });
              const { expiresAt: _, ...binding } = question;
              void new Promise((resolve) => setTimeout(resolve, 10000))
                .then(() =>
                  native.answer({
                    ...binding,
                    questionDigest: payloadDigest(binding),
                    response: {
                      answers: Object.fromEntries(
                        binding.questions.map((item) => [
                          item.id,
                          { answers: [item.options?.[0]?.label ?? "Blue"] },
                        ]),
                      ),
                    },
                  }),
                )
                .then(() => {
                  answerConfirmed = true;
                })
                .catch(failed);
            }
            if (event.method === "turn/started") started();
            if (event.method === "turn/completed") complete(event.params);
            if (event.method === "native/connectionLost")
              failed(new Error("native_connection_lost"));
            if (
              event.method === "item/completed" &&
              event.params &&
              typeof event.params === "object" &&
              "item" in event.params
            ) {
              const item = event.params.item;
              if (
                item &&
                typeof item === "object" &&
                "type" in item &&
                item.type === "agentMessage" &&
                "text" in item &&
                typeof item.text === "string"
              )
                text = item.text;
            }
          },
        });
        const timer = setTimeout(() => failed(new Error("native_timeout")), 90000);
        try {
          await native.initialize();
          const effective = await native.start(command, directory);
          expect(effective).toMatchObject({
            model,
            effort,
            sandbox: { type: "readOnly", networkAccess: false },
          });
          await Promise.race([
            startedEvent,
            completion.then(() => {
              throw new Error("native_completed_before_turn_started");
            }),
          ]);
          if (interrupt) {
            const journal = new RunnerJournal(join(directory, "journal"));
            journal.receive(command);
            journal.stage(command.commandId, "running", effective);
            await native.interrupt(effective.threadId, effective.turnId);
            const journalId = journal.journalId;
            journal.close();
            const reopened = new RunnerJournal(join(directory, "journal"), journalId);
            reopened.recoverUncertain();
            expect(reopened.receive(command).state.stage).toBe("outcome_unknown");
            reopened.close();
          } else if (!questionMode)
            await native.steer(
              effective.threadId,
              effective.turnId,
              "live-steer",
              'Keep the response exactly {"ok":true}.',
            );
          expect(await completion).toMatchObject({
            threadId: effective.threadId,
            turn: { id: effective.turnId, status: interrupt ? "interrupted" : "completed" },
          });
          if (!interrupt) expect(JSON.parse(text)).toEqual({ ok: true });
          if (questionMode) {
            expect(question).toMatchObject({
              threadId: effective.threadId,
              turnId: effective.turnId,
            });
            expect(answerConfirmed).toBe(true);
          }
        } finally {
          clearTimeout(timer);
          native.close();
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  300000,
);
