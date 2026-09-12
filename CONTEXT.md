# Domain context

Date: 2026-09-12. Constraints below come from the user's brief. Bounded contexts remain a provisional architecture sketch. ADR 0001 settles the control-plane/runner boundary; ADR 0002 settles the playbook vocabulary and definition/execution baseline, retained with #6 amendments. ADR 0003 selects the durable substrate and context-local acceptance protocol using a reduced PostgreSQL fault experiment. ADR 0004 records the customer-daemon receipt/recovery protocol, supported by separate durable-fixture and actual Codex native-account/checkpoint probes. ADR 0005 records conditional Linux writer supervision and scoped stop evidence; full interpreter durability and integrated production adapter conformance remain to validate. Consult the [canonical map](https://github.com/09millarda/agents-assemble/issues/1) and [product charter](docs/product-charter.md).

## Architectural direction

Start with a modular control-plane application and separately deployable workers/runners. A bounded context is an ownership boundary, not a requirement to create a network service on day one. Customer runners are a separate deployment/trust boundary from the start.

The installable Agents Assemble CLI starts and manages the local runner daemon. The daemon connects outward to the chosen control plane and invokes user-installed, already-authenticated Codex/Claude executables under the intended local user identity. Service enrollment and harness authentication are separate; model account credentials remain with the native local harness.

TypeScript domain and application modules depend on domain-owned ports. Hono HTTP routes, persistence, vendor clients, identity providers, billing, messaging, and harness control implement adapters at the edge. Domain modules do not import Hono, PostgreSQL drivers, AWS SDKs, WorkOS, Stripe, or harness SDKs. Composition roots choose strategies and adapters; business code does not accumulate provider-name conditionals.

## Candidate bounded contexts

| Context | Owns | Representative collaborations |
| --- | --- | --- |
| Organization and Access | Organizations, membership, role/policy decisions, external identity links | Authenticates principals through replaceable identity adapters; grants organization-scoped access to other contexts. |
| Automation Catalog | Draft/published playbooks, action definitions, skill references, runtime profiles, version compatibility | Supplies immutable definition snapshots to Execution; imports/exports community packages. |
| Execution | Runs, action attempts, authoritative assignments/leases and fencing generations, durable waits, scheduling decisions, execution history, orchestration sagas | Selects eligible runners from Fleet information; pins artifact references; coordinates human requests and integration effects. |
| Runner Fleet and Workspaces | Device enrollment, capabilities, liveness observations, session metadata, worktree/checkpoint metadata | Prepares machines/workspaces, controls existing harnesses through runner adapters, reports work outcomes. |
| Knowledge | Versioned Markdown/artifacts, editing history, durable context references | Supplies revisions for attempts; accepts results and human edits with concurrency checks. |
| Human Interaction | Questions, approval requests, response state, revision binding | Receives authorized replies from web/integration surfaces and publishes decisions back to Execution. |
| Integrations | Connections, external work-item mapping, inbound deduplication, outbound effect/reconciliation records | Translates external systems into domain commands; projects progress, questions, and PR/work-item updates. |
| Environments | Environment-profile revisions, configuration declarations, secret bindings and delivery policy | Provides reproducible bindings to eligible runners without exposing runner secrets to unrelated contexts. |
| Community | Publication, discovery, votes, comments, moderation, package provenance | Publishes explicit Catalog versions; importing a package creates a pinned local reference/copy. |
| Billing | Customer/subscription state, seats, entitlement projections | Consumes organization facts, adapts Stripe events, exposes hosted entitlements without making payment a self-hosted dependency. |

Project identifiers may be shared references, but a project cannot become a shared mutable record owned by every context. Decide ownership of repository registration and project policy when these seams are formalized. The context split above may merge or refine after domain examples; it is not a ten-microservice commitment.

Execution validates its authoritative assignment generation and lease in the same local transaction that accepts an execution transition. Fleet liveness is scheduling input, not an authoritative fence. Commands to other contexts carry scoped assignment grants and are reauthorized according to the effect protocol; no cross-context transaction or stale Fleet projection is used to prove exclusive execution ownership.

## Data and event rules

Each context has its own schema or explicitly owned tables, repository interfaces, migrations, inbox, and outbox. A command transaction updates only that context's records and its outbox. A consumer transaction records its inbox deduplication entry together with its local state changes and new outbox messages. Cross-context transactions, direct writes, shared ORM entity graphs, and foreign-key cascades are disallowed. Cross-context read models are maintained by events or queried through public interfaces; joins do not become hidden domain coupling.

Use at-least-once delivery with idempotent consumers. Persist a stable event/message ID, organization ID, source context, aggregate ID/version, schema version, causation/correlation IDs, and creation time. Consumers track the source sequence when their behavior needs ordering and reconcile gaps. Ordering is scoped to a source aggregate or run stream where explicitly guaranteed; no global event order is assumed.

Commands carry idempotency keys and expected versions when concurrency matters. Idempotency is scoped to tenant and operation, with payload-conflict behavior defined. A retry does not mean repeat every side effect: preserve logical operation identity while distinguishing attempts. Timeouts create an unknown outcome where needed; they are not proof an external action failed.

Execution owns a persisted saga/process manager for operations spanning contexts, such as preparing a workspace and then dispatching work. Participants perform local transactions and emit outcomes. The orchestrator records progress, deadlines, retries, compensation requests, and manual-recovery state. Compensation is a domain action, not a database rollback; a published PR, comment, or user-visible message may require reconciliation rather than deletion.

Read models can lag. Security-sensitive operations use current authorization or explicit bounded grants, rather than treating a stale membership projection as indefinitely valid. Define deletion, revocation, and retention propagation before enabling those operations across contexts.

## Portable deployment sketch

| Mode | Control plane | Agent execution | Vendor requirements |
| --- | --- | --- | --- |
| Hosted | AWS reference deployment of API/UI and orchestration/integration workers with PostgreSQL | Enrolled customer-controlled machines | WorkOS and Stripe adapters for the hosted business; user-configured model authentication on runners. |
| Self-hosted | The same core modules under the operator's deployment | Operator/customer-controlled runners | Replace identity/infrastructure adapters; billing not required. |
| Personal machine | Local control plane and PostgreSQL with a local runner; packaging still undecided | Local installed harness processes and worktrees | No WorkOS/Stripe dependency; network needs depend on Git, chosen harness/provider, and enabled integrations. |

The user confirmed the boundary in [ADR 0001](docs/architecture/0001-control-plane-and-runners.md): the local daemon invokes existing harnesses using the user's authenticated accounts. Those harnesses may call their normal model providers directly. Agents Assemble performs no inference or model credential proxying. Compatibility with the existing native account login is an adapter acceptance requirement. The [#8 native probe](docs/research/runner-recovery-conformance.md) verifies Codex 0.153.4 App Server with the existing ChatGPT login under the current Linux OS user and a fresh session reconstructed from verified Git/artifact inputs. Background-service identity, reauthentication, other versions/harnesses/OSs and full adapter integration remain unproved.

[ADR 0004](docs/architecture/0004-runner-assignment-and-checkpoint-recovery.md) distinguishes Execution's admitted grant, the daemon's durable receipt, and Execution's accepted result. Persist launch uncertainty before calling the harness; an uncertain start cannot be blindly replayed. Reconnect reconciles stable identities, and fresh reconstruction requires its declared recovery class and new bounded admission. An actual App Server SIGKILL left identified tool descendants alive, so parent exit cannot settle the local writer obligation. [ADR 0005](docs/architecture/0005-native-writer-supervision.md) selects a bounded Linux reference using retained delegated payload cgroups and exact scoped stop receipts. Native and OS probes validate local observations, while a separate durable model exercises receipt/restart gates. An empty cgroup does not cover a writer launched into another user service: automatic takeover still requires complete writer coverage, trusted receipt provenance, independently reconciled effects and verified checkpoint/fresh admission.

AWS runtime, object storage, secret services, queue services, and infrastructure-as-code tooling are deployment decisions. They must not define the domain's semantics. [ADR 0003](docs/architecture/0003-durable-execution-and-recovery.md) selects Execution-owned PostgreSQL state transitions and context-local inbox/outbox workers. No mandatory workflow service, scheduler library or production schema is selected. An optional Temporal adapter needs evidence that its operating benefits justify the extra boundary; Kubernetes and frontend choices remain open.

## Candidate ports

Examples to make seams concrete, not finalized TypeScript interfaces: `IdentityProvider`, `Authorization`, `BillingGateway`, `WorkItemSource`, `ConversationChannel`, `SourceControlHost`, `HarnessController`, `RunnerTransport`, `SecretResolver`, `ArtifactStore`, `EventPublisher`, and context-owned repositories.

Keep capabilities explicit: work-item systems do not all have identical hierarchy, comments, or transitions; harnesses do not all support the same models, effort knobs, interruption, or session export. Capability negotiation and visible unsupported behavior are preferable to silent approximation.

## Accepted definition and execution baseline

[ADR 0002](docs/architecture/0002-playbook-and-action-contract.md) selects canonical declarative JSON with local TypeScript authoring and semantic UI round trips; immutable package/run manifests; typed agent, human, integration and deterministic actions; and structured sequence, choice, parallel-all, bounded repeat and bounded for-each. Logical node occurrences, invocation attempts and external-effect identities are distinct. Published packages pin static dependencies and runtime-slot requirements; admission pins chosen organization runtime profiles and grants.

Approval binds an exact operation/artifact/code manifest. Relevant specification edits default to pausing after observation and explicit retain/adopt review. Adoption uses a linked successor run starting at entry with verified checkpoint/artifact inputs and inherited external-resource mappings. Completed history is not rewritten. These edit/adaptation defaults were selected during wayfinding without an owner response and remain amendable. The substrate is selected in ADR 0003; schema/wire implementation and actual adapter conformance remain undecided. See the [examples](docs/examples/playbook-contract.md).

## Specification readiness

Decision #6's [conformance report](docs/research/playbook-conformance.md) retains the grammar and makes ordered source edit observations, canonical scope/publication receipts, independent recovery obligations and explicitly admitted successor budgets concrete. The mock model passes 25 authoring probes and 25 runtime scenarios; it does not prove context-local database/outbox transactions, durable timers, leases or real harness behavior. The separate [#7 fault experiment](docs/research/durable-execution-conformance.md) exercises reduced context transitions with real PostgreSQL, context roles, process death, concurrent commands and database restart. This supports ADR 0003's protocol; it is not full interpreter or adapter certification.

Before implementation tickets, validate the integrated definition/execution contract, settle the first release boundary and license/parity policy, and prove the smallest harness-to-human-to-checkpoint journey. #8 supplies separate native-account/fresh-session and daemon fault evidence; it does not yet connect real native human waits, production Execution, authenticated transport and verified publication. Later decisions must include actual aggregate invariants, command/event schemas, compatibility policy, testable recovery guarantees, and examples of concurrent human/agent behavior. This document preserves the destination while those details remain open.
