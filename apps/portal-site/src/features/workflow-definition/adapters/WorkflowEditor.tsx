import { useEffect, useMemo, useState } from "react";
import { validateWorkflowDefinition, type Activity, type ActivityOutcome, type WorkflowDefinition } from "@factory/workflow";
import { Button } from "../../../components/ui/button";
import { WorkflowGraph, type GraphEdgeRef } from "./WorkflowGraph";
import { DeleteStepDialog } from "./DeleteStepDialog";
import { WorkflowInspector } from "./WorkflowInspector";
import { WorkflowMetadataDialog } from "./WorkflowMetadataDialog";
import {
  cloneWorkflowEditorDraft,
  connectWorkflowActivities,
  createWorkflowActivity,
  hasWorkflowDraftChanges,
  removeActivityFromWorkflow,
  removeWorkflowOutcome,
  updateWorkflowOutcome,
} from "./workflowEditorDraft";

export function WorkflowEditor({
  definition,
  onSave,
  onDirtyChange,
}: {
  definition: WorkflowDefinition;
  onSave: (definition: WorkflowDefinition) => Promise<WorkflowDefinition>;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => cloneWorkflowEditorDraft(definition));
  const [lastSavedDraft, setLastSavedDraft] = useState(() => cloneWorkflowEditorDraft(definition));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeRef | null>(null);
  const [focusActivityId, setFocusActivityId] = useState<string | null>(null);
  const [stepPendingDeletion, setStepPendingDeletion] = useState<Activity | null>(null);
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
    const activityIds = new Set(draft.activities.map((activity) => activity.activityId));
    for (const activity of draft.activities) {
      const seenOutcomeNames = new Set<string>();
      for (const outcome of activity.outcomes) {
        const key = `${activity.activityId}:${outcome.name}`;
        if (seenOutcomeNames.has(outcome.name)) errors[key] = "Outcome names must be unique.";
        seenOutcomeNames.add(outcome.name);
        if (outcome.handoff.targetActivityId && !activityIds.has(outcome.handoff.targetActivityId)) errors[key] = "Handoff target does not exist.";
      }
    }
    return errors;
  }, [draft]);
  const blockingError = validateWorkflowDefinition(draft) ?? Object.values(nodeErrors)[0] ?? Object.values(edgeErrors)[0] ?? null;
  const hasUnsavedChanges = useMemo(() => hasWorkflowDraftChanges(draft, lastSavedDraft), [draft, lastSavedDraft]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  function updateActivity(activity: Activity): void {
    setDraft((current) => ({
      ...current,
      activities: current.activities.map((candidate) => (candidate.activityId === activity.activityId ? activity : candidate)),
    }));
  }

  function selectNode(activityId: string | null): void {
    setSelectedNodeId(activityId);
    if (activityId) setSelectedEdge(null);
  }

  function selectEdge(edge: GraphEdgeRef | null): void {
    setSelectedEdge(edge);
    if (edge) setSelectedNodeId(null);
  }

  function addStep(): void {
    const activity = createWorkflowActivity(crypto.randomUUID());
    setDraft((current) => ({
      ...current,
      activities: [...current.activities, activity],
      positions: { ...current.positions, [activity.activityId]: { x: 40 + current.activities.length * 40, y: 260 } },
    }));
    selectNode(activity.activityId);
    setFocusActivityId(activity.activityId);
  }

  function requestDeleteStep(): void {
    if (selectedActivity) setStepPendingDeletion(selectedActivity);
  }

  function confirmDeleteStep(): void {
    if (!stepPendingDeletion) return;
    setDraft((current) => removeActivityFromWorkflow(current, stepPendingDeletion.activityId));
    setStepPendingDeletion(null);
    setSelectedNodeId(null);
    setSelectedEdge(null);
  }

  function connect(sourceActivityId: string, targetActivityId: string): void {
    setDraft((current) => connectWorkflowActivities(current, sourceActivityId, targetActivityId));
  }

  function updateSelectedOutcome(outcome: ActivityOutcome): void {
    if (!selectedEdge) return;
    setDraft((current) => updateWorkflowOutcome(current, selectedEdge, outcome));
    setSelectedEdge({ ...selectedEdge, outcomeName: outcome.name });
  }

  function addOutcome(): void {
    if (!selectedActivity) return;
    updateActivity({
      ...selectedActivity,
      outcomes: [...selectedActivity.outcomes, { name: `outcome-${selectedActivity.outcomes.length + 1}`, handoff: { targetActivityId: null, continuation: "automatic" } }],
    });
  }

  function removeSelectedOutcome(): void {
    if (!selectedEdge || !selectedOutcome) return;
    const sourceActivity = draft.activities.find((activity) => activity.activityId === selectedEdge.sourceActivityId);
    if (!sourceActivity || sourceActivity.outcomes.length <= 1) return;
    setDraft((current) => removeWorkflowOutcome(current, selectedEdge));
    setSelectedEdge(null);
  }

  async function save(): Promise<void> {
    if (!hasUnsavedChanges || blockingError) return;
    setSaving(true);
    setMessage(null);
    try {
      const savedDefinition = await onSave(draft);
      const canonicalDefinition = cloneWorkflowEditorDraft(savedDefinition);
      setDraft(canonicalDefinition);
      setLastSavedDraft(canonicalDefinition);
      setMessage("Workflow saved. Existing runs keep their frozen definition.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save workflow.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-5 md:flex-row md:items-start">
        <div>
          <p className="portal-eyebrow">Workflow / editor</p>
          <h1 className="portal-display mt-2 text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">Edit workflow</h1>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex items-center gap-3">
            {hasUnsavedChanges ? <span className="text-sm font-medium text-muted-foreground">Unsaved changes</span> : null}
            <Button type="button" disabled={!hasUnsavedChanges || saving || Boolean(blockingError)} onClick={() => void save()}>
              {saving ? "Saving…" : "Save workflow"}
            </Button>
          </div>
          {blockingError ? <p role="alert" className="max-w-xs text-right text-xs text-red-600">{blockingError}</p> : null}
          {message ? <p role="status" className="max-w-xs text-right text-xs text-muted-foreground">{message}</p> : null}
        </div>
      </header>

      <WorkflowMetadataDialog
        metadata={{ name: draft.name, description: draft.description, tags: draft.tags }}
        onSave={(metadata) => setDraft((current) => ({ ...current, ...metadata }))}
      />

      <section className="grid gap-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <Button type="button" variant="outline" onClick={addStep}>Add step</Button>
          <div className="md:text-right">
            <h2 className="text-lg font-bold">Workflow graph</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Each step is a node and each outcome is a labelled handoff. Drag nodes to arrange the canvas.</p>
          </div>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
          <WorkflowGraph
            definition={draft}
            editable
            selectedNodeId={selectedNodeId}
            selectedEdge={selectedEdge}
            nodeErrors={nodeErrors}
            edgeErrors={edgeErrors}
            onSelectNode={selectNode}
            onSelectEdge={selectEdge}
            onMoveNode={(activityId, position) => setDraft((current) => ({ ...current, positions: { ...current.positions, [activityId]: position } }))}
            onConnect={connect}
          />
          <WorkflowInspector
            definition={draft}
            selectedActivity={selectedActivity}
            selectedEdge={selectedEdge}
            selectedOutcome={selectedOutcome}
            nodeError={selectedNodeId ? nodeErrors[selectedNodeId] ?? null : null}
            edgeError={selectedEdge ? edgeErrors[`${selectedEdge.sourceActivityId}:${selectedEdge.outcomeName}`] ?? null : null}
            focusActivityId={focusActivityId}
            onFocusHandled={() => setFocusActivityId(null)}
            onUpdateActivity={updateActivity}
            onSelectOutcome={(edge) => selectEdge(edge)}
            onUpdateOutcome={updateSelectedOutcome}
            onAddOutcome={addOutcome}
            onRemoveOutcome={removeSelectedOutcome}
            onRequestDeleteStep={requestDeleteStep}
          />
        </div>
      </section>

      <DeleteStepDialog
        stepName={stepPendingDeletion?.name ?? "this step"}
        open={Boolean(stepPendingDeletion)}
        onConfirm={confirmDeleteStep}
        onCancel={() => setStepPendingDeletion(null)}
      />
    </div>
  );
}
