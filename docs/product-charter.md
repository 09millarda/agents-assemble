# Product charter

Date: 2026-09-12. This records the user's destination and separates fixed requirements from working proposals. It is not an implementation specification. The [canonical architecture map](https://github.com/09millarda/agents-assemble/issues/1) owns decision status.

## Destination

Agents Assemble is an open, extensible engine for the software development lifecycle. Teams define reusable ways of working, delegate work to existing agent harnesses on their own machines, and collaborate on durable plans and execution records. The preferred entry point is a work item or conversation in a service the team already uses. The web UI provides complete standalone operation and a richer planning and editing experience.

The hosted business sells operation of the engine on a per-seat basis. A person or organization can run the engine themselves for free, including on one computer. Users supply and authenticate the machines and coding-agent harnesses that perform the work. Agents Assemble does not build a replacement coding harness.

## Requirements supplied by the user

| Area | Required outcome |
| --- | --- |
| Stack | TypeScript, PostgreSQL, Hono APIs, documented OpenAPI contracts. |
| Deployment | Initial hosted deployment on AWS; portable core and replaceable infrastructure adapters; hosted, self-hosted, and personal-machine modes. |
| Commercial model | Per-seat hosted billing through an initial Stripe adapter; free self-hosted edition; openness is a primary design goal. Exact license and detailed edition parity are undecided. |
| Identity | Initial WorkOS adapter for hosted authentication; self-hosters can replace it. Organization members share access to definitions and executions subject to permissions. |
| Agent execution | An installable Agents Assemble CLI starts a local daemon and an outbound tunnel to the selected deployment. It invokes existing Codex/Claude installations using the user's local authenticated accounts. OpenCode and other harnesses remain adapter targets. Customers provision machines and authenticate their harnesses. |
| Composition | User-defined reusable actions and playbooks, authored as code and through a UI, with harness/model/effort/context configuration. |
| Community | Publish, discover, reuse, version, vote on, and comment on shared definitions and skills. |
| Human collaboration | Briefs, questions, editable Markdown, review, approval, and collaborative work on the same run. |
| Integration | Work tracking such as Linear, Jira, Asana, and GitHub; conversation/notification channels such as Slack, Teams, and WhatsApp. These are adapters, not separate engines. |
| Context | Durable product specifications, discoveries, decisions, and run progress stored in Agents Assemble. Product specifications are Markdown editable by humans and live outside the target codebase. |
| Git | Projects require a repository with an upstream. Use worktrees; support resumption on another eligible daemon using pushed code and persisted context. |
| Environments | Reproducible setup, centrally maintained environment configuration, and secret changes without manually configuring every machine. |
| Architecture | DDD, hexagonal modules, narrow ports, strategy selection at explicit variation points, event-driven collaboration. |
| Reliability | Outbox/inbox, idempotency, ordering with a defined scope, retries, explicit recovery, and orchestrated sagas when multiple contexts participate. |
| Database | One PostgreSQL database initially; each bounded context owns its data and transactions. No transactions across context boundaries. Future separation must be feasible. |

**Execution policy is confirmed.** Users install and authenticate Codex or Claude on their device; the Agents Assemble CLI invokes those installations through its daemon. The harness may use its normal model provider through the user's own account. Agents Assemble hosts coordination and shared context, without providing model credentials or proxying inference. This does not require model computation to remain on-device. See [ADR 0001](architecture/0001-control-plane-and-runners.md).

## CLI and daemon experience

1. The user installs Codex or Claude and completes that harness's normal local sign-in.
2. The user installs the Agents Assemble CLI, selects the hosted or self-hosted service, and enrolls the machine for an organization/project. Service enrollment and harness sign-in are separate identities.
3. The user starts the daemon. It discovers configured local harness executables, checks readiness, and establishes an authenticated outbound tunnel to the selected service.
4. The service assigns work. The daemon obtains context and prepares the worktree/environment, then invokes the selected installed harness under the intended local user identity, using that harness's own authentication mechanism.
5. The daemon relays progress and human requests, delivers authorized answers, and records results/checkpoints. The CLI exposes daemon status, diagnostics, stop/restart, and de-enrollment; exact commands and installation packaging remain to be designed.

The baseline must work with the existing supported account login; an integration path that requires a separate model API key does not satisfy that requirement. Verify account compatibility for each pinned harness control interface. Missing/expired harness authentication should direct the user to the native harness sign-in and resume work after repair. Do not upload or copy model account tokens into Agents Assemble. Running the daemon as a different OS user or isolated service requires an explicit local identity arrangement rather than assuming it sees the user's login.

## Accepted vocabulary

[ADR 0002](architecture/0002-playbook-and-action-contract.md) accepts this vocabulary and the structural contract. Exact production schema field names remain to be validated.

| Term | Meaning |
| --- | --- |
| **Playbook** | A reusable, versioned definition of how a class of work proceeds. Replaces “flow.” |
| **Action** | A reusable unit of work with input/output contracts. Replaces an executable “step.” |
| **Stage** | An optional human-facing grouping of actions, such as discovery or delivery. It does not itself imply execution semantics. |
| **Skill** | Portable instructions and supporting resources that an agent action uses. Kept separate from model/runtime selection. |
| **Runtime profile** | Harness, model, reasoning-effort setting, context policy, and required capabilities applied to an agent action. |
| **Run** | One execution of a pinned playbook version with inputs and a durable record. |
| **Occurrence** | One logical activation of a definition node, including its loop iteration or map item. |
| **Attempt** | One invocation of an occurrence. A retry creates another attempt; a remediation iteration creates a new occurrence. |
| **Human request** | A durable question, review, or approval that may suspend a run and can be answered through an authorized surface. |
| **Artifact** | A versioned result such as a brief, investigation, product specification, implementation plan, or review. |
| **Runner** | An enrolled customer machine/daemon capable of creating workspaces and controlling installed harnesses. |
| **Workspace** | A run-associated Git worktree and its declared execution environment. |
| **Checkpoint** | A durable recovery record tying confirmed code state to artifact revisions and completed work. |

Agent actions consume skills. Human actions wait for input. Integration actions synchronize with other systems. Deterministic actions prepare workspaces or perform checks. A skill format alone is not sufficient to describe these other action types.

ADR 0002 selects structured sequence, choice, parallel-all, bounded repeat and bounded for-each over a fixed body. Agent-generated tasks are data within those boundaries. Arbitrary graph mutation is deferred; no workflow framework is selected.

## Definition ownership and round-trip authoring

Accepted direction in ADR 0002: one declarative, schema-versioned JSON representation underlies UI editing, import/export, API use, and configuration in Git. A local TypeScript authoring API emits that representation; unrestricted uploaded JavaScript does not execute inside the hosted control plane. Semantic round trips are required; reconstructing arbitrary original TypeScript source is not. Exact wire schemas, canonical bytes and TypeScript ergonomics remain to validate.

Definitions carry stable identities, immutable published versions, typed inputs/outputs, pinned skill dependencies, runtime profiles, permission requirements, and bounded retry/timeout policies. A running playbook does not change when its author edits a draft. Updating it needs an explicit migration or a new run.

UI and code authoring must preserve supported features when round-tripping. Unsupported fields must be preserved or rejected visibly. Harness capability validation must reject unsupported settings rather than silently substituting a model or effort. A requested context size is a budget/capability request, not a promise that every harness can change its model's context window.

Portable packages should be exportable and usable without the public community registry. Publication must be an explicit action; it never includes a project's private artifacts, environment values, or credentials. Registry hosting, storage, package signing, and moderation are future decisions.

## Starting playbook: new feature

This is the intended journey. ADR 0002 and its [feature example](examples/new-feature.playbook.md) establish illustrative bounded control flow and gates; first-release selection remains #4.

1. **Intake and planning:** receive a ticket or direct brief, establish the outcome, check sufficiency, and create human requests for missing facts.
2. **Discovery and research:** inspect the repository and relevant sources on a customer runner; persist findings and unresolved questions as artifacts.
3. **Product specification:** produce human-editable Markdown in Agents Assemble. Record requirements, acceptance criteria, exclusions, and open decisions. Resolve questions and record any required approval against a specific revision.
4. **Implementation approach:** describe design, affected areas, work breakdown, validation, and dependencies. This can be composed from user-supplied actions.
5. **Workspace preparation:** select an eligible runner, create a worktree at a known commit, resolve the environment profile, and validate prerequisites.
6. **Implementation:** invoke the configured harness and skill, record progress, and create recoverable code/artifact checkpoints.
7. **Review and validation:** run checks and review changes. Findings can lead to a bounded remediation loop or human request.
8. **Pull request:** push confirmed changes and open or update a PR through an adapter; synchronize the originating work item and notify the relevant channel.

Product specifications remain service artifacts, not files committed into the target repository. A CLI/context API can retrieve selected revisions for the local harness, using ephemeral local material when required. Architecture documents for building Agents Assemble itself can live in this repository; they are distinct from product artifacts generated by the future service.

## Starting playbook: bug fix

1. **Investigation:** examine the report, expected/actual behavior, environment, and evidence. Ask for missing information.
2. **Reproduction:** attempt reproduction on an eligible runner and save commands/results. An unreproduced issue takes an explicit further-investigation or human-decision path; it does not automatically advance as reproduced.
3. **Remediation:** apply a justified change in a worktree and add appropriate regression coverage. Record relevant findings and decisions.
4. **Review:** verify reproduction no longer fails, assess the change and test results, and resolve findings or request human judgment.
5. **Pull request and synchronization:** push, create/update the PR, and update the linked work item with the configured policy.

These are starter packages that users can inspect, adapt, publish, and replace. Product behavior must not depend on hard-coded “feature” and “bug” branches in the engine.

## Interaction model

An inbound work-item event creates or updates a run through the same application commands used by the web UI and CLI. A question has one canonical identifier and state in Agents Assemble, with projections into a ticket, chat, or browser. A linked browser editor provides a better experience when Markdown editing or complex review is required.

Replies must map to an authenticated or verifiably linked organization identity with permission for that action. Being present in a Slack channel or knowing an artifact link is not authorization. Duplicate or competing answers resolve using explicit version/concurrency rules. Automated outbound updates carry correlation metadata so webhook echoes do not create new work indefinitely.

Human edits produce artifact revisions; active attempts record the revisions they actually used. ADR 0002 defaults to pausing dependent work after observing a relevant spec edit, then explicit retain/adopt review. Adoption creates a linked successor run with revised inputs and fresh approvals; it cannot rewrite completed history. Saving a Knowledge revision is not an atomic stop across contexts. These defaults were selected without an owner answer and remain amendable. Browser terminal control similarly needs an explicit controller policy when multiple collaborators attach.

## Launch scope and unresolved product choices

The full destination includes all the named harnesses and integrations. Initial integration order and the first complete demonstration remain pending user preference and a dedicated release-boundary decision. A suggested narrow journey is GitHub Issue → customer-owned Codex runner → editable specification → implementation/review → GitHub PR, with the web UI as a complete interaction surface.

Still undecided: license; detailed hosted/self-hosted parity; first supported operating systems; initial chat adapter; first runnable playbook; merge/deployment automation policy; public-registry release scope; access roles; billing seat rules; and measurable release acceptance criteria. None is silently excluded from the long-term destination.
