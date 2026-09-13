import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunnerJournal } from "../src/journal.ts";
import { CodexNative, NativeRejected } from "../src/native.ts";
import {
  commandSchema,
  nativeQuestionParamsSchema,
  payloadDigest,
  validateNativeAnswers,
} from "../src/protocol.ts";
import { makeCommand } from "./support.ts";

const question = nativeQuestionParamsSchema.parse({
  threadId: "thread-1",
  turnId: "turn-1",
  itemId: "item-1",
  questions: [
    {
      id: "choice",
      header: "Direction",
      question: "Choose direction",
      isOther: false,
      isSecret: false,
      options: [
        { label: "Left", description: "Use left" },
        { label: "Right", description: "Use right" },
      ],
    },
  ],
  isBlocking: true,
  autoResolutionMs: null,
});
describe("native question public process protocol", () => {
  it("retains exact request identity, accepts only typed choices and confirms once through serverRequest/resolved", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aa-question-")),
      counter = join(directory, "answers"),
      binary = join(directory, "codex");
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs=require('node:fs');const question=${JSON.stringify(question)};
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);if(request.method==='initialize'){console.log(JSON.stringify({id:request.id,result:{}}));console.log(JSON.stringify({id:'native-question-1',method:'item/tool/requestUserInput',params:question}));}else if(request.id==='native-question-1'){fs.appendFileSync(${JSON.stringify(counter)},JSON.stringify(request)+'\\n');console.log(JSON.stringify({method:'serverRequest/resolved',params:{threadId:'thread-1',requestId:'native-question-1'}}));}});`,
      { mode: 0o700 },
    );
    let received: (value: unknown) => void = () => {};
    const incoming = new Promise((resolve) => {
      received = resolve;
    });
    const native = new CodexNative({
      binary,
      onEvent: (event) => {
        if (event.method === "native/question") received(event.params);
      },
    });
    try {
      await native.initialize();
      const event = await incoming;
      expect(event).toEqual({ requestId: "native-question-1", ...question });
      const payload = {
        requestId: "native-question-1",
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        questionDigest: payloadDigest(event),
        response: { answers: { choice: { answers: ["Left"] } } },
      };
      await expect(native.answer({ ...payload, turnId: "another-turn" })).rejects.toBeInstanceOf(
        NativeRejected,
      );
      await expect(
        native.answer({ ...payload, response: { answers: { choice: { answers: ["injected"] } } } }),
      ).rejects.toThrow("question_answer_choice_mismatch");
      await native.answer(payload, 1000);
      await expect(native.answer(payload, 1000)).rejects.toBeInstanceOf(NativeRejected);
      expect(
        (await readFile(counter, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual([{ id: "native-question-1", result: payload.response }]);
    } finally {
      native.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("leaves a sent answer unknown when confirmation is lost and never replays it after journal restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aa-question-loss-")),
      binary = join(directory, "codex");
    await writeFile(
      binary,
      `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);if(request.method==='initialize'){console.log(JSON.stringify({id:request.id,result:{}}));console.log(JSON.stringify({id:91,method:'item/tool/requestUserInput',params:${JSON.stringify(question)}}));}});`,
      { mode: 0o700 },
    );
    let received: () => void = () => {};
    const incoming = new Promise<void>((resolve) => {
        received = resolve;
      }),
      native = new CodexNative({
        binary,
        onEvent: (event) => {
          if (event.method === "native/question") received();
        },
      });
    let journal = new RunnerJournal(join(directory, "journal"));
    try {
      await native.initialize();
      await incoming;
      const payload = {
        inputId: "input-1",
        questionId: "human-question-1",
        requestId: 91,
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        questionDigest: payloadDigest({ requestId: 91, ...question }),
        response: { answers: { choice: { answers: ["Right"] } } },
        actorId: "actor-1",
      };
      const start = makeCommand(),
        command = commandSchema.parse({
          ...start,
          kind: "answer",
          payload,
          payloadDigest: payloadDigest(payload),
        });
      journal.receive(command);
      journal.stage(command.commandId, "sending");
      await expect(native.answer(payload, 40)).rejects.toThrow("answer_confirmation_timeout");
      await expect(native.answer(payload, 40)).rejects.toBeInstanceOf(NativeRejected);
      const id = journal.journalId;
      journal.close();
      journal = new RunnerJournal(join(directory, "journal"), id);
      journal.recoverUncertain();
      expect(journal.receive(command)).toMatchObject({
        fresh: false,
        state: { stage: "outcome_unknown" },
      });
      expect(journal.pendingReceipts()).toContainEqual(
        expect.objectContaining({ commandId: command.commandId, status: "outcome_unknown" }),
      );
    } finally {
      native.close();
      journal.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects secret questions, missing answer identities and substituted option values", () => {
    expect(
      nativeQuestionParamsSchema.safeParse({
        ...question,
        questions: [{ ...question.questions[0], isSecret: true }],
      }).success,
    ).toBe(false);
    expect(() =>
      validateNativeAnswers(question, { answers: { other: { answers: ["Left"] } } }),
    ).toThrow();
  });
});
