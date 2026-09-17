import { useRef, useState } from "react";
import type { HumanInteraction, HumanResponse } from "@factory/workflow";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";

export function HumanInteractionPanel({
  interaction,
  runId,
  diff,
  busy,
  onRespond,
}: {
  interaction: HumanInteraction;
  runId: string;
  diff?: string;
  busy: boolean;
  onRespond: (response: HumanResponse) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [additionalPasses, setAdditionalPasses] = useState(1);
  const previousCommand = useRef<{
    payload: string;
    response: HumanResponse;
  } | null>(null);
  async function respond(action: HumanResponse["action"]) {
    const content = {
      runId,
      interactionId: interaction.interactionId,
      action,
      ...(answer.trim() ? { answer: answer.trim() } : {}),
      ...(action === "extend-loop" ? { additionalPasses } : {}),
    };
    const payload = JSON.stringify(content);
    const response =
      previousCommand.current?.payload === payload
        ? previousCommand.current.response
        : { ...content, messageId: crypto.randomUUID() };
    previousCommand.current = { payload, response };
    await onRespond(response);
  }
  return (
    <section
      className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
      aria-label="Human interaction"
    >
      <h2 className="font-semibold">
        {interaction.kind === "permission"
          ? "Harness permission request"
          : interaction.kind === "loop-exhaustion"
            ? "Review limit reached"
            : interaction.kind === "recovery"
              ? "Step failed"
              : interaction.kind === "question"
                ? "Your answer is needed"
                : "Approval required"}
      </h2>
      <p className="whitespace-pre-wrap text-sm">{interaction.prompt}</p>
      <p className="text-xs text-slate-600">
        Interaction{" "}
        <span className="font-mono">{interaction.interactionId}</span> ·
        execution <span className="font-mono">{interaction.executionId}</span>
      </p>
      {interaction.outputRevisionIds.length ? (
        <div className="text-sm">
          <p className="font-medium">
            Exact output revisions covered by this decision
          </p>
          <ul>
            {interaction.outputRevisionIds.map((revisionId) => (
              <li className="font-mono text-xs" key={revisionId}>
                {revisionId}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            Read these revisions and all other run documents below.
          </p>
        </div>
      ) : null}
      {interaction.reviewedTreeHash ? (
        <div className="grid gap-2">
          <p className="text-xs">
            Reviewed code tree:{" "}
            <span className="font-mono">{interaction.reviewedTreeHash}</span>
          </p>
          <details open>
            <summary className="cursor-pointer text-sm font-medium">
              Reviewed code changes
            </summary>
            <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
              {diff ??
                "Reviewed code changes have not arrived. Refresh before approving publication."}
            </pre>
          </details>
        </div>
      ) : null}
      {interaction.kind !== "permission" ? (
        <label className="grid gap-1 text-sm font-medium">
          {interaction.kind === "question"
            ? "Answer"
            : "Feedback or decision notes"}
          <Textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={3}
            disabled={busy}
          />
        </label>
      ) : (
        <p className="text-xs">
          This grants harness access. It does not approve a workflow handoff or
          publication.
        </p>
      )}
      {interaction.kind === "loop-exhaustion" ? (
        <label className="grid gap-1 text-sm">
          Additional review passes
          <Input
            type="number"
            min={1}
            max={100}
            value={additionalPasses}
            onChange={(event) =>
              setAdditionalPasses(Number(event.target.value))
            }
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {interaction.kind === "question" ? (
          <Button
            disabled={busy || !answer.trim()}
            onClick={() => void respond("answer")}
          >
            Send answer
          </Button>
        ) : null}
        {interaction.kind === "approval" ? (
          <>
            <Button
              disabled={
                busy ||
                Boolean(interaction.reviewedTreeHash && diff === undefined)
              }
              onClick={() => void respond("approve")}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              disabled={busy || !answer.trim()}
              onClick={() => void respond("request-changes")}
            >
              Request changes
            </Button>
          </>
        ) : null}
        {interaction.kind === "permission" ? (
          <>
            <Button
              disabled={busy}
              onClick={() => void respond("allow-permission")}
            >
              Allow permission
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void respond("deny-permission")}
            >
              Deny permission
            </Button>
          </>
        ) : null}
        {interaction.kind === "loop-exhaustion" ? (
          <>
            <Button
              disabled={
                busy ||
                !Number.isInteger(additionalPasses) ||
                additionalPasses < 1
              }
              onClick={() => void respond("extend-loop")}
            >
              Authorize additional passes
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void respond("accept-findings")}
            >
              Accept unresolved findings and disclose them
            </Button>
          </>
        ) : null}
        {interaction.kind === "recovery" ? (
          <Button disabled={busy} onClick={() => void respond("retry")}>
            Retry step
          </Button>
        ) : null}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void respond("cancel")}
        >
          Cancel run
        </Button>
      </div>
    </section>
  );
}
