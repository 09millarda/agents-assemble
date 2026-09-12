# ADR 0010: portable community publication and moderation

Date: 2026-09-12
Status: **Accepted — owner-validated policy and architecture contract. No implementation or runtime conformance claim.**
Decision: [#14](https://github.com/09millarda/agents-assemble/issues/14) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)
Prerequisites: [release contract](../first-release-contract.md), [ADR 0002](0002-playbook-and-action-contract.md), [ADR 0007](0007-collaborative-drafts-and-revision-submission.md)

## Decision

Catalog owns private authoring and immutable executable package versions. Community owns deliberate public releases, discovery and social/moderation records. Publishing creates a separately approved public snapshot; it never changes the visibility of a private Catalog aggregate. Import copies a verified, complete dependency closure into the destination Catalog. No registry connection or upstream mutable pointer is needed to execute the imported version.

The owner selected all four policy recommendations: organization-owned packages with delegated invited publishers; withdrawal and reasoned moderation with appeals; locally accepted quarantine advisories blocking new runs and pausing affected work; authenticated public participation with one editable rating per user/package. The owner explicitly validated the complete contract with “yes, looks good” after reviewing the final consensus and this note.

## Ownership and permission boundaries

| Owner | Authoritative records and permissions |
| --- | --- |
| Organization and Access | Local principals, organizations, memberships, delegated publisher roles and hosted invitation eligibility; current operation authorization. A personal organization provides the same ownership model for an individual. |
| Catalog | Private drafts, exact reviewed export candidates, immutable package versions/dependency closures, local imports/forks and local execution eligibility. Read, edit, export/import and public-publish permissions are distinct. |
| Community | Public namespace and release records, approved public profile fields, discovery projection, ratings, comments, bookmarks, reports, moderation and advisories. Moderation does not grant access to private Catalog content. |
| Execution | Frozen run manifests and current admission/continuation decisions. Consumes local package policy changes through its inbox; never treats Community content as an instruction or grant. |
| Knowledge / Environments | Private project artifacts and concrete configuration/secret bindings. These are excluded from public package export. |

An organization admin manages local publisher roles. Public hosted publication additionally needs a current pilot invitation for the publishing principal and an eligible organization. Ordinary membership, authorship, a public URL, import authority or a moderator role alone cannot publish. A publisher acts for the owning organization; preserve the publishing actor and contributing authors separately from ownership. Collaborators need explicit private package access; an unrelated organization receives no private metadata or existence disclosure.

Public profiles expose only deliberately selected display fields. Do not enumerate private membership, emails, private package counts or private project links. Store immutable principal/organization IDs for attribution; current display names may change without rewriting who acted. No ownership transfer is implicit in leaving an organization or renaming it. Cross-organization transfer is deferred: use an authorized fork with provenance.

Local/self-hosted catalogs require local access policy, never a hosted invitation or WorkOS account. Contacting the hosted public service subjects public contributions to that service's identity and moderation rules. This selects no edition restriction or software license; #5 retains that decision.

## Package identity and portable content

Identify an origin by its issuing deployment/registry ID, organization ID and package ID. Display slugs and URLs are mutable locators, not identity or authorization. A public release has its own Community identity and an immutable mapping to an approved source version, content digest and closure digest. Keep private source identifiers only in authorized internal records; exported provenance uses approved public origins or an opaque export origin. The issuing Catalog allocates and retains that opaque origin for the package across repeated exports and authorized transfers; changing a URL or requesting another export never resets it. Unknown foreign claims remain unverified rather than acquiring trusted issuer status.

Apply the public/private boundary throughout definitions, dependency references, changelogs and `derivedFrom`, not only the outer envelope. Private provenance stays in an access-controlled internal source mapping. If redacting identifiers or replacing references changes executable/content bytes, create a distinct public candidate with its own digest, revalidate its semantics and full closure, and obtain exact approval. Never claim redacted bytes have the source digest or silently alter an already published/imported artifact.

Separate author version label, format version and content digest. One origin/package/version label binds exactly one digest; same identity and bytes replay, different bytes conflict. A digest shared by two origins does not establish a common author, license or right to redistribute. A registry URL or claimed signature is not verified publisher identity. Exported attribution states its verification level; offline imports retain claimed origin without manufacturing trust. Cryptographic signing and issuer trust distribution remain to specify.

The portable envelope contains a manifest, immutable definitions, declared instruction/resource files, supported schemas, exact dependency bytes/digests, runtime capability slots, permission requirements, changelog, attribution and license/notice metadata for every component. Include an inventory of paths, sizes and digests so an importer can verify the complete reviewed closure. Concrete canonical encoding, archive format and parser limits remain subsequent contract work; transport compression does not define semantic identity.

Exclude project artifacts, run history, harness transcripts, hidden authoring history, environment values, secret-provider paths, credentials, deployment connection IDs and private profile data. Logical runtime/secret requirements may travel, but local bindings and values do not. Publication exports only explicitly selected files from an allowlist. Show the exact bytes and transitive inventory for approval; scanning is supplementary and cannot prove arbitrary prose contains no confidential material. Never recursively publish a workspace or fetch resources from author-supplied URLs during admission.

Every included component must have recorded permission for the intended redistribution and be explicitly approved in the public candidate, including dependencies already publicly obtainable elsewhere. Public availability is never an exception to this check. Missing license metadata or unclear redistribution permission blocks public release pending resolution. Internal private export still requires its owner's authority and applicable component permissions. This is a product gate, not a legal verdict or selection of license terms. Preserve notices on import/fork; a visibility toggle supplies no rights. Real starter-package distribution remains dependent on #5 and applicable third-party terms.

## Publication and withdrawal lifecycle

1. An authorized editor authors privately and publishes an immutable Catalog version under ADRs 0002/0007/0008. This local publication does not list anything publicly.
2. An authorized publisher requests a public candidate. Catalog validates the full closure, separates public fields/files from private state and retains exact bytes, digests and required rights/notice declarations. Later edits produce a different candidate.
3. The publisher reviews the exact public preview and approves its candidate ID/digest, owning organization, destination namespace and intended version. Persist a publication intent and outbox record. Approval of one candidate cannot publish a later draft or expanded closure.
4. Community validates the durable Catalog candidate through its port, verifies current scoped publication authority and invitation, and reserves the namespace/version in its own transaction. Copy/verify candidate bytes into private staging before making a release public. Persist the visible release and its discovery outbox event only when the complete approved content is available. No distributed transaction spans Catalog and Community.
5. A stable publication operation ID resolves retries across both owners. Same operation/payload returns its receipt; changed payload conflicts. Concurrent publishers racing on one version cannot overwrite it. Missing acknowledgment reconciles against Community's canonical operation; it does not mint another release identity.
6. A discovery projection eventually indexes only publicly active releases. Public metadata and blob reads recheck canonical visibility; stale search entries cannot authorize a download. Private staging is never accessible through public URLs. Explicit cache invalidation accompanies withdrawal/quarantine; already delivered bytes cannot be recalled.
7. New versions are independent immutable releases. An owning publisher may withdraw an exact release or all current releases with an expected publication generation and a reason. Withdrawal prevents further public downloads/imports through that registry; a minimal public tombstone preserves identity and status without serving withdrawn content. Existing authorized local copies and historical pins remain unchanged.

Recheck authority at Community's visibility commit under a short, operation-bound grant and a defined revocation cutoff. Invitation or membership revocation before that accepted commit rejects publication; later revocation prevents future operations without rewriting historical attribution. An asynchronous role projection alone cannot establish this cutoff. If the authorization adapter cannot establish current authority/ordering, leave publication pending. Moderator suspension and namespace quarantine are Community-owned gates checked in the same acceptance transaction. Concurrent withdrawal and pending publication must compare the namespace policy generation; a pending operation cannot resurrect a withdrawn/quarantined namespace using stale approval.

Removing a withdrawal is an explicit authorized operation against the current moderation generation; it can restore only the identical retained release after current checks. It cannot clear a moderator quarantine. Deleted or legally unavailable bytes require a new valid release or remain unavailable; never substitute different content at the old identity.

## Import, fork and update

| Operation | Destination behavior |
| --- | --- |
| Preview | Display complete definition/dependency/permission inventory and provenance without executing author code or resolving secret values. Treat rendered Markdown and resources as untrusted content. |
| Import | Verify the complete envelope and component rights/notice metadata; stage and atomically register an immutable local copy in Catalog. Preserve original origin/digests and record the local importer. Partial, corrupted, unsupported or conflicting content is rejected. |
| Fork | Create a new locally owned package identity and editable draft with explicit `derivedFrom` origin/version/digests and notices. No upstream ratings, publisher invitation or verified-author badge transfers. |
| Update | Explicitly import a chosen new version, review changed closure/permissions and select it for future runs. Existing pins remain unchanged. No subscription silently follows `latest`. |
| Execute | Choose local runtime/environment bindings, inspect actual enforcement capability and obtain local admission grants. An import, rating, signature or public publication grants no execution authority. |
| Export without registry | An authorized local user exports a complete permitted closure. A second disconnected installation verifies and imports it without contacting the origin, requiring the same local binding/grant review. |

Import preserves immutable original definitions; local bindings are separate records. Editing imported content requires a fork/new local version, not mutation of the original digest. If one source identity/version arrives with different bytes, surface an origin conflict even if the caller changes its download URL. Private transfer creates an authorized destination copy and does not invite the receiving organization into the source organization. Public provenance cannot expose private fork sources without explicit export approval.

Registry withdrawal prevents new registry retrieval but cannot erase a previously authorized local copy or prevent a permitted offline import. Content-hash integrity proves byte consistency, not safety. A runner with ambient credentials must disclose trusted-runner mode under ADR 0002; unsupported narrow enforcement blocks admission unless local policy explicitly permits that mode. No package-supplied installation hooks execute during preview or import.

## Feedback and moderation policy

| Feature | Accepted policy and architecture contract |
| --- | --- |
| Discovery | Public users search/filter by text, author/organization, tags, supported format/harness and declared capabilities; sort by relevance, recent publication or rating with count. Only active public records contribute. Declared compatibility and rating are not certification. |
| Ratings | One active 1–5 rating per authenticated person/package; edits replace the previous score and retain the reviewed version. Display count with aggregate. Current members of the publishing organization cannot rate it; exclude their prior ratings while that conflict exists. Forks start with no rating. No claim of preventing multiple-account abuse. |
| Comments | Authenticated attributed threaded comments with stable parent IDs. Authors can edit their own comments with an edited marker or delete to a tombstone preserving replies. Moderators can hide content with reasons; authors cannot evade a moderation hold by editing. Private edit/audit history is restricted. |
| Bookmarks | Private per-user set; save/remove is idempotent. Do not expose who bookmarked a package. Retain an unavailable marker if a saved release disappears. |
| Reports | Authenticated users report a package/version/comment/user with category, explanation and bounded evidence; reporter identity and evidence stay private to authorized moderation. Duplicate submission IDs replay; independent reports remain distinct. Reporting alone does not alter public visibility. |
| Moderation | Authorized service moderators may quarantine a release/package, hide comments, suspend public contributions and decide reports/appeals. Record actor, reason/category, target, prior/new state, evidence references and policy generation. Distinguish ordinary withdrawal from a security advisory. |
| Appeal | Affected publishers/commenters may submit a private appeal tied to the decision. Prefer a different moderator; permit a recorded service-admin review when staffing prevents that. No promise of a turnaround time or automatic restoration. |

Public tombstones show a safe reason category and appeal/status information where appropriate, never private reporter evidence, offending payload or confidential identifiers. Community moderation powers do not grant access to organizations' runs/secrets or allow edits to executable package bytes. Moderation uses expected versions and idempotent commands; stale restore/edit operations cannot supersede a newer suspension. Namespace suspension applies to new release acceptance as well as UI controls. Retention and privacy/deletion procedures need a later operational policy; immutable audit means no silent historical rewriting, not indefinite retention of all personal or harmful content.

## Security advisories and local execution

Under the owner-selected Q3 policy, an authenticated advisory identifies the issuer, affected origin/digests, reason, advisory ID and monotonic policy sequence. Catalog verifies the configured authority, rejects stale/replayed changes and records local eligibility plus an outbox event. A gap triggers authoritative reconciliation; it cannot silently clear a quarantine. Untrusted package metadata cannot manufacture an advisory.

Distinguish `received by Catalog` from `effective in Execution`. The local advisory operation is not reported as an applied execution block until Execution commits its durable inbox verdict and the affected policy generation. That transaction is the effective cutoff and is serialized with admission/continuation checks against Execution-owned policy state. A delayed consumer leaves a visible propagation-pending state; mere Catalog receipt is not a stop receipt. Admission includes an authoritative Catalog policy checkpoint for the complete package and resolved runtime dependency closure; an unseen required generation or unresolved history gap blocks admission until reconciled. Work admitted before the effective cutoff remains accounted as already issued work, including a bounded grant still in transit.

At that cutoff, block affected new runs, retries, fresh reconstruction, successor admissions and any expansion of the resolved dependency closure. Gate later dispatch/continuation and queued conversation steering; retain explicit interrupt, status and reconciliation paths. Already issued native/external work retains its uncertainty and recovery obligations under ADRs 0003–0006/0009. A UI pause is not evidence that tools stopped. Active manifests and historical results are preserved; the policy record, not the package bytes, changes.

A local administrator may explicitly allow a specified digest/advisory after reviewing its reason and current enforcement mode; record actor, scope and expected policy version. Execution accepts that override separately under the same admission/policy serialization; a stale override conflicts. Every hold remains independent: allowing advisory A cannot clear advisory B, a policy-history gap, specification review, conversation interruption, ordinary permission failure or recovery obligations. Re-admission requires all applicable holds and grants to be satisfied. A later/new advisory requires new review; an upstream reinstatement does not silently resume paused runs. Ordinary author withdrawal does not trigger this execution block.

Optional public-service connectivity means an offline deployment may not receive advisories. Show the latest successful advisory check and whether this import's origin was authenticated; never label absent data as verified safe. On reconnect, reconcile current policy before new admissions covered by that registry's configured advisory subscription. No hidden hosted dependency is introduced for local packages or already imported offline use.

## Representative command and event boundaries

Names below express contracts, not finalized API schemas. Each owner's acceptance transaction writes only its own state/inbox/outbox. Events carry tenant, stable event/operation identity, aggregate sequence, schema version and causation/correlation metadata. Consumers reconcile gaps and reject payload conflicts; author JSON never becomes a trusted event.

| Flow | Owner acceptance and downstream result |
| --- | --- |
| Public release | Catalog `ApprovePublicCandidate` → `PublicCandidateApproved`; Community accepts `PublishCandidate` after exact content/current authority checks → immutable `ReleasePublished`; Catalog records the public mapping through its inbox. A pending or rejected saga never looks published. |
| Import | Destination Catalog `ImportPackage` validates complete staged bytes and local authorization → `PackageImported`. Community may receive explicit usage telemetry only if separately enabled; importing does not publish destination organization identity. |
| Feedback | Community `SetRating` / `EditComment` / `SetBookmark` accepts current actor/target/version → projection events with appropriate visibility. Public aggregates cannot leak private bookmark or report records. |
| Quarantine | Community `QuarantineRelease` → `ReleasePolicyChanged`; configured local Catalog accepts a verified advisory → `LocalPackageEligibilityChanged`; Execution accepts through its inbox and evaluates affected closures. |
| Appeal/restore | Community records an appeal and a new policy decision; only a current explicit restore changes public availability. Local Execution still needs explicit resume/admission. |

Visibility commits, role revocation cutoffs, blob availability and discovery deletion need integration validation. None is established by this written design. Transport/search/cache implementations remain replaceable adapters.

## Observable acceptance cases

These are design walkthroughs and future conformance requirements, not tests that have passed.

| Case | Required result |
| --- | --- |
| Organization A drafts a package; anonymous user or organization B guesses its ID | No private bytes, metadata, membership or existence disclosure. |
| Invited publisher reviews candidate C; another user edits the draft | Only C can be published with that approval; the new draft needs a new candidate. |
| Public candidate includes a private dependency or secret binding | Block until an explicitly permitted safe closure exists; never silently copy private resources or values. |
| Two different bytes race for the same public version | Exactly one immutable binding can win; the other conflicts and cannot overwrite. |
| Publisher revoked before visibility commit; a stale outbox event arrives | No release without current authority at the defined cutoff; pending approval is insufficient. |
| Namespace suspended while a release is staging | Final acceptance fails its policy-generation check; private staged bytes stay inaccessible. |
| Release committed but acknowledgment lost | Replay/reconcile the original operation and mapping, with no second public version. |
| Withdrawn release remains in stale search/cache | Canonical read blocks new service delivery; tombstone replaces content after invalidation. Previously delivered copies remain outside recall. |
| User imports v1, upstream publishes v2, then withdraws v1 | Imported v1 and existing manifests retain identical bytes; update is explicit, and future registry retrieval of v1 fails. |
| Offline export from A imported by B | Verify complete closure locally, preserve notices/provenance and require B's bindings/grants; no registry lookup or execution hook. |
| Missing dependency, unsupported format, unsafe archive path or digest mismatch | Reject import before registering an executable package; bounded parsing never writes outside staging. |
| Contributor edits a rating twice / joins publishing organization | One score contributes; publisher-conflicted ratings are excluded. |
| Comment author deletes a parent / edits a moderated comment | Replies retain a tombstone parent; author editing cannot clear the moderation state. |
| Report submitted and appeal decided | Evidence stays private, actions have reasons/attribution, and stale restores cannot override newer policy. |
| Received quarantine races a run admission or active tool | Apply local cutoff and continuation policy; preserve already-issued work and its unknown outcomes instead of claiming cancellation. |
| Override A races advisory B, an interrupted conversation or a successor admission | Compare the current policy generation; retain every unrelated hold and gate the exact successor/dispatch. Interrupt and reconciliation remain available. |
| Re-export redacts a private source ID or changes a registry URL | Stable export origin survives locator changes; altered public bytes receive a separate validated/approved digest and private source mapping. |
| Offline consumer lacks an advisory / gets an old reinstatement | Display freshness limitations; old policy cannot lift a received newer quarantine. |
| Untrusted imported package requests credentials or broader shell access | Import grants nothing; current local permission and enforcement checks determine admission. |

## Remaining work and decision validation

The owner selected the recommendations for Q1–Q4 and explicitly validated the final consensus with “yes, looks good.” This session resolves only #14. An independent read-only architecture review identified four gaps: advisory cutoff, independent continuation holds, ambiguous redistribution wording and stable redacted provenance. The accepted contract makes each requirement explicit. Local Markdown target and whitespace checks passed. This is document review and design walkthrough evidence, not executable conformance. No live registry, API, storage/search service, legal terms or production tests are delivered by this decision.

The sharp follow-up is [#17, portable envelope and verifier conformance](https://github.com/09millarda/agents-assemble/issues/17): canonical bytes, component inventory, parser/resource limits, origin verification and safe import/export across two installations. Broader discovery ranking, abuse operations, retention, private federated registries, ownership transfers and production service implementation remain fog until their requirements are sharp. License/parity selection remains #5; runner observer trust remains #11; deployment recovery remains #15.
