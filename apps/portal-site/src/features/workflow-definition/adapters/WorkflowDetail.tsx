import { Link } from "@tanstack/react-router";
import type { WorkflowDefinition } from "@factory/workflow";
import { ArrowLeft, Pencil, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { WorkflowGraph } from "./WorkflowGraph";

export function WorkflowDetail({
  definition,
  onDelete,
  onPublish,
  onUnpublish,
  lifecycleBusy = false,
  lifecycleError = null,
}: {
  definition: WorkflowDefinition;
  onDelete: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
  lifecycleBusy?: boolean;
  lifecycleError?: string | null;
}) {
  return (
    <div className="grid gap-6">
      <Link to="/workflows" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#45659a] hover:text-[#18243a]">
        <ArrowLeft className="h-4 w-4" /> Back to workflows
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="portal-eyebrow">Workflow / details</p>
          <h1 className="portal-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-[#18243a] md:text-4xl">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff3d9] text-[#aa6816]"><WorkflowIcon className="h-5 w-5" /></span>
            {definition.name}
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
            {definition.description?.trim() || "No description yet."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">{definition.activities.length} steps</Badge>
            <Badge variant="secondary">Global workflow</Badge>
            <Badge variant={definition.status === "published" ? "success" : "secondary"}>
              {definition.status === "published" ? "Published" : "Draft"}
            </Badge>
            {definition.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/workflows/$workflowId/edit" params={{ workflowId: definition.workflowId }}>
              <Pencil className="h-4 w-4" /> Edit workflow
            </Link>
          </Button>
          <Button type="button" variant="destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Delete workflow
          </Button>
          {definition.status === "published" && onUnpublish ? (
            <Button type="button" variant="outline" disabled={lifecycleBusy} onClick={onUnpublish}>
              {lifecycleBusy ? "Unpublishing…" : "Unpublish workflow"}
            </Button>
          ) : null}
          {definition.status === "draft" && onPublish ? (
            <Button type="button" disabled={lifecycleBusy} onClick={onPublish}>
              {lifecycleBusy ? "Publishing…" : "Publish workflow"}
            </Button>
          ) : null}
        </div>
      </header>
      {lifecycleError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{lifecycleError}</p> : null}
      <section className="grid gap-3 rounded-2xl border border-border/80 bg-white p-4 shadow-sm md:p-5">
        <div>
          <h2 className="text-lg font-bold">Workflow graph</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Each step is a node and each outcome is a labelled handoff. Open Edit workflow to make changes.</p>
        </div>
        <WorkflowGraph definition={definition} />
      </section>
    </div>
  );
}
