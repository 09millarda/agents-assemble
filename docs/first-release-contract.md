# First release contract

Status: accepted by the owner on 2026-09-12 in [decision #4](https://github.com/09millarda/agents-assemble/issues/4), including the consolidated feature boundary, engineering qualification targets and explicit deferrals. The [canonical map](https://github.com/09millarda/agents-assemble/issues/1) indexes the remaining architecture decisions. This is a release contract, not an implementation specification or a claim that the application exists.

## Confirmed scope

- First users: the owner and a small invited team.
- Starting playbook: new-feature delivery, with GitHub Issues and GitHub PRs as the first work-item/source-control integrations.
- Deployment modes: an invited hosted pilot plus documented local/self-hosted installation. Paid subscriptions are deferred; the per-seat hosted business model remains the destination.
- Customer runners: Linux only for this release. Existing native harness authentication and customer-controlled execution remain fixed requirements.
- Live co-editing covers both Markdown documents and playbook graphs, with presence, attributed edits and reconnect recovery. Users explicitly submit a draft revision when it should change an active run's scope.
- A shared harness conversation UI lets authorized collaborators inspect available output/tool activity, submit ordered instructions while the harness works, see delivery status, and explicitly interrupt/redirect it. Messages cannot bypass approval gates. A browser terminal is excluded from this release.
- The visual graph editor and community experience ship in this release: searchable discovery, author/organization profiles, package pages, versions/changelogs, publishing, import/fork, ratings, threaded comments, bookmarks and reporting/moderation.
- Community access includes private organization packages, deliberate public publication, public browsing and invitation-only publishing during the pilot.
- Projects supply their deployment workflow. The starter release policy is human merge, automatic staging deployment, explicit production approval, production deployment, health checks and a configured rollback workflow. The agreed first target is a disposable Hono API on AWS Lambda/API Gateway, deployed through GitHub Actions and AWS SAM.

The owner accepted the harness-conversation recommendation retaining Codex as the first harness on Linux. Exact supported versions and Linux prerequisites must be pinned by compatibility evidence before launch. Prior Codex/Linux probes are experiment evidence, not a supported-version certification.

## Complete journey

An invited member discovers or authors a versioned playbook, edits its graph, configures runtime/environment bindings and starts a new-feature run from a GitHub Issue. Team members collaborate on Markdown planning artifacts, answer questions and talk to the active harness through the web UI. The run obtains revision-bound approvals, implements in a Linux runner worktree, validates and reviews an exact commit, and opens or updates the mapped GitHub PR. After the selected merge/release gates, deployment automation delivers the approved code to configured environments and records the outcome and recovery evidence.

The journey is incomplete if it proves only PR creation. Deployment and the selected collaboration/community behavior must also meet the release criteria.

## Agreed feature boundaries and remaining technical work

| Area | Release behavior | Remaining work |
| --- | --- | --- |
| Live collaboration | Shared Markdown and graph drafts with presence, attributed changes and reconnect convergence. Explicit submission proposes a revision for an active run; published playbooks and approved specifications remain immutable. Agent edits use version-aware proposals. | ADR 0007/#12 selects the bounded Yjs/durable-submission profile. Full graph collaboration/round trips are #16; integrated browser/transport qualification remains. |
| Harness conversation | Shared, attributed conversation for each attempt, streaming available assistant/tool output, questions and answers, and text input while working. Authorized collaborators submit messages through one ordered input stream with visible queued/delivered/rejected status. An explicit interrupt/redirect action is distinct from sending an ordinary message. | Validate actual native input/interruption and reconnect behavior; define permission and delivery-uncertainty handling. |
| Visual graph authoring | Create, connect, configure and validate the full accepted structured grammar: actions, sequence, choice, parallel-all, bounded repeat/for-each and termination. Edit action inputs, runtime profiles and limits; publish immutable versions; preserve semantics through JSON/TypeScript import-export. | No new arbitrary graph-mutation semantics are assumed. Reopening the accepted grammar would be a separate decision. |
| Community | Search/filter/sort discovery; package pages and author/organization profiles; versions/changelogs; preview, import/fork and publish flows; ratings, threaded comments, bookmarks and reporting/moderation. Private organization packages and deliberately public publications coexist. Browsing public packages is public; publishing is invitation-only during the pilot. Imports pin a version and require explicit local runtime/environment bindings. | Resolved by [ADR 0010](architecture/0010-portable-community-publication.md): owner-approved ownership, publication/moderation and portable import policy. Envelope/verifier conformance follows in #17; license/parity is resolved by ADR 0011/#5, with actual license application separate. |
| Deployment | Invoke a repository-owned deployment workflow through a replaceable adapter; bind release intent to exact code/artifact and environment, retain external execution identity and show logs/status. Human merge, automatic staging deployment, production approval, health verification and a configured rollback workflow form the starter policy. Lambda/API Gateway through GitHub Actions/SAM is the first reference target. | Prove workflow dispatch, reconciliation, promotion and rollback contracts. |

Harness messages do not replace artifact revisions, approval receipts or permission grants. Available native output means what the harness exposes through its supported interface; the release does not promise hidden reasoning or unavailable internal state. Lost delivery acknowledgments must remain distinguishable from a message known not to have reached the harness.

Live draft edits do not individually alter the pinned run. An authorized explicit submission creates the revision proposal to which the existing pause-on-observed-spec-edit, retain/adopt and revision-bound approval contracts apply. Submission does not imply immediate adoption or an atomic stop of active work. [ADR 0007](architecture/0007-collaborative-drafts-and-revision-submission.md) selects the bounded submission/observation protocol; production schema, authorization and integrated conformance remain to validate. This refines ADR 0002's save terminology: durable collaborative draft changes and submitting an execution-relevant artifact revision are distinct operations.

## Selected deployment acceptance fixture

The owner selected a disposable TypeScript/Hono service, subsequently choosing this repository (`09millarda/agents-assemble`) and AWS Ireland (`eu-west-1`) for the fixture, exposed through API Gateway and deployed to AWS Lambda by a repository-owned GitHub Actions workflow using AWS SAM. Exercise separate staging and production-like test environments, promotion of the same verified build artifact, a health-check failure and restoration of the previous healthy release. This is the deployment reference target; core behavior and the self-hosted edition remain portable. How Agents Assemble itself is hosted remains a separate architecture question. Resource provisioning belongs to later authorized execution, not this planning session.

Hono documents its Lambda adapter, and AWS documents deploying SAM applications through GitHub Actions. SAM also supports versioned gradual deployment and alarm-triggered rollback. These sources establish a candidate integration path; they do not prove Agents Assemble's deployment/approval/reconciliation contract. See [Hono on Lambda](https://hono.dev/docs/getting-started/aws-lambda), [SAM with GitHub Actions](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/deploying-using-github.html) and [SAM safe deployments](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/automating-updates-to-serverless-apps.html), checked 2026-09-12. Exact workflow invocation, immutable build/approval binding and recovery need subsequent validation; documentation samples are not adopted unchanged.

Hosting Agents Assemble itself on serverless infrastructure is a separate architecture question. Conventional Lambda invocations have a 15-minute execution limit; a long-lived run can still advance through bounded handlers with PostgreSQL-owned durable state and waits. Native harness execution remains on the customer's Linux daemon. API Gateway can own WebSocket connections while Lambda handles individual events, but live co-editing, output delivery and the existing authenticated runner-channel contract require explicit adapter/reconnect/authority validation. The deployment fixture does not silently replace the selected PostgreSQL execution substrate with an AWS workflow engine. See [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) and [API Gateway WebSocket overview](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-overview.html).

## Observable acceptance scenarios

These are requirements to validate, not claims of passing tests. Engineering acceptance baseline: five concurrent collaborators in one organization and two simultaneous feature runs on two eligible Linux runners; a 100-node playbook and 50 KiB Markdown document; connected edit/output propagation at p95 within two seconds under a recorded test network with round-trip latency at most 100 ms. Measure output propagation from event receipt by the daemon, excluding model generation time. After a 60-second browser disconnect, acknowledged collaborative changes must converge within ten seconds of reconnection with no lost acknowledged edits. These are minimum pilot qualification workloads, not maximum product limits or an availability SLA.

The reference compatibility baseline is the locally observed Ubuntu 26.04.1 LTS/systemd/cgroup-v2 environment and Codex CLI 0.153.4 using native login. A release must pin the exact qualified build combination and pass integrated conformance; the existing experiments do not qualify it. Installer packaging remains technical decision work: it must deliver the documented local service/PostgreSQL setup and native-user runner enrollment/lifecycle without making users copy model credentials. No generic all-Linux compatibility claim is intended.

| Scenario | Required visible outcome |
| --- | --- |
| Complete feature journey | A GitHub Issue links to one logical delivery lineage, its approved planning/code records, the mapped PR and a verified deployment outcome. Failure or unresolved outcome cannot appear as successful delivery. |
| Concurrent editing and reconnect | Two authorized users edit the same supported draft concurrently, one disconnects and reconnects, and both converge without losing acknowledged edits. Previously approved revisions remain reproducible. |
| Edit during execution | The UI distinguishes a live draft, an execution-relevant saved revision and Execution's observed pause/adoption state. Changed scope cannot reuse an approval for a different revision. |
| Harness conversation | Multiple viewers see ordered output and attributed input. Duplicate submission does not silently send a second instruction; disconnect exposes delivery uncertainty. A stale attempt cannot receive input intended for its successor. |
| Human questions and approval | An authorized reply resumes the correct durable wait. Duplicate, competing, unauthorized and stale-revision replies receive explicit outcomes; time passing never supplies approval. |
| Graph round trip | A playbook using every supported control-flow construct can be authored visually, exported/imported and republished with equivalent behavior. Invalid connections and unsupported behavior cannot silently publish. |
| Community lifecycle | A user discovers a published version, inspects it, imports/forks it, rates/comments and reports it; an authorized moderator processes the report. Private packages/artifacts/credentials are not exposed by publication. An upstream edit cannot silently change an imported pinned version. |
| Runner disconnection | Accepted history survives reconnect; uncertain native launch/message/effect outcomes pause or reconcile instead of blindly replaying. |
| Checkpoint handoff | A second eligible Linux runner reconstructs from verified Git/artifact inputs only after required writer/effect obligations and new admission are satisfied. Unproved writer coverage produces a visible blocked state. |
| Central secret rotation | A centrally updated logical binding reaches the next eligible invocation without manually editing every daemon. Running invocations have explicit refresh/restart behavior and visible recovery outcomes. |
| Duplicate integration events | Repeated or reordered GitHub events do not create duplicate runs, PRs or deployments; differing payloads under the same operation identity are surfaced as conflicts. |
| Deployment uncertainty and recovery | The UI records the exact release/environment and external operation. Lost acknowledgments trigger reconciliation; failed health verification follows the declared rollback/manual-recovery policy. An unknown deployment outcome cannot trigger an unbounded new deployment. |
| Local/self-hosted installation | On the supported Linux baseline, documented installation brings up the service/PostgreSQL and enrolled runner, uses the existing supported harness login, and completes the release journey without WorkOS or Stripe being mandatory dependencies. External Git/model/deployment services retain their declared network requirements. |

## Portable operation

The existing charter requires portable, versioned packages that can be exported and used without the public registry. The pilot acceptance contract therefore includes an organization catalog and package import/export in local/self-hosted operation, with optional access to the public community service. Public browsing does not grant publication or access to private organization data. [ADR 0011](architecture/0011-open-source-licensing-and-edition-parity.md) resolves #5 with Apache-2.0, full self-hosted feature parity, DCO contributions and open-source public software packages. Charge for hosting/support; no paid-only product feature or self-hosted seat cap is selected. The actual LICENSE addition remains separate.

## Next architecture decisions

The following bounded decisions were graduated from #4 as native sub-issues of map #1. #12 is resolved by ADR 0007, #16 by ADR 0008, #13 by ADR 0009 and #14 by ADR 0010; #15 is closed at the owner’s request after partial experiments and verified cleanup; full deployment qualification is deferred. #14 graduates portable envelope/verifier decision #17. These are not implementation tickets.

| Question | Evidence needed for a verdict |
| --- | --- |
| [#12 — Collaborative drafts and execution revision submission](https://github.com/09millarda/agents-assemble/issues/12) | Resolved by [ADR 0007](architecture/0007-collaborative-drafts-and-revision-submission.md): bounded Yjs/durable acceptance and exact revision submission, with separate Execution observation/adoption. The bounded semantic graph decision is resolved by #16/ADR 0008; complete editor conformance remains open. |
| [#13 — Shared harness conversation and interruption delivery](https://github.com/09millarda/agents-assemble/issues/13) | Resolved by [ADR 0009](architecture/0009-shared-harness-conversation.md): ordered input ledger, exact-turn steering, one-use dispatch and unknown-delivery pause, with separate native and durable evidence. Integrated production delivery/output and release qualification remain open. |
| [#14 — Portable community publication and moderation](https://github.com/09millarda/agents-assemble/issues/14) | Resolved by [ADR 0010](architecture/0010-portable-community-publication.md): owner-approved organization publishing, exact public snapshots, immutable imports, feedback/moderation and independent quarantine holds. #17 validates envelopes and offline verification; license selection is resolved by ADR 0011/#5; application of the license remains separate. No runtime conformance is implied. |
| [#15 — Lambda deployment identity and recovery](https://github.com/09millarda/agents-assemble/issues/15) | [Closed at owner request](research/deployment-local-bridge-closure.md). Earlier real AWS and protocol evidence is retained; the final local bridge was stopped and cleaned up before integrated recovery qualification. No accepted deployment ADR; the deployment feature remains in release scope. |

Installer qualification, full interpreter integration, detailed service schemas and Agents Assemble's own AWS/serverless hosting design remain in the map's broader unresolved work. Their exact tickets should follow the relevant adapter and collaboration decisions, not preselect infrastructure here.

After the owner deferred live AWS setup/validation and requested continued
planning, [#18](https://github.com/09millarda/agents-assemble/issues/18) settled
[project scope and run admission](architecture/0014-project-scope-and-run-admission.md)
independently of #15. Projects owns registration/policy; Execution owns frozen
admission. Multiple repositories per project with one writable repository per
run is the explicit agent-selected planning default, amendable by owner steering.
The documentary review does not certify the integrated release journey.

## Decision record

- The owner explicitly accepted the complete contract with “yes, this is good” after reviewing the final consensus, including the selected serverless fixture, qualification targets and deferrals. This session resolves only #4.
- Technical follow-ups qualify the pinned Linux/Codex combination and installer and settle the contracts above. They do not reopen the agreed feature boundary.
- Preserve #11's separate observer-trust investigation and recovery limits. Deployment automation does not establish complete writer coverage or cancellation of remote effects.
- Decisions #12–#15 capture the collaboration, conversation, community and deployment questions; #12–#14 are resolved, and #14 graduates envelope/verifier conformance to #17. Broader implementation and infrastructure work remains in the map until its prerequisites are settled.

## Deferred or excluded

- Confirmed for this release: paid subscriptions deferred; non-Linux runners deferred; browser terminal excluded.
- First-release deferrals: additional harnesses and work-item/chat adapters, additional certified deployment targets and arbitrary graph mutation. They remain part of the destination or later decision work. The agreed editor/community/conversation features are not deferred.
- Lambda/API Gateway is selected for the deployment reference fixture. Production implementation, application of the selected Apache-2.0 license, concrete editor/transport bindings, graph library and Agents Assemble's own hosting topology remain subsequent work. ADR 0007 selects the bounded Yjs collaboration/submission profile; it does not qualify those implementations.
