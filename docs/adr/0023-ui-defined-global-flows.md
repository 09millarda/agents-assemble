# UI-Defined Global Flows Replace Repo-File Org Flows

## Status

Superseded by [ADR-0024: Durable workflow coordination](0024-durable-workflow-coordination.md). The following is historical context; the active API, schema, editor, and interpreter have been replaced.

## Context

Projects ran a single hardcoded repo-file org flow (plan → implement → review) via `ORG_FLOW_DEFINITIONS` and a project-scoped `startFlowRun` path. New work needs user-composed flows with branching, retries, fan-out joins, step reuse, and per-project gating, without a GitHub import, scheduler, or per-step permissions in v1.

## Decision

- Flows are global and UI-defined: a top-level `/flows` section hosts a flow list, a node canvas (drag library steps in, drag reorder, autosave, per-node success/fail/`maxRetries` editing, fan-out group assignment), and a step library create/edit panel.
- Steps are global library entries (`name`, `promptTemplate`, `harness`, `model`, `humanGate`); branching fields live on flow nodes, not on steps.
- `Project` stays path-based plus an `enabledFlowIds` allow-list; a flow enabled by exactly one project is project-only by convention, with no separate flow kind.
- Fan-out v1 is sibling-group join: all nodes sharing a `fanOutGroupId` must complete before the run continues. No DAG canvas or expression language.
- Delete `ORG_FLOW_DEFINITIONS`, the hardcoded plan-implement-review path, and skill-frontmatter/JSON-block parsing in the same change (alpha rule); no compat shims.

## Consequences

- Factory API gains `features/flow-definition/` (flows/steps CRUD) and `features/flow-run/` (start with generated fun-slug name, rename, pipeline state, active runs per project) persisted in Postgres; project routes gain the enabled-flows allow-list.
- Portal project detail becomes list plus Enabled-flows and Active-runs tabs; run detail is a stepper plus conversation view.
- V1 excludes GitHub import, scheduling, and per-step permissions.
