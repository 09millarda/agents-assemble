import { useMemo, useState } from "react";
import {
  WORKFLOW_DEFAULT_EFFORT,
  WORKFLOW_DEFAULT_MODEL,
  WORKFLOW_EFFORTS,
  WORKFLOW_MODELS,
  validateWorkflowDefinition,
  type Activity,
  type WorkflowDefinition,
} from "@factory/workflow";
import { WorkflowGraph, type GraphEdgeRef } from "./WorkflowGraph";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
const selectClass = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
function newActivity(): Activity {
  return {
    activityId: crypto.randomUUID(),
    name: "New step",
    description: "",
    instructions: "",
    execution: { kind: "agent", harness: "codex", model: WORKFLOW_DEFAULT_MODEL, effort: WORKFLOW_DEFAULT_EFFORT },
    humanInput: "off",
    outcomes: [{ name: "done", handoff: { targetActivityId: null, continuation: "automatic" } }],
  };
}
export function WorkflowEditor({
  definition,
  onSave,
}: {
  definition: WorkflowDefinition;
  onSave: (definition: WorkflowDefinition) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() =>
    structuredClone({ ...definition, positions: definition.positions ?? {} }),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selectedActivity = draft.activities.find((activity) => activity.activityId === selectedNodeId) ?? null;
  const selectedOutcome = selectedEdge
    ? draft.activities
        .find((activity) => activity.activityId === selectedEdge.sourceActivityId)
        ?.outcomes.find((outcome) => outcome.name === selectedEdge.outcomeName) ?? null
    : null;
  const nodeErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const names = new Map<string, number>();
    for (const activity of draft.activities) names.set(activity.name.trim(), (names.get(activity.name.trim()) ?? 0) + 1);
    for (const activity of draft.activities) {
      if (!activity.name.trim() || !activity.instructions.trim()) errors[activity.activityId] = "Name and instructions are required.";
      else if ((names.get(activity.name.trim()) ?? 0) > 1) errors[activity.activityId] = "Step names must be unique.";
    }
    return errors;
  }, [draft]);
  const edgeErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const ids = new Set(draft.activities.map((activity) => activity.activityId));
    for (const activity of draft.activities) {
      const seen = new Set<string>();
      for (const outcome of activity.outcomes) {
        const key = `${activity.activityId}:${outcome.name}`;
        if (seen.has(outcome.name)) errors[key] = "Outcome names must be unique.";
        seen.add(outcome.name);
        if (outcome.handoff.targetActivityId && !ids.has(outcome.handoff.targetActivityId))
          errors[key] = "Handoff target does not exist.";
      }
    }
    return errors;
  }, [draft]);
  const blockingError = validateWorkflowDefinition(draft) ?? Object.values(nodeErrors)[0] ?? Object.values(edgeErrors)[0] ?? null;
  function updateActivity(activity: Activity) {
    setDraft((current) => ({
      ...current,
      activities: current.activities.map((candidate) => (candidate.activityId === activity.activityId ? activity : candidate)),
    }));
  }
  function addStep() {
    const activity = newActivity();
    setDraft((current) => ({
      ...current,
      activities: [...current.activities, activity],
      positions: { ...current.positions, [activity.activityId]: { x: 40 + current.activities.length * 40, y: 260 } },
    }));
    setSelectedNodeId(activity.activityId);
    setSelectedEdge(null);
  }
  function removeStep(activityId: string) {
    setDraft((current) => ({
      ...current,
      activities: current.activities
        .filter((activity) => activity.activityId !== activityId)
        .map((activity) => ({
          ...activity,
          outcomes: activity.outcomes.map((outcome) =>
            outcome.handoff.targetActivityId === activityId
              ? { ...outcome, handoff: { ...outcome.handoff, targetActivityId: null } }
              : outcome,
          ),
        })),
      positions: Object.fromEntries(Object.entries(current.positions).filter(([id]) => id !== activityId)),
    }));
    if (selectedNodeId === activityId) setSelectedNodeId(null);
  }
  function connect(sourceActivityId: string, targetActivityId: string) {
    setDraft((current) => ({
      ...current,
      activities: current.activities.map((activity) => {
        if (activity.activityId !== sourceActivityId) return activity;
        const outcomes = [...activity.outcomes];
        const terminal = outcomes.find((outcome) => !outcome.handoff.targetActivityId);
        if (terminal) terminal.handoff.targetActivityId = targetActivityId;
        else outcomes.push({ name: `to-${outcomes.length + 1}`, handoff: { targetActivityId, continuation: "automatic" } });
        return { ...activity, outcomes };
      }),
    }));
  }
  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await onSave(draft);
      setMessage("Workflow saved. Existing runs keep their frozen definition.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save workflow.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="grid gap-4">
      <section className="grid gap-2 rounded-lg border bg-white p-4">
        <label className="grid gap-1 text-sm font-medium">
          Workflow name
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Workflow description
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            placeholder="What is this workflow for?"
          />
        </label>
        <p className="text-sm text-slate-500">
          Each step is a node and each outcome is a labelled edge. The start step is the node with no incoming edges. Terminal outcomes end the run.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={addStep}>Add step</Button>
          <Button type="button" disabled={saving || !!blockingError} onClick={() => void save()}>Save workflow</Button>
        </div>
        {blockingError ? <p role="alert" className="text-sm text-red-600">{blockingError}</p> : null}
        {message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}
      </section>
      <WorkflowGraph
        definition={draft}
        editable
        selectedNodeId={selectedNodeId}
        selectedEdge={selectedEdge}
        nodeErrors={nodeErrors}
        edgeErrors={edgeErrors}
        onSelectNode={setSelectedNodeId}
        onSelectEdge={setSelectedEdge}
        onMoveNode={(activityId, position) => setDraft((current) => ({ ...current, positions: { ...current.positions, [activityId]: position } }))}
        onConnect={connect}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="grid content-start gap-3 rounded-lg border bg-white p-4">
          <h2 className="font-semibold">Step details</h2>
          {selectedActivity ? (
            <>
              <label className="grid gap-1 text-sm font-medium">
                Name
                <Input value={selectedActivity.name} onChange={(event) => updateActivity({ ...selectedActivity, name: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                Description (UI only, never sent to the model)
                <Input value={selectedActivity.description} onChange={(event) => updateActivity({ ...selectedActivity, description: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                Human input
                <select className={selectClass} value={selectedActivity.humanInput} onChange={(event) => updateActivity({ ...selectedActivity, humanInput: event.target.value as Activity["humanInput"] })}>
                  <option value="off">Off</option>
                  <option value="approval">Approval</option>
                  <option value="input">Input</option>
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Model
                  <select className={selectClass} value={selectedActivity.execution.model} onChange={(event) => updateActivity({ ...selectedActivity, execution: { ...selectedActivity.execution, model: event.target.value } })}>
                    {WORKFLOW_MODELS.map((model) => (<option key={model} value={model}>{model}</option>))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  Effort
                  <select className={selectClass} value={selectedActivity.execution.effort} onChange={(event) => updateActivity({ ...selectedActivity, execution: { ...selectedActivity.execution, effort: event.target.value } })}>
                    {WORKFLOW_EFFORTS.map((effort) => (<option key={effort} value={effort}>{effort}</option>))}
                  </select>
                </label>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                Instructions (sole system prompt)
                <Textarea rows={6} value={selectedActivity.instructions} onChange={(event) => updateActivity({ ...selectedActivity, instructions: event.target.value })} />
              </label>
              <div className="grid gap-2">
                <h3 className="text-sm font-medium">Outgoing handoffs</h3>
                {selectedActivity.outcomes.map((outcome, index) => (
                  <div key={outcome.name} className="grid gap-2 rounded border p-2">
                    <label className="grid gap-1 text-sm">
                      Outcome name
                      <Input
                        value={outcome.name}
                        onChange={(event) => {
                          const outcomes = selectedActivity.outcomes.map((candidate, candidateIndex) =>
                            candidateIndex === index ? { ...candidate, name: event.target.value } : candidate,
                          );
                          if (selectedEdge?.sourceActivityId === selectedActivity.activityId)
                            setSelectedEdge({ sourceActivityId: selectedEdge.sourceActivityId, outcomeName: event.target.value });
                          updateActivity({ ...selectedActivity, outcomes });
                        }}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      Target step
                      <select
                        className={selectClass}
                        value={outcome.handoff.targetActivityId ?? ""}
                        onChange={(event) => {
                          const outcomes = selectedActivity.outcomes.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, handoff: { ...candidate.handoff, targetActivityId: event.target.value || null } }
                              : candidate,
                          );
                          updateActivity({ ...selectedActivity, outcomes });
                        }}
                      >
                        <option value="">End run</option>
                        {draft.activities.filter((activity) => activity.activityId !== selectedActivity.activityId).map((activity) => (
                          <option key={activity.activityId} value={activity.activityId}>{activity.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={outcome.handoff.continuation === "approval"}
                        onChange={(event) => {
                          const outcomes = selectedActivity.outcomes.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, handoff: { ...candidate.handoff, continuation: (event.target.checked ? "approval" : "automatic") as "approval" | "automatic" } }
                              : candidate,
                          );
                          updateActivity({ ...selectedActivity, outcomes });
                        }}
                      />
                      Needs approval
                    </label>
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={selectedActivity.outcomes.length <= 1}
                        onClick={() => updateActivity({ ...selectedActivity, outcomes: selectedActivity.outcomes.filter((_, candidateIndex) => candidateIndex !== index) })}
                      >
                        Remove outcome
                      </Button>
                    </div>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => updateActivity({ ...selectedActivity, outcomes: [...selectedActivity.outcomes, { name: `outcome-${selectedActivity.outcomes.length + 1}`, handoff: { targetActivityId: null, continuation: "automatic" } }] })}
                  >
                    Add outcome
                  </Button>
                </div>
              </div>
              <div>
                <Button type="button" size="sm" variant="outline" onClick={() => removeStep(selectedActivity.activityId)}>Delete step</Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Select a step node to edit its name, description, human input, model, effort, and instructions.</p>
          )}
        </section>
        <section className="grid content-start gap-3 rounded-lg border bg-white p-4">
          <h2 className="font-semibold">Edge details</h2>
          {selectedEdge && selectedOutcome ? (
            <>
              <p className="text-sm text-slate-500">Outcome edge from {draft.activities.find((activity) => activity.activityId === selectedEdge.sourceActivityId)?.name}.</p>
              <label className="grid gap-1 text-sm font-medium">
                Outcome name
                <Input
                  value={selectedOutcome.name}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      activities: current.activities.map((activity) =>
                        activity.activityId !== selectedEdge.sourceActivityId
                          ? activity
                          : { ...activity, outcomes: activity.outcomes.map((outcome) => (outcome.name === selectedEdge.outcomeName ? { ...outcome, name: event.target.value } : outcome)) },
                      ),
                    }));
                    setSelectedEdge({ ...selectedEdge, outcomeName: event.target.value });
                  }}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedOutcome.handoff.continuation === "approval"}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      activities: current.activities.map((activity) =>
                        activity.activityId !== selectedEdge.sourceActivityId
                          ? activity
                          : {
                              ...activity,
                              outcomes: activity.outcomes.map((outcome) =>
                                outcome.name === selectedEdge.outcomeName
                                  ? { ...outcome, handoff: { ...outcome.handoff, continuation: (event.target.checked ? "approval" : "automatic") as "approval" | "automatic" } }
                                  : outcome,
                              ),
                            },
                      ),
                    }));
                  }}
                />
                Needs approval
              </label>
            </>
          ) : (
            <p className="text-sm text-slate-500">Select an edge label to rename the outcome or toggle approval. Drag from a node handle to a target step to connect.</p>
          )}
        </section>
      </div>
    </div>
  );
}
