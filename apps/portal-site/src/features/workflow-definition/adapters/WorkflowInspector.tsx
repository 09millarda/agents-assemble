import { useEffect, useRef } from "react";
import {
  WORKFLOW_EFFORTS,
  WORKFLOW_MODELS,
  type Activity,
  type ActivityOutcome,
  type WorkflowDefinition,
} from "@factory/workflow";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import type { GraphEdgeRef } from "./WorkflowGraph";

const selectClass = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";

function describeOutcomeTarget(definition: WorkflowDefinition, outcome: ActivityOutcome): string {
  if (!outcome.handoff.targetActivityId) return "End run";
  return definition.activities.find((activity) => activity.activityId === outcome.handoff.targetActivityId)?.name ?? "Missing step";
}

function getStepNameError(definition: WorkflowDefinition, activity: Activity): string | null {
  if (!activity.name.trim()) return "Step name is required.";
  const matchingNames = definition.activities.filter((candidate) => candidate.name.trim() === activity.name.trim());
  return matchingNames.length > 1 ? "Step names must be unique." : null;
}

function getInstructionsError(activity: Activity): string | null {
  return activity.instructions.trim() ? null : "Instructions are required.";
}

export function WorkflowInspector({
  definition,
  selectedActivity,
  selectedEdge,
  selectedOutcome,
  nodeError,
  edgeError,
  focusActivityId,
  onFocusHandled,
  onUpdateActivity,
  onSelectOutcome,
  onUpdateOutcome,
  onAddOutcome,
  onRemoveOutcome,
  onRequestDeleteStep,
}: {
  definition: WorkflowDefinition;
  selectedActivity: Activity | null;
  selectedEdge: GraphEdgeRef | null;
  selectedOutcome: ActivityOutcome | null;
  nodeError: string | null;
  edgeError: string | null;
  focusActivityId: string | null;
  onFocusHandled: () => void;
  onUpdateActivity: (activity: Activity) => void;
  onSelectOutcome: (edge: GraphEdgeRef) => void;
  onUpdateOutcome: (outcome: ActivityOutcome) => void;
  onAddOutcome: () => void;
  onRemoveOutcome: () => void;
  onRequestDeleteStep: () => void;
}) {
  const inspectorRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusActivityId || !selectedActivity || focusActivityId !== selectedActivity.activityId) return;
    inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    nameInputRef.current?.focus({ preventScroll: true });
    onFocusHandled();
  }, [focusActivityId, onFocusHandled, selectedActivity]);

  if (selectedActivity) {
    const nameError = getStepNameError(definition, selectedActivity);
    const instructionsError = getInstructionsError(selectedActivity);

    return (
      <aside ref={inspectorRef} className="grid content-start gap-5 rounded-2xl border border-border/80 bg-white p-5 shadow-sm lg:sticky lg:top-24 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
        <div>
          <p className="portal-eyebrow">Selected node</p>
          <h2 className="mt-1 text-lg font-bold tracking-tight">Step details</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Configure this step without leaving the workflow graph.</p>
        </div>

        <section className="grid gap-3" aria-labelledby="step-basics-heading">
          <h3 id="step-basics-heading" className="text-sm font-bold uppercase tracking-[0.1em] text-muted-foreground">Basics</h3>
          <label className="grid gap-1 text-sm font-medium">
            Name
            <Input
              ref={nameInputRef}
              value={selectedActivity.name}
              onChange={(event) => onUpdateActivity({ ...selectedActivity, name: event.target.value })}
              aria-invalid={Boolean(nameError)}
            />
            {nameError ? <span role="alert" className="text-xs font-normal text-red-600">{nameError}</span> : null}
          </label>
          <label className="grid gap-1 text-sm">
            Description <span className="text-xs text-muted-foreground">(UI only, never sent to the model)</span>
            <Input
              value={selectedActivity.description}
              onChange={(event) => onUpdateActivity({ ...selectedActivity, description: event.target.value })}
            />
          </label>
        </section>

        <section className="grid gap-3" aria-labelledby="step-execution-heading">
          <h3 id="step-execution-heading" className="text-sm font-bold uppercase tracking-[0.1em] text-muted-foreground">Execution</h3>
          <label className="grid gap-1 text-sm">
            Human input
            <select className={selectClass} value={selectedActivity.humanInput} onChange={(event) => onUpdateActivity({ ...selectedActivity, humanInput: event.target.value as Activity["humanInput"] })}>
              <option value="off">Off</option>
              <option value="approval">Approval</option>
              <option value="input">Input</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Model
              <select className={selectClass} value={selectedActivity.execution.model} onChange={(event) => onUpdateActivity({ ...selectedActivity, execution: { ...selectedActivity.execution, model: event.target.value } })}>
                {WORKFLOW_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Effort
              <select className={selectClass} value={selectedActivity.execution.effort} onChange={(event) => onUpdateActivity({ ...selectedActivity, execution: { ...selectedActivity.execution, effort: event.target.value } })}>
                {WORKFLOW_EFFORTS.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="grid gap-2" aria-labelledby="step-instructions-heading">
          <h3 id="step-instructions-heading" className="text-sm font-bold uppercase tracking-[0.1em] text-muted-foreground">Instructions</h3>
          <label className="grid gap-1 text-sm font-medium">
            Instructions <span className="text-xs font-normal text-muted-foreground">(sole system prompt)</span>
            <Textarea rows={7} value={selectedActivity.instructions} onChange={(event) => onUpdateActivity({ ...selectedActivity, instructions: event.target.value })} aria-invalid={Boolean(instructionsError)} />
            {instructionsError ? <span role="alert" className="text-xs font-normal text-red-600">{instructionsError}</span> : null}
          </label>
        </section>

        <section className="grid gap-2" aria-labelledby="step-outcomes-heading">
          <div className="flex items-center justify-between gap-3">
            <h3 id="step-outcomes-heading" className="text-sm font-bold uppercase tracking-[0.1em] text-muted-foreground">Outcomes</h3>
            <Button type="button" size="sm" variant="outline" onClick={onAddOutcome}>Add outcome</Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Select an outcome to edit its handoff in this panel.</p>
          <div className="grid gap-2">
            {selectedActivity.outcomes.map((outcome) => {
              const edge: GraphEdgeRef = { sourceActivityId: selectedActivity.activityId, outcomeName: outcome.name };
              const isSelected = selectedEdge?.sourceActivityId === edge.sourceActivityId && selectedEdge.outcomeName === edge.outcomeName;
              return (
                <button key={outcome.name} type="button" className={`grid gap-1 rounded-xl border p-3 text-left transition-colors ${isSelected ? "border-blue-500 bg-blue-50" : "border-border hover:bg-[#f5f8fb]"}`} onClick={() => onSelectOutcome(edge)}>
                  <span className="font-semibold">{outcome.name}</span>
                  <span className="text-xs text-muted-foreground">{describeOutcomeTarget(definition, outcome)}{outcome.handoff.continuation === "approval" ? " · approval" : ""}</span>
                </button>
              );
            })}
          </div>
        </section>

        {nodeError ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{nodeError}</p> : null}
        <div className="border-t border-border/70 pt-4">
          <Button type="button" size="sm" variant="destructive" onClick={onRequestDeleteStep}>Delete step</Button>
        </div>
      </aside>
    );
  }

  if (selectedEdge && selectedOutcome) {
    const sourceActivity = definition.activities.find((activity) => activity.activityId === selectedEdge.sourceActivityId);
    return (
      <aside ref={inspectorRef} className="grid content-start gap-5 rounded-2xl border border-border/80 bg-white p-5 shadow-sm lg:sticky lg:top-24 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
        <div>
          <p className="portal-eyebrow">Selected outcome</p>
          <h2 className="mt-1 text-lg font-bold tracking-tight">Outcome details</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Configure the handoff from {sourceActivity?.name ?? "this step"}.</p>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Outcome name
          <Input
            value={selectedOutcome.name}
            onChange={(event) => onUpdateOutcome({ ...selectedOutcome, name: event.target.value })}
            aria-invalid={Boolean(edgeError)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Target step
          <select className={selectClass} value={selectedOutcome.handoff.targetActivityId ?? ""} onChange={(event) => onUpdateOutcome({ ...selectedOutcome, handoff: { ...selectedOutcome.handoff, targetActivityId: event.target.value || null } })}>
            <option value="">End run</option>
            {definition.activities.filter((activity) => activity.activityId !== selectedEdge.sourceActivityId).map((activity) => <option key={activity.activityId} value={activity.activityId}>{activity.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={selectedOutcome.handoff.continuation === "approval"} onChange={(event) => onUpdateOutcome({ ...selectedOutcome, handoff: { ...selectedOutcome.handoff, continuation: event.target.checked ? "approval" : "automatic" } })} />
          Needs approval
        </label>
        {edgeError ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{edgeError}</p> : null}
        <div className="border-t border-border/70 pt-4">
          <Button type="button" size="sm" variant="outline" disabled={sourceActivity ? sourceActivity.outcomes.length <= 1 : true} onClick={onRemoveOutcome}>Remove outcome</Button>
          {sourceActivity && sourceActivity.outcomes.length <= 1 ? <p className="mt-2 text-xs text-muted-foreground">A step must keep at least one outcome.</p> : null}
        </div>
      </aside>
    );
  }

  return (
    <aside ref={inspectorRef} className="grid min-h-[260px] content-center gap-2 rounded-2xl border border-dashed border-border bg-[#fafbfd] p-5 text-center lg:sticky lg:top-24 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
      <h2 className="font-semibold">Step details</h2>
      <p className="text-sm leading-6 text-muted-foreground">Select a step or outcome to edit.</p>
    </aside>
  );
}
