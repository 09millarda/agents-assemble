// biome-ignore-all lint/suspicious/noThenProperty: `then` is the canonical declarative choice branch, never a function or thenable.
import type { Node } from "@aa/catalog/definition";
import { ArrowDown, ArrowUp, Braces, GitBranch, Plus, Trash2 } from "lucide-react";
import { useContext, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorNotice } from "@/components/workspace";
import { GraphEditingContext } from "./graph-context";

const kinds = ["call", "sequence", "choose", "parallel", "forEach", "repeat", "end"] as const;
function emptyNode(type: Node["type"]): Node {
  const id = `step_${crypto.randomUUID().slice(0, 8)}`;
  const result = { literal: null };
  const end = (): Node => ({ id: `end_${crypto.randomUUID().slice(0, 8)}`, type: "end", result });
  switch (type) {
    case "call":
      return { id, type, action: "action", with: { object: {} } };
    case "sequence":
      return { id, type, children: [] };
    case "choose":
      return {
        id,
        type,
        cases: [{ when: { eq: [{ literal: true }, { literal: true }] }, then: end() }],
        otherwise: end(),
      };
    case "parallel":
      return { id, type, join: "all", maxConcurrency: 1, branches: [end()] };
    case "forEach":
      return {
        id,
        type,
        items: { literal: [] },
        key: "/id",
        maxItems: 10,
        maxConcurrency: 1,
        body: end(),
        output: result,
      };
    case "repeat":
      return {
        id,
        type,
        maxIterations: 3,
        initial: result,
        body: end(),
        until: { eq: [{ literal: true }, { literal: true }] },
        carry: result,
        output: result,
      };
    case "end":
      return { id, type, result };
  }
}
const structuralKeys = new Set([
  "type",
  "id",
  "children",
  "branches",
  "cases",
  "otherwise",
  "body",
]);
/** Ordered slots remain explicit; field editing never overwrites a structural slot. */
export function GraphEditor({
  node,
  onChange: legacyChange,
  depth = 0,
}: {
  node: Node;
  onChange: (node: Node) => void;
  depth?: number;
}) {
  const semanticChange = useContext(GraphEditingContext);
  const onChange = (next: Node) =>
    semanticChange ? semanticChange(node, next) : legacyChange(next);
  const formId = useId();
  const [kind, setKind] = useState<Node["type"]>("call");
  const [error, setError] = useState<Error>();
  const [expanded, setExpanded] = useState(depth === 0);
  const fields = Object.fromEntries(
    Object.entries(node).filter(([key]) => !structuralKeys.has(key)),
  );
  const list =
    node.type === "sequence" ? node.children : node.type === "parallel" ? node.branches : undefined;
  const changeList = (children: Node[]) => {
    if (node.type === "sequence") onChange({ ...node, children });
    if (node.type === "parallel") onChange({ ...node, branches: children });
  };
  const move = (index: number, direction: number) => {
    if (!list) return;
    const children = [...list];
    const other = index + direction;
    [children[index], children[other]] = [children[other], children[index]];
    changeList(children);
  };
  return (
    <section
      aria-label={`${node.type} node ${node.id}`}
      className={`min-w-0 rounded-xl border ${depth === 0 ? "bg-slate-50/70 p-4" : "bg-white p-3"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md bg-teal-50 text-teal-700">
          <GitBranch className="size-3.5" />
        </span>
        <Badge variant="outline" className="font-mono text-[10px]">
          {node.type}
        </Badge>
        <label htmlFor={`${formId}-id`} className="sr-only">
          Node identifier
        </label>
        <Input
          id={`${formId}-id`}
          key={node.id}
          defaultValue={node.id}
          onBlur={(event) => {
            if (event.target.value !== node.id) onChange({ ...node, id: event.target.value });
          }}
          className="h-8 w-36 border-transparent font-mono text-xs shadow-none hover:border-input focus:border-input"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <Braces className="size-3.5" />
          Configure
        </Button>
      </div>
      {expanded && (
        <form
          className="mt-4 space-y-3 rounded-lg bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            try {
              const value: unknown = JSON.parse(
                String(new FormData(event.currentTarget).get("fields")),
              );
              if (
                !value ||
                typeof value !== "object" ||
                Array.isArray(value) ||
                Object.keys(value).some((key) => structuralKeys.has(key))
              )
                throw new Error(
                  "Edit structural slots using their controls. Fields must be a JSON object without type, id, or child slots.",
                );
              const kept = Object.fromEntries(
                Object.entries(node).filter(([key]) => structuralKeys.has(key)),
              );
              onChange({ ...kept, ...value } as Node);
            } catch (failure) {
              setError(failure instanceof Error ? failure : new Error("Invalid node fields"));
            }
          }}
        >
          <Label htmlFor={`${formId}-fields`}>Behavioral fields · {node.id}</Label>
          <Textarea
            key={JSON.stringify(fields)}
            id={`${formId}-fields`}
            name="fields"
            defaultValue={JSON.stringify(fields, null, 2)}
            className="min-h-32 font-mono text-xs"
          />
          <p className="text-xs leading-5 text-slate-500">
            Configure action inputs, outputs, runtime slots, conditions, and bounds. The complete
            definition is validated before a version can be published.
          </p>
          <ErrorNotice error={error} />
          <Button type="submit" size="sm" variant="outline">
            Apply fields
          </Button>
        </form>
      )}
      {list && (
        <div className="mt-4 space-y-3 border-l border-dashed border-teal-200 pl-3">
          {list.map((child, index) => (
            <div key={child.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
                  {node.type === "parallel" ? "Branch" : "Step"} {index + 1}
                </span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move ${child.id} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move ${child.id} down`}
                    disabled={index === list.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${child.id}`}
                    onClick={() => changeList(list.filter((_, position) => index !== position))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <GraphEditor
                node={child}
                depth={depth + 1}
                onChange={(next) =>
                  changeList(list.map((item, position) => (position === index ? next : item)))
                }
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <label htmlFor={`${formId}-kind`} className="sr-only">
              New node kind
            </label>
            <select
              id={`${formId}-kind`}
              className="h-8 rounded-md border bg-white px-2 text-xs"
              value={kind}
              onChange={(event) => setKind(event.target.value as Node["type"])}
            >
              {kinds.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => changeList([...list, emptyNode(kind)])}
            >
              <Plus className="size-3.5" />
              Add {node.type === "parallel" ? "branch" : "step"}
            </Button>
          </div>
        </div>
      )}
      {node.type === "choose" && (
        <div className="mt-4 space-y-3">
          {node.cases.map((branch, index) => (
            <div key={branch.then.id} className="space-y-2 border-l-2 border-amber-200 pl-3">
              <JsonCondition
                value={branch.when}
                label={`Condition ${index + 1}`}
                onChange={(when) =>
                  onChange({
                    ...node,
                    cases: node.cases.map((item, position) =>
                      position === index ? { ...item, when: when as typeof item.when } : item,
                    ),
                  })
                }
              />
              <GraphEditor
                node={branch.then}
                depth={depth + 1}
                onChange={(then) =>
                  onChange({
                    ...node,
                    cases: node.cases.map((item, position) =>
                      position === index ? { ...item, then } : item,
                    ),
                  })
                }
              />
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                ...node,
                cases: [
                  ...node.cases,
                  {
                    when: { exists: { source: "input", pointer: "" } },
                    then: emptyNode("sequence"),
                  },
                ],
              })
            }
          >
            <Plus />
            Add condition
          </Button>
          <p className="text-xs font-medium text-slate-500">Otherwise</p>
          <GraphEditor
            node={node.otherwise}
            depth={depth + 1}
            onChange={(otherwise) => onChange({ ...node, otherwise })}
          />
        </div>
      )}
      {(node.type === "forEach" || node.type === "repeat") && (
        <div className="mt-4 space-y-2 border-l-2 border-sky-200 pl-3">
          <p className="text-xs font-medium text-slate-500">Bounded body</p>
          <GraphEditor
            node={node.body}
            depth={depth + 1}
            onChange={(body) => onChange({ ...node, body })}
          />
        </div>
      )}
    </section>
  );
}
function JsonCondition({
  value,
  label,
  onChange,
}: {
  value: unknown;
  label: string;
  onChange: (value: unknown) => void;
}) {
  const id = useId();
  const [error, setError] = useState<Error>();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const next: unknown = JSON.parse(
            String(new FormData(event.currentTarget).get("condition")),
          );
          onChange(next);
          setError(undefined);
        } catch {
          setError(new Error("Enter valid JSON for the condition."));
        }
      }}
    >
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        key={JSON.stringify(value)}
        id={id}
        name="condition"
        className="min-w-40 flex-1 font-mono text-xs"
        defaultValue={JSON.stringify(value)}
      />
      <Button size="sm" variant="outline">
        Apply condition
      </Button>
      <ErrorNotice error={error} />
    </form>
  );
}
