# ADR-0027: Visual workflow graph with simplified steps

## Status
Accepted

## Context
The workflow editor was a list of activities plus document contracts, bounded loop groups, templates, PR/notify actions, and daemon capability discovery. That model was powerful but heavy to explain, validate, and render, and run progress was a separate execution list.

## Decision
- Render every workflow as a graph canvas: each step is a node, each outcome is a labelled edge. Support pan/zoom/minimap, click-node and click-edge side panels, drag-to-move nodes, and drag-from-handle connections. Reuse the canvas read-only on run detail with status tints and current-node highlight.
- Shrink step configuration to name, UI-only description, human input (`off` | `approval` | `input`), instructions as the sole system prompt, hardcoded model plus effort, and outgoing handoffs.
- Delete documents, loops, templates, PR/notify actions, and editor-side daemon capability discovery in the same change. Existing workflows with those concepts are reset, not converted.
- Hardcode the catalogue: harness `codex`, models `gpt-5.6-sol` plus `gpt-5.3-codex`, efforts `low`/`medium`/`high` defaulting to `medium`.
- Progress by graph shape: empty canvas allowed, free cycles allowed, start is the node with no incoming edges, terminal outcomes end the run, deleting a node deletes its edges. Positions live in the definition.

## Consequences
- Validation is simpler: unique step/outcome names, existing handoff targets, catalogue membership. No cycle, loop-entry, document, or action rules.
- The coordinator, daemon prompt builder, and run viewer ignore descriptions and legacy document/loop state. Frozen runs keep their snapshots.
- The API drops activity-template endpoints and document/loop schema; the OpenAPI spec is regenerated.
- Portal code loses the settings form, capability picker, template helpers, and daemon gating; the editor and run viewer share one graph component.
