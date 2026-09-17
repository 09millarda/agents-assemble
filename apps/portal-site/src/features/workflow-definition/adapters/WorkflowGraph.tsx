import { useMemo, useRef, useState } from "react";
import type { WorkflowDefinition } from "@factory/workflow";
export interface GraphEdgeRef {
  sourceActivityId: string;
  outcomeName: string;
}
export type NodeStatus = "pending" | "running" | "waiting" | "done" | "current";
const NODE_WIDTH = 220;
const NODE_HEIGHT = 92;
function statusTint(status?: NodeStatus): string {
  switch (status) {
    case "running":
    case "current":
      return "border-blue-500 ring-2 ring-blue-200";
    case "waiting":
      return "border-amber-500 ring-2 ring-amber-200";
    case "done":
      return "border-emerald-500";
    default:
      return "border-slate-300";
  }
}
export function WorkflowGraph({
  definition,
  editable = false,
  selectedNodeId = null,
  selectedEdge = null,
  statusByActivityId = {},
  currentActivityId = null,
  nodeErrors = {},
  edgeErrors = {},
  onSelectNode,
  onSelectEdge,
  onMoveNode,
  onConnect,
}: {
  definition: WorkflowDefinition;
  editable?: boolean;
  selectedNodeId?: string | null;
  selectedEdge?: GraphEdgeRef | null;
  statusByActivityId?: Record<string, NodeStatus>;
  currentActivityId?: string | null;
  nodeErrors?: Record<string, string>;
  edgeErrors?: Record<string, string>;
  onSelectNode?: (activityId: string | null) => void;
  onSelectEdge?: (edge: GraphEdgeRef | null) => void;
  onMoveNode?: (activityId: string, position: { x: number; y: number }) => void;
  onConnect?: (sourceActivityId: string, targetActivityId: string) => void;
}) {
  const [viewport, setViewport] = useState({ x: 0, y: 0, k: 1 });
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const dragNodeRef = useRef<{ activityId: string; offsetX: number; offsetY: number } | null>(null);
  const positions = useMemo(() => {
    const fallback: Record<string, { x: number; y: number }> = {};
    definition.activities.forEach((activity, index) => {
      fallback[activity.activityId] = definition.positions?.[activity.activityId] ?? {
        x: 40 + (index % 3) * 280,
        y: 40 + Math.floor(index / 3) * 180,
      };
    });
    return fallback;
  }, [definition]);
  const edges = useMemo(() => {
    const list: { source: string; outcome: string; target: string | null; approval: boolean }[] = [];
    for (const activity of definition.activities)
      for (const outcome of activity.outcomes)
        list.push({
          source: activity.activityId,
          outcome: outcome.name,
          target: outcome.handoff.targetActivityId,
          approval: outcome.handoff.continuation === "approval",
        });
    return list;
  }, [definition]);
  function edgeKey(source: string, outcome: string): string {
    return `${source}:${outcome}`;
  }
  function nodeCenter(activityId: string): { x: number; y: number } {
    const position = positions[activityId] ?? { x: 0, y: 0 };
    return { x: position.x + NODE_WIDTH / 2, y: position.y + NODE_HEIGHT / 2 };
  }
  return (
    <div className="grid gap-2">
      <div
        className="relative h-[420px] overflow-hidden rounded-lg border bg-slate-50"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("[data-node]")) return;
          panRef.current = { startX: event.clientX, startY: event.clientY, originX: viewport.x, originY: viewport.y };
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragNodeRef.current && onMoveNode) {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const x = Math.round((event.clientX - rect.left - viewport.x) / viewport.k - dragNodeRef.current.offsetX);
            const y = Math.round((event.clientY - rect.top - viewport.y) / viewport.k - dragNodeRef.current.offsetY);
            onMoveNode(dragNodeRef.current.activityId, { x, y });
            return;
          }
          if (panRef.current)
            setViewport((current) => ({
              ...current,
              x: panRef.current!.originX + (event.clientX - panRef.current!.startX),
              y: panRef.current!.originY + (event.clientY - panRef.current!.startY),
            }));
        }}
        onPointerUp={() => {
          panRef.current = null;
          dragNodeRef.current = null;
        }}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setViewport((current) => ({
            ...current,
            k: Math.min(2, Math.max(0.4, current.k * (event.deltaY < 0 ? 1.1 : 0.9))),
          }));
        }}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("[data-node],[data-edge]")) return;
          onSelectNode?.(null);
          onSelectEdge?.(null);
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`, transformOrigin: "0 0" }}
        >
          <svg className="absolute left-0 top-0 overflow-visible" width={10} height={10}>
            {edges.map((edge) => {
              if (!edge.target) return null;
              const from = nodeCenter(edge.source);
              const to = nodeCenter(edge.target);
              const midX = (from.x + to.x) / 2;
              const selected = selectedEdge?.sourceActivityId === edge.source && selectedEdge?.outcomeName === edge.outcome;
              const key = edgeKey(edge.source, edge.outcome);
              return (
                <g key={key} data-edge={key}>
                  <path
                    d={`M ${from.x + NODE_WIDTH / 2} ${from.y} C ${midX + NODE_WIDTH / 2} ${from.y}, ${midX - NODE_WIDTH / 2} ${to.y}, ${to.x - NODE_WIDTH / 2} ${to.y}`}
                    fill="none"
                    stroke={selected ? "#2563eb" : edge.approval ? "#d97706" : "#64748b"}
                    strokeWidth={selected ? 3 : 2}
                    strokeDasharray={edge.approval ? "6 4" : undefined}
                    className={editable ? "cursor-pointer" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectEdge?.({ sourceActivityId: edge.source, outcomeName: edge.outcome });
                      onSelectNode?.(null);
                    }}
                  />
                  <text
                    x={midX}
                    y={(from.y + to.y) / 2 - 6}
                    textAnchor="middle"
                    fontSize={12}
                    fill={edgeErrors[key] ? "#b91c1c" : "#334155"}
                    className={editable ? "cursor-pointer" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectEdge?.({ sourceActivityId: edge.source, outcomeName: edge.outcome });
                      onSelectNode?.(null);
                    }}
                  >
                    {edge.outcome}
                    {edge.approval ? " · approval" : ""}
                  </text>
                </g>
              );
            })}
          </svg>
          {definition.activities.map((activity) => {
            const position = positions[activity.activityId]!;
            const status: NodeStatus | undefined =
              activity.activityId === currentActivityId
                ? "current"
                : statusByActivityId[activity.activityId];
            const selected = selectedNodeId === activity.activityId;
            return (
              <div
                key={activity.activityId}
                data-node={activity.activityId}
                className={`absolute rounded-lg border-2 bg-white p-2 shadow-sm ${statusTint(status)} ${selected ? "ring-2 ring-blue-400" : ""} ${editable ? "cursor-grab" : ""}`}
                style={{ left: position.x, top: position.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
                onPointerDown={(event) => {
                  if (!editable) return;
                  if ((event.target as HTMLElement).closest("[data-handle]")) return;
                  dragNodeRef.current = {
                    activityId: activity.activityId,
                    offsetX: (event.clientX - event.currentTarget.getBoundingClientRect().left) / viewport.k,
                    offsetY: (event.clientY - event.currentTarget.getBoundingClientRect().top) / viewport.k,
                  };
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (pendingSource && pendingSource !== activity.activityId && onConnect) {
                    onConnect(pendingSource, activity.activityId);
                    setPendingSource(null);
                    return;
                  }
                  onSelectNode?.(activity.activityId);
                  onSelectEdge?.(null);
                }}
              >
                <p className="truncate text-sm font-semibold">{activity.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {activity.execution.model} · {activity.execution.effort} · {activity.humanInput}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                  {activity.outcomes.map((outcome) => outcome.name).join(", ") || "No outcomes"}
                </p>
                {nodeErrors[activity.activityId] ? (
                  <p role="alert" className="mt-1 text-xs text-red-600">{nodeErrors[activity.activityId]}</p>
                ) : null}
                {editable ? (
                  <button
                    type="button"
                    data-handle={activity.activityId}
                    title="Connect from this step"
                    className={`absolute -right-2 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border text-xs leading-none ${pendingSource === activity.activityId ? "bg-blue-600 text-white" : "bg-white"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingSource((current) => (current === activity.activityId ? null : activity.activityId));
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    →
                  </button>
                ) : null}
              </div>
            );
          })}
          {edges
            .filter((edge) => !edge.target)
            .map((edge) => {
              const from = positions[edge.source] ?? { x: 0, y: 0 };
              return (
                <button
                  key={edgeKey(edge.source, edge.outcome)}
                  type="button"
                  data-edge={edgeKey(edge.source, edge.outcome)}
                  className="absolute rounded-full border border-dashed border-slate-400 bg-white px-2 py-0.5 text-xs"
                  style={{ left: from.x + NODE_WIDTH + 8, top: from.y + 8 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectEdge?.({ sourceActivityId: edge.source, outcomeName: edge.outcome });
                    onSelectNode?.(null);
                  }}
                >
                  {edge.outcome}: end
                </button>
              );
            })}
        </div>
        <div className="absolute left-2 top-2 flex gap-1">
          <button type="button" className="rounded border bg-white px-2 py-1 text-xs" onClick={() => setViewport((current) => ({ ...current, k: Math.min(2, current.k * 1.1) }))}>+</button>
          <button type="button" className="rounded border bg-white px-2 py-1 text-xs" onClick={() => setViewport((current) => ({ ...current, k: Math.max(0.4, current.k * 0.9) }))}>−</button>
          <button type="button" className="rounded border bg-white px-2 py-1 text-xs" onClick={() => setViewport({ x: 0, y: 0, k: 1 })}>Reset</button>
        </div>
        {pendingSource ? (
          <p role="status" className="absolute bottom-2 left-2 rounded bg-blue-600 px-2 py-1 text-xs text-white">
            Connecting from {definition.activities.find((activity) => activity.activityId === pendingSource)?.name ?? pendingSource}: click a target step.
          </p>
        ) : null}
        <svg className="absolute bottom-2 right-2 h-20 w-28 rounded border bg-white/90" aria-label="Minimap">
          {definition.activities.map((activity) => {
            const position = positions[activity.activityId]!;
            return <rect key={activity.activityId} x={position.x / 12} y={position.y / 12} width={18} height={8} fill={activity.activityId === currentActivityId ? "#2563eb" : "#94a3b8"} />;
          })}
        </svg>
      </div>
    </div>
  );
}
