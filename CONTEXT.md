# Agent Software Factory — Context

Open-source factory for running agent software workflows on user-owned machines via containerised services, with a paid hosted deployment built from the same codebase.

## Language

**Agent Software Factory**:
The overall system: portal, API, daemons, and connector CLI that together let users run agent models to build software.
_Avoid_: platform, suite

**Machine-Run Daemon**:
Long-lived process running on a user's own machine that executes workflow activities through the configured local Codex app-server. The daemon is the stable per-machine channel for workflow execution: one daemon identity survives re-login and reconnects.
_Avoid_: worker, runner, agent (for the process itself)

**Harness**:
The local agent runtime used by a workflow activity (`codex` in v1), with its model and effort settings resolved by the workflow definition.
_Avoid_: provider

**Codex Model**:
A model from the static catalogue used by a workflow step (`gpt-5.6-sol` or `gpt-5.3-codex`) with effort `low`, `medium`, or `high`.
_Avoid_: model (unqualified), LLM

**Portal Site**:
React web app for workflows, projects, activity editors, documents, conversations, browser notifications, and daemon management.
_Avoid_: dashboard, frontend, console

**Marketing Site**:
Public Astro static site describing the factory and the paid hosted offering.
_Avoid_: landing page (as a component name), website (ambiguous)

**Factory API**:
HTTP API backing the portal, maintaining daemon connections, and accepting workflow commands and execution facts.
_Avoid_: backend, server (ambiguous)

**Factory CLI:**
Single TypeScript + Commander CLI (`cli`) run on the user's own machine. `auth login` approves this machine via the device flow, `daemon start` holds the outbound daemon WebSocket. Replaces the old split connector/daemon CLIs.
_Avoid_: installer, setup script, client, factory-connect, factory-daemon

**Daemon Connection**:
The authenticated channel between the Factory API and a specific machine-run daemon, established via the Factory CLI device flow. Stable per machine: re-login reuses the stored daemon ID for the same API URL; a fresh identity needs an explicit reset or a logout first.
_Avoid_: link, pairing (as a persistent noun), tunnel (unless it really is one)

**Daemon Communication**:
The authenticated daemon WebSocket carries workflow commands from the Factory API and execution facts back from the daemon. The portal manages daemons and workflows through the Factory API; it does not open a prompt socket to a daemon.
_Avoid_: chat (too narrow), job dispatch (implementation detail)

**Pairing Code** (deprecated):
Former short-lived registration code. Replaced by the device flow below; do not use as a persistent noun or add new pairing-code endpoints.

**Device Authorization**:
RFC 8628-style flow that authorizes a machine-run daemon without pre-shared credentials. The CLI requests a grant, the user approves the user code in the portal, then the CLI polls for daemon credentials.

**Device Code**:
High-entropy bearer identifier the CLI polls with. Never shown to the user and never typed anywhere.
_Avoid_: pairing code, token (when meaning this identifier)

**User Code**:
Short 8-character code (shown as `XXXX-XXXX`) the CLI displays and the user types into the portal to approve a specific machine.
_Avoid_: pairing code, invite code, activation key

**Verification URI**:
Portal page (`/device`) where the user enters the user code and approves or denies the grant. No user login in v0; approval alone authorizes the daemon.

**Daemon Registry**:
The persisted record of known daemons, their connection state, and their auth tokens, stored in Postgres via Drizzle.
_Avoid_: device table, worker pool

**Daemon Display Name**:
The user-maintained name shown in the Portal Site and Factory CLI for a Machine-Run Daemon. It is independent of the machine name reported by the daemon and survives reconnects.
_Avoid_: machine name, hostname

**Reported Machine Name**:
The machine label supplied by the Factory CLI when a daemon connects. It describes the current host identity and never replaces the Daemon Display Name.
_Avoid_: daemon name, display name

**Daemon Configuration**:
The Factory API-owned desired settings and annotations for a Machine-Run Daemon, including its display name, Harness Capacity, location, device label, purpose, owner team, tags, and operator notes. A connected daemon acknowledges the configuration it has applied.
_Avoid_: local daemon settings, startup overrides

**Harness Capacity**:
The configured maximum number of harness turns a Machine-Run Daemon may execute at once. Waiting for human input consumes no capacity; queued work starts when a slot becomes available.
_Avoid_: worker count, thread count

**Daemon Connection Session**:
One authenticated lifetime of a daemon's outbound WebSocket. Reconnecting starts a new session even when the stable daemon identity is unchanged.
_Avoid_: daemon identity, login session

**Live Daemon Diagnostics**:
Best-effort raw daemon and Harness traffic visible only while a Portal Site viewer is subscribed during the current Daemon Connection Session. Diagnostics are never durable history.
_Avoid_: audit log, execution transcript

**Deregistered Daemon**:
A daemon whose registry row is retained with `deregistered` status after `POST /v1/daemons/{daemonId}/deregister` (or `cli daemon delete`). Hidden from default lists, force-disconnected, with its old token permanently rejected; returning requires a fresh identity.
_Avoid_: deleted daemon (implies row removal), deactivated daemon

**DTO (Data Transfer Object)**:
Zod schema in `features/<feature>/adapters/inbound/dto/` that owns the wire shape of one request or response. The single source of truth for the API contract; Drizzle rows never substitute for it.
_Avoid_: model (when meaning the wire shape), schema (unqualified)

**Problem Details**:
RFC 9457 `application/problem+json` error body with `type`, `title`, `status`, `detail`, `code`, `instance`. The only error shape the Factory API returns.
_Avoid_: `{ success, data }` envelopes, ad-hoc `{ error }` bodies

**Cursor Pagination**:
Opaque base64url `cursor` paging over a stable order, returned as `{ data, pagination: { nextCursor, limit } }` with an RFC 8288 `Link` header. Default `limit` 20, max 100.
_Avoid_: offset paging (except tiny fixed config lists), client-constructed cursors

**Command**:
Application use case that mutates state and returns a `Result` (`requestDeviceAuthorization`, `approveDeviceAuthorization`, `denyDeviceAuthorization`). Lives in `application/commands/`.
_Avoid_: mutation (unqualified), writer

**Query**:
Application use case that reads without mutating (`listDaemons`, `getDeviceAuthorizationStatus`, `pollForDeviceToken`). Lives in `application/queries/`.
_Avoid_: getter, fetcher

**Project**:
Named absolute path on the daemon machine (e.g. a git checkout). Global workflows are enabled independently for each project. Each run starts from a committed local branch in a separate worktree.
_Avoid_: repo (ambiguous), workspace (unqualified)

**Workspace Path**:
The absolute path of the project’s original checkout; distinct from a run’s retained worktree path.
_Avoid_: relative path, per-daemon override (v2)

**Git Gate**:
Daemon-authoritative check (`git rev-parse --git-dir`) that the workspace path exists and is a git checkout. Failures block runs with typed codes (`PROJECT_NOT_FOUND`, `NOT_A_GIT_REPO`, `GIT_UNAVAILABLE`).
_Avoid_: silent skip, portal-side check

## Workflows

**Workflow**:
A globally defined graph of steps, outcome handoffs, and canvas positions. Projects choose which workflows may start there. The canvas may be empty.
_Avoid_: Flow, pipeline

**Workflow Description**:
A UI-facing summary of what a Workflow is for. It is stored with the workflow definition and never sent to the Harness.
_Avoid_: Activity Description (when meaning the workflow summary)

**Workflow Status**:
The lifecycle state of a Workflow: Draft or Published. Deleted workflows are physically removed rather than represented by a status.
_Avoid_: run status (when meaning workflow lifecycle)

**Draft Workflow**:
A Workflow that is still being prepared and cannot be enabled for a project or used to start a new Workflow Run.
_Avoid_: unpublished run

**Published Workflow**:
A Workflow that has passed validation and is available for project enablement and new Workflow Runs.
_Avoid_: active workflow (when meaning publication)

**Workflow Tag**:
A user-assigned label attached to a Workflow for catalog organization and filtering.
_Avoid_: activity tag

**Workflow Deletion**:
The physical removal of a Workflow definition. Deletion is not a persisted Workflow Status.
_Avoid_: deleted workflow status

**Activity**:
A configured unit of agent work within a workflow, including its name, UI-only description, instructions, execution settings, human input mode, and named outcomes. The portal calls an activity a Step and renders it as a Node on the graph canvas.
_Avoid_: built-in action, document producer

**Step**:
The portal word for an Activity: one node on the workflow graph canvas.
_Avoid_: Activity (in portal copy), stage

**Node**:
One Step rendered on the graph canvas at its stored position. Deleting a node deletes its edges.
_Avoid_: card, box

**Description**:
UI-only step text that never reaches the harness. Instructions are the sole system prompt.
_Avoid_: prompt text, instructions (when meaning this field)

**Human Input**:
Per-step mode: `off` (no questions), `approval` (outcome handoffs may wait for approval), or `input` (the step may interview the user).
_Avoid_: prohibited, allowed, required

**Static Model Catalogue**:
The hardcoded workflow editor harness/model/effort list: harness `codex`, models `gpt-5.6-sol` and `gpt-5.3-codex`, efforts `low`/`medium`/`high` with default `medium`. Runtime daemon capabilities are advertised for execution compatibility, not for portal prompt selection.
_Avoid_: advertised capabilities, daemon-gated models

**Workflow Run**:
One execution of a frozen workflow definition and resolved activity settings for a project, with its own worktree, conversations, and history.
_Avoid_: Flow Run, job

**Cancellation**:
A user-directed request to stop a nonterminal Workflow Run, preventing further activity dispatch and ending the run as cancelled after the daemon has stopped the active work.
_Avoid_: abort, delete

**Cancellation Requested**:
The state of a Workflow Run after cancellation has been requested but before any active work has confirmed that it stopped.
_Avoid_: cancelled, running

**Run Deletion**:
The permanent removal of a stopped Workflow Run and its Factory-owned run history and local execution resources. External Git commits, branches, and pull requests are not part of the deletion.
_Avoid_: cancellation, archive, hide

**Enabled Workflows**:
The project’s allow-list of globally defined workflows that may start runs in that project.
_Avoid_: flow permissions, activity permissions

**Activity Execution**:
One visit to an activity in a run, with a fresh harness conversation. A cycle return starts another execution; a question continues the current execution.
_Avoid_: loop pass, harness turn, recovery attempt

**Harness Turn**:
One exchange with the harness within an activity execution. Questions, answers, progress, and permissions belong to that execution’s persisted conversation.
_Avoid_: activity execution, loop pass

**Recovery Attempt**:
A separately identified, user-authorized attempt to recover interrupted or failed work.
_Avoid_: automatic retry, review pass

**Outcome**:
The explicit named result of a successfully completed activity, used to choose a handoff. An execution error is a separate state.
_Avoid_: prose inference, success/failure node result

**Handoff**:
The continuation from a named outcome to another activity or the end of a run, either automatically or after human approval. The start step is the node with no incoming edges; terminal outcomes end the run; cycles are free.
_Avoid_: tool permission, harness approval

## Documents and human interaction

**Context Document**:
A workflow-named Markdown document with generation instructions and required headings, stored as immutable run-local revisions.
_Avoid_: editable artifact, shared global document

**Document Revision**:
An immutable version of a Context Document, identifying its producer execution and consumed input revisions.
_Avoid_: latest document (when approving or binding inputs)

**Document Binding**:
The exact document revision selected as an input when an activity execution starts. Selection controls supplied context and does not isolate other workspace information.
_Avoid_: workspace isolation, live document reference

**Human Interaction**:
A persisted outstanding question, harness permission, approval, loop decision, or recovery decision associated with an execution.
_Avoid_: blocking model slot, transient dialog

**Publication Approval**:
Approval of exact output revisions and reviewed code content before creating a pull request. A content change invalidates the approval and requires another review.
_Avoid_: Git permission, tool approval

## Execution and delivery

**Workflow Coordinator**:
The sole owner of run progression, consuming persisted commands and daemon facts and producing durable dispatches and human waits.
_Avoid_: Factory API interpreter, parallel interpreter

**Daemon Command**:
A persisted instruction addressed to a daemon with stable command, run, and execution identities.
_Avoid_: best-effort dispatch, portal-reported completion

**Execution Journal**:
The daemon’s durable record of received commands, activity effects, and results used to detect duplicates and reconcile interrupted work.
_Avoid_: transcript, process memory

**Run Worktree**:
The retained branch and worktree created for one run from a pinned committed revision, excluding uncommitted changes in the project’s original checkout.
_Avoid_: project checkout, disposable workspace

**Publication Intent**:
The durable record of reviewed content and the resolved GitHub destination used to reconcile a commit, push, or pull request after interruption.
_Avoid_: publish retry, optimistic PR creation

**Browser Recipient**:
The stable opted-in browser identity selected when starting a run, with a replaceable push subscription and browser-specific management token.
_Avoid_: user account, global notification target

**Notification Record**:
A persisted run notification independent of push delivery, retaining its identity across delivery retries.
_Avoid_: successful push, publication result
