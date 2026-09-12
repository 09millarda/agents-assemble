# ADR 0003: Execution-owned PostgreSQL transitions and recovery

Date: 2026-09-12
Status: **Accepted — PostgreSQL substrate and minimum context-local protocol, supported by bounded fault evidence; full production conformance remains unproved.**
Decision: [#7](https://github.com/09millarda/agents-assemble/issues/7) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Decision

Select a PostgreSQL state machine owned by Execution, driven by application workers behind domain ports. The production application remains TypeScript. PostgreSQL holds canonical transition acceptance, assignment generations, invocation grants, deadlines, waits, recovery obligations and the Execution inbox/outbox. Queue notifications are wakeups; they cannot independently authorize work. Do not add a mandatory workflow service or expose a vendor workflow language in the portable playbook contract.

This selects the substrate and minimum ownership protocol. It does not select a PostgreSQL client, scheduler package, complete schema, production interpreter, hosting package or license. The experiment uses disposable JavaScript workers and the already-selected PostgreSQL; no prototype implementation belongs in main.

The [primary-source comparison](../research/durable-substrate-comparison.md) supports this choice. PostgreSQL directly fits the required local acceptance transaction and is already required in all deployment modes. Temporal offers durable timers and workflow tooling, but still requires domain grants, idempotent effects and a deliberate bridge between its history and application transactions. Keep it as a possible adapter if measured scheduling/recovery objectives justify the operating burden. The inspected Open Workflow Java reference runtime is not a demonstrated durable fit; its persistence and timer evidence does not certify our contract. This is not a rejection of all declarative runtimes.

## Minimum persistence and ownership protocol

An Execution transaction locks or conditionally updates its run/occurrence, validates the message and current version, checks its authoritative generation and database-time lease, charges any newly admitted invocation, and commits state, inbox verdict and outbox together. Persist stable invocation/effect identities before dispatch. Duplicate commands return their prior verdict; the same scoped ID with a different payload conflicts. Rejected commands retain their rejection, so redelivery after a state change cannot silently turn them into accepted work.

Every participant performs the equivalent transaction using only its own records. Human Interaction records an authorized reply and outgoing message. Execution separately accepts or rejects that reply against the current request, version, manifest and deadline. Integrations separately records an accepted publication intent and its effect state. A participant's recorded response and a lagging UI projection are not evidence that Execution accepted the decision. Production inbox identities must include tenant, source and operation scope; the experiment uses one synthetic tenant.

An outbox relay publishes at least once, then marks delivery in a separate producer-owned transaction. It must retain and redeliver after an uncertain acknowledgment. Consumer inbox acceptance and local consequences commit together. Different contexts never share a transaction, even when deployed in the same process or PostgreSQL database. Database roles can enforce schema isolation in addition to application interfaces.

Store absolute wait, retry and lease deadlines and recheck database time after acquiring the relevant lock. A timer wakeup performs another conditional transition; expiration cannot approve a request. Persist accepted fan-out membership and common work consumption; a retry or reconstructed invocation consumes another allowance at admission. Package limits cap admitted grants, and occurrence-specific attempt classes remain part of ADR 0002. Waiting humans hold no runner lease.

## Approval, edits and replacement waits

Approval binds the frozen operation manifest, including relevant spec, commit, policy and delivery scope. Observation/acknowledgment history is separate from that scope: retaining the original spec does not silently approve a new revision or invalidate an already accepted approval for the retained manifest.

If an edit arrives before Execution accepts a response, the stale response remains auditable and cannot approve. After an explicit retain, replace the invalidated unresolved request with a new request ID/version through Human Interaction. Preserve the old request/response history, charge the new human invocation and require a fresh response. Never reinterpret the old answer as approval for the replacement wait.

Order observations on the relevant source stream, not opaque revision names. A future sequence creates a separate event-gap obligation; retaining the newest proposal does not clear it. Production streams must specify whether sequence numbers are contiguous for that subscription and how an authoritative snapshot covers missing history.

## Publication and cancellation

Execution's committed, immutable publication intent is the obligation boundary. It names a stable effect and inherited delivery identity, exact scope and finite grant expiry. A trusted transport delivers that intent to Integrations; production authentication, revocation and adapter receipt provenance require their own protocol proof.

Integrations checks the intent and expiry, persists its accepted intent, then records an unknown outcome before beginning the external attempt. An exact replay of that transition must not become a new dispatch permission. A crash after external success and before receipt commits leaves recovery pending. Reconcile the same effect via provider idempotency or authoritative lookup; unavailable or inconclusive lookup never means safe to repeat. Integration receipt commit and Execution receipt acceptance are separate durable steps.

Cancellation stops future admissions and requests accounting for already accepted work. An intent issued before cancellation may still arrive and execute before its expiry. Neither cancellation nor a newer server fence retroactively revokes a provider request. Cancellation cannot settle while its accepted effect is unaccounted. Definitive proof that an expired intent never executed, and a safe release/reissue policy, remain adapter work; the reduced experiment deliberately remains blocked when proof is absent.

Track workspace uncertainty, unknown publication, cancellation and event gaps independently. Settling a publication cannot reconstruct a workspace or close an event gap. A stopped-writer acknowledgment must name the current assignment generation; stale results and stale stop acknowledgments cannot affect a replacement writer. Verified reconstruction prepares the pinned original input under a declared recovery class; charge the replacement invocation when admitted, once.

## Successors and consequences

Adoption is an Execution-local transaction linking a new run with explicit new admission. It requires a quiescent predecessor and accounted effects/recovery, plus the exact observed proposed revision being adopted. The successor starts at entry with new invocation identities, zero consumed allowance and no copied approvals or completions. It inherits the service delivery identity, so a later publication updates the mapped resource. Preserve original failing baseline and recovered working checkpoint as distinct explicit manifest inputs when the journey requires both.

The team owns the scheduler, interpreter, message lifecycle, history migration and recovery operations. Begin with short local transactions and polling/wakeup workers. Choose fairness, indexes, batch limits, retention and HA from measured release requirements, not this small experiment. Revisit an optional durable-workflow adapter if measured due-work lateness, outbox age, contention or recovery/retention burden exceed agreed objectives.

## Evidence and limits

See the [fault-injection report](../research/durable-execution-conformance.md) for reproducible source, traces, corrections and final results. Real PostgreSQL, separate context roles, killed application processes and a killed/restarted database provide stronger evidence than #6's JSON snapshots. The experiment exercises a reduced set of context transitions, not the entire seven-node interpreter connected to persistence. #6 remains the grammar/authoring evidence.

Production multi-tenant authorization, canonical serialization/signing, package admission, full occurrence accounting, real Git/checkpoint verification, native harness behavior, live providers, database failover, throughput, fairness and packaging remain unproved. The provider, authorization and verified-checkpoint boundaries are controlled fixtures. The next technical frontier is [#8, customer-runner assignment and checkpoint recovery](https://github.com/09millarda/agents-assemble/issues/8); first release #4 is subsequently resolved in the [release contract](../first-release-contract.md); licensing remains #5.
