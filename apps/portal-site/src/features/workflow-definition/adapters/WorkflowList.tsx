import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Trash2 } from "lucide-react";
import type { WorkflowDefinition } from "@factory/workflow";
import { Button } from "../../../components/ui/button";

export function WorkflowList({
  definitions,
  onDelete,
}: {
  definitions: WorkflowDefinition[];
  onDelete: (definition: WorkflowDefinition) => void;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">All workflows</h2>
          <p className="mt-1 text-sm text-muted-foreground">Reusable workflows ready to enable per project.</p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
          {definitions.length} total
        </span>
      </div>
      {definitions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center text-sm text-muted-foreground">
          No workflows yet. Create one to start building your workflow library.
        </div>
      ) : (
        <div className="grid gap-2">
          {definitions.map((definition) => (
            <div
              key={definition.workflowId}
              className="flex items-center gap-2 rounded-2xl border border-border/80 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#bdcbe0] hover:shadow-[0_12px_28px_rgba(31,48,78,0.08)]"
            >
              <Link
                to="/workflows/$workflowId"
                params={{ workflowId: definition.workflowId }}
                aria-label={`View workflow: ${definition.name}`}
                className="group flex min-w-0 flex-1 items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[#18243a]">{definition.name}</p>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                    {definition.description?.trim() || "No description yet."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                  <span aria-label={`${definition.activities.length} steps`}>{definition.activities.length} steps</span>
                  <ArrowUpRight className="h-4 w-4 text-[#45659a] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
              </Link>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Delete workflow: ${definition.name}`}
                onClick={() => onDelete(definition)}
                className="shrink-0 text-[#a32929] hover:bg-red-50 hover:text-[#a32929]"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
