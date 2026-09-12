# ADR 0014: project scope and feature-run admission

Status: **Accepted as a planning contract, with one writable repository per run as an explicit agent-selected first-release default. Documentary review only; runtime conformance remains unproved.** Decision [#18](https://github.com/09millarda/agents-assemble/issues/18); [map #1](https://github.com/09millarda/agents-assemble/issues/1).

## Context and decision

Introduce a narrow **Projects** context owning project identity, repository
registrations and project policy revisions. A project belongs to one organization
and may register multiple repositories. Use **one writable repository per run** as the
working first-release default: this is an agent-selected assumption, not an
explicit owner answer. Changing several repositories in one run would require
a separate target-set, multi-PR and partial-delivery contract before admission.
Declared read-only dependency/context sources may reference other repositories
under their own current access checks; they are not additional writable targets.

The initial new-feature journey remains the [release contract](../first-release-contract.md).
Projects supplies immutable scope permission for that journey; Execution owns
run admission, invocation authority and orchestration. Integrations owns external
connections, work-item routing and PR/effect records. A Git URL, project membership
or project permission alone cannot start a harness or authorize an external write.

This is a module ownership decision, not a new mandatory network service. It
avoids both provider-specific project lifecycle inside Integrations and a shared
mutable project record written by every context. Projects introduces another
explicit contract and reconciliation obligation; that cost is preferable to
implicit ownership of the central run scope. Detailed schemas and routes are
subsequent specification work.

## Ownership and vocabulary

| Term / owner | Meaning and invariant |
| --- | --- |
| Project / Projects | Organization-owned coordination scope with a stable identity, lifecycle and explicit policy history. Its name is presentation; it is not the organization, upstream repository or local workspace. |
| Repository registration / Projects | A stable project-local reference to a verified upstream repository identity and a versioned binding. Retains historical bindings when its name, URL, connection or allowed target rules change. It contains no credentials or checkout. |
| Project policy revision / Projects | Immutable project-specific defaults and restrictions, such as permitted repository targets and references to allowed playbooks, runtime profiles and environment profiles. Referenced objects retain their existing owners. Project restrictions may narrow another owner's authority, never broaden it. |
| Scope permit / Projects | Finite, immutable authorization for a reserved run ID and exact project/registration/policy scope. It permits Execution to consider admission; it is not an invocation or integration-effect grant. |
| Run scope / Execution | Frozen project and repository binding, definition closure, policy and input revisions, runtime/environment selections, source baseline and contributing authority receipts. Execution validates it and owns the admission verdict. |
| Delivery lineage / Execution | The logical software-work identity retained across explicitly linked successor runs. It carries references to Integration-owned work-item and repository-specific PR mappings; it is distinct from a single execution run. |
| Connection / Integrations | Authorized provider access and external identity resolution. A connection is not a project and is not transferred between organizations by changing a project reference. |

Organization and Access owns membership, principals and authorization. Catalog
owns definitions, package policy and runtime-profile definitions; Knowledge owns
artifact revisions. Environments owns environment profiles/configuration/secret
policy. Fleet owns runner/workspace preparation. Human Interaction owns questions
and approval responses. Execution accepts their evidence independently through
the rules in [ADR 0003](0003-durable-execution-and-recovery.md).

Project defaults resolve only when creating a candidate. Admission freezes the
resolved revisions; no step follows an unversioned `project.currentPolicy` pointer
to mutate an existing run. Changing defaults affects new candidates. An execution-
relevant change requires the existing revision-proposal/retain/adopt protocol;
authorization restrictions can instead create an independent live hold.

## Repository identity and routing

Keep registration identity separate from the provider's repository identity and
its display locator. An adapter must resolve the upstream identity and current
authorized access before granting the capability to use it. A rename can retain
the registration only after verifying the same upstream identity. A transfer
requires explicit revalidation of owner/access and a new binding revision; it
cannot silently redirect an admitted run. A deleted/recreated repository at the
same URL requires a new registration. Old bindings remain historical evidence.

The same upstream repository may have separate registrations in several projects;
their policy and authorization are independently scoped. There is no cross-
organization existence lookup exposed by registration deduplication. These
registrations do not imply exclusive write access to the upstream repository.
Workspace writers and external effects retain their separate existing gates.

Integrations stores an explicit, versioned inbound route to a project/registration.
An event lacking one unambiguous authorized route cannot choose the first matching
project or start multiple runs accidentally. Deduplicate raw delivery IDs and
the logical start request separately: multiple events for one logical request
return the same admission result. A deliberate new run uses an explicit new
request identity; a linked successor follows Execution's lineage rules.

The initiating repository, one selected registered target and source baseline are
explicit even when the work item originated elsewhere. Source issue/PR comments
are untrusted content; they cannot select an unauthorized repository or connection.
The exact start baseline and subsequently human-merged output are distinct facts.
Each delivery lineage retains its target registration. A different target or
replacement upstream identity requires a new lineage; it cannot inherit the old
PR mapping merely because a project or repository URL matches.

## Admission and participant messages

These are semantic message names, not final APIs. Each participant commits its
own state, duplicate/conflict verdict and outgoing messages locally. No shared
project ORM record or transaction across contexts is allowed.

| Step | Receiver-owned acceptance and result |
| --- | --- |
| `RequestFeatureRun` | Execution durably reserves a candidate run ID and delivery-lineage reference for the tenant-scoped request identity. This candidate cannot execute. Exact repeat returns its prior result; changed scope under the same identity conflicts. |
| `AuthorizeProjectScope` | Projects checks current project lifecycle, registration/binding and policy revision, plus an independently obtained appropriate Organization and Access grant. It issues a bounded scope permit naming the reserved run ID, exact scope digest, policy epoch and expiry, or retains a rejection. |
| `ResolveAdmissionInputs` | Existing owners supply immutable definition/artifact/runtime/environment candidates, validation/capability evidence and finite scoped permission where needed. Knowledge/Catalog supplies the authoritative subscription cursor matching the pinned revisions. Integrations verifies upstream identity and permitted baseline/access; unresolved inputs leave the candidate waiting. |
| `AdmitRun` | Execution atomically checks candidate identity, exact manifest, permits/expiry, its current policy checkpoints/holds, input cursors and bounded budget. It freezes the manifest, records one accepted or rejected verdict, and emits outcomes. It creates invocation grants only through its existing admission rules. |
| `RecordScopeOutcome` | Projects accepts the exact Execution verdict for its permit/run and returns a stable duplicate/conflict outcome. Missing acknowledgment leaves reconciliation work; it cannot issue another run or redefine the permit. |
| `ReconcileScopeExpiry` | Execution serializes with admission, checks permit expiry using its database clock, and returns a durable admitted, rejected or expired-unused verdict. Expired-unused closes the candidate against later admission; an absent row or a temporary waiting result is not a closure receipt. |
| `PrepareWorkspace` | Fleet receives an admitted, scoped request and reports a workspace result. Execution separately accepts it before dispatching an invocation. Unknown native launch/writer state follows ADRs 0004–0006 and 0013. |
| `PublishPullRequest` | Integrations accepts Execution's exact effect intent and resolves its repository-specific mapping for the delivery lineage. Provider uncertainty remains an effect obligation; matching project or work-item names cannot create a second PR authority. |

A permit is usable only for its one reserved run and exact scope. Retrying after
expiry cannot resurrect a rejected admission; a new candidate needs new bounded
permission and an explicit link to the prior attempt. Incomplete input resolution
leaves a candidate unadmitted. Once admission commits, failed or timed-out workspace
preparation leaves an **admitted run with failed or unknown preparation**; retain
its admission and budget history. It does not permit a second admission. The source baseline is fixed
before code execution; branch-head changes are detected and handled explicitly.

Scope-permit expiry bounds initial admission, not the lifetime of an already
admitted run. Later attempts still need their own bounded Execution grants and
all current permission/policy/recovery gates. A successor is a new run and needs
a new Projects permit; project archival does not grandfather successor admission.

Package/advisory admission remains conjunctive with project scope. In particular,
[ADR 0010](0010-portable-community-publication.md)'s authoritative Catalog checkpoint
must cover the full package and resolved runtime dependency closure. Stale or
gapped checkpoint streams keep admission pending. A valid project permit cannot
clear advisory, specification, conversation, interruption or recovery holds.
[ADR 0007](0007-collaborative-drafts-and-revision-submission.md) requires exact
revision/cursor binding; proposals route to explicit run/lineage targets.

## Lifecycle and revocation cutoffs

Use two distinct operations. **Archive** closes new scope permission while
preserving retained history and already admitted work. **Suspend** additionally
requests independent execution holds and stops future affected admission at
acknowledged consumer cutoffs. Neither operation asserts cancellation of an
already-issued invocation or remote provider effect.

Archiving first enters `closing` in Projects and rejects new permits. Permits
already issued can still be presented until their fixed expiry; this bounded
in-flight allowance is deliberate. Do not display `archived` as a completed
admission cutoff until all previously issued permits have an authoritative
Execution outcome or expiry has been reconciled with Execution. Expiry alone
does not establish that the permit was never consumed. If Execution is unavailable,
retain `closing / reconciliation pending`; do not infer non-admission from silence.
Already admitted runs may finish against pinned scope after archival. Show this
explicitly; an operator wanting to stop them must also request suspension.
Execution's closure verdict must be durable and serialized with admission using
database-time expiry checks. A `not admitted yet` read cannot complete archival.
Projects accepts that exact verdict locally; losing its acknowledgment triggers
verdict replay, never a new run or reinterpretation of expiry.

Removing a registration follows the same close-new-permits protocol and preserves
its historical ID/bindings. It does not delete worktrees, PRs or upstream Git data.
Reactivation creates a new policy epoch and new permits; old expired/rejected
permission cannot become valid again.

Suspension increments the policy epoch, stops new scope permits and records the
consumer set that could hold prior permits or effects. Consumers must enroll in
that set before receiving scope authority. Enrollment and scope handoff serialize
with Projects' suspension decision. A new or restarted consumer must install and
acknowledge the current project checkpoint before accepting any inherited permit
or effect authority; suspension cannot be bypassed by joining after a snapshot.
Execution applies the exact suspension
epoch in its local serialized admission/continuation gate, then acknowledges.
Integrations applies the corresponding gate for not-yet-admitted scoped effects.
Duplicate epochs return their prior verdict; gaps require authoritative recovery.
Pending or unknown consumers keep suspension visibly incomplete. An acknowledged
cutoff prevents new admissions at that consumer; earlier admitted work remains
an independently accounted in-flight obligation. This follows the bounded-grant/
acknowledged-cutoff direction in [ADR 0006](0006-enrolled-runner-authority.md).

A restrictive policy revision requires this hold/cutoff path when it must affect
active work. A default edit alone does not revoke pinned permission. Lifting the
project suspension requires a new authorized epoch; it removes only the project
hold. Membership/connection/advisory/runner holds remain independent. Changing
provider access or losing a connection can block future provider operations even
when a run keeps its historical project scope. Credential refresh may restore
the same authorized binding; it cannot silently substitute another repository.

## Concrete consistency cases

These are contract walkthroughs, not runtime tests or measured conformance.

| Case | Required outcome |
| --- | --- |
| Duplicate webhook and manual retry for the same start request | One reserved run/admission verdict; an exact replay cannot allocate another lineage. Conflicting payload returns an explicit conflict. |
| One repository registered in two projects | Explicit inbound route selects one authorized registration; ambiguous routing is held without run admission. |
| Rename or same-URL replacement | Verified same upstream identity may produce a new binding revision. Replacement identity requires a new registration; the old run cannot follow the URL. |
| Project policy edit while a candidate is waiting | Candidate retains its proposed revision; admission needs a still-valid exact scope permit and all current gates. A new target/default is a new candidate, never an in-place rewrite. |
| Archive races with an already-issued permit | Project shows closing. Execution can still admit within the existing permit's lifetime; Projects reconciles that exact outcome before declaring its admission cutoff complete. |
| Execution commits admission but loses the reply to Projects | Replay/query returns the existing verdict. Projects cannot declare the permit unused from deadline expiry or create a replacement run. |
| Expiry reconciliation races with admission | Execution's serialized durable verdict decides admitted versus expired-unused; a temporary absence cannot finish project archival. |
| Consumer starts after suspension or loses its policy state | Apply and acknowledge the current project checkpoint before admitting inherited authority. An earlier consumer snapshot or old permit cannot bypass the hold. |
| Suspension races with a queued effect | Apply the scoped consumer cutoff; new admission rejects afterwards. A previously accepted effect stays separately in-flight until reconciled. UI cannot claim remote stop from the project acknowledgment. |
| Resume after project suspension while a package is quarantined | Project hold may clear; package hold still blocks execution. Old permission epochs remain historical. |
| Workspace prepared but Execution dies before accepting it | Reconcile the exact workspace operation and run scope; preparation alone cannot authorize native launch. |
| Adopt a changed specification | Admit an explicitly linked successor with new budget/permission and required recovery gates; retain the same repository-specific delivery mapping. Do not copy approvals or silently retarget conversation. |
| Connection removed after a PR request may have succeeded | Preserve the unknown PR effect and mapping obligation. Neither new connection nor project reactivation permits blind publication replay. |
| Unapproved second repository requested by an action | Reject as outside the first-release run scope; do not dynamically expand targets or credentials. |

## Consequences and limits

The ownership boundary allows core run/specification work to continue without AWS
access. [#15](https://github.com/09millarda/agents-assemble/issues/15) stays deferred;
its [deployment planning contract](../research/lambda-deployment-plan.md) and
[provider research](../research/lambda-deployment-sources.md) remain provisional.
This record does not certify deployment, exact provider revocation, native writer
coverage, a full durable interpreter or release readiness.

No new runtime code or database schema is introduced. Review of the message and
failure cases is documentary evidence only. Operator-facing project/repository
flows, concrete schemas/encoding, retention and permission-provider implementations
remain specification/qualification work. Multi-repository run admission and
atomic multi-PR delivery are not established by this default.

Independent review identified three gaps: preservation of committed admission
after workspace failure, terminal expiry reconciliation, and consumer enrollment/
checkpoint continuity across suspension. The contract incorporates all three.
The 14 walkthroughs above specify required outcomes; none is a reported passing
runtime test. The owner was asked about multi-repository writes and received the
stated working default without replying during this episode. That default is
amendable and must not be presented as an owner-approved feature exclusion.

The next bounded decision is [#19, project scope permit and suspension conformance](https://github.com/09millarda/agents-assemble/issues/19):
exercise the exact archive/admission and enrollment/suspension races in a local
persistence fixture. It requires no AWS access and does not resume #15.
