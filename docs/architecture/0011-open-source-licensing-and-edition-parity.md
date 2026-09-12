# ADR 0011: open-source licensing and edition parity

Date: 2026-09-12
Status: **Accepted — owner-selected policy. The actual LICENSE addition remains a separate reviewable change; this record does not apply the license.**
Decision: [#5](https://github.com/09millarda/agents-assemble/issues/5) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Decision and scope

Select Apache-2.0 for project-owned software, documentation and first-party starter definitions/resources; retain third-party terms. Publish the complete product source with full self-hosted feature parity. Sell managed hosting and support, with hosted per-seat subscriptions after the invited pilot. Use inbound-equals-outbound contributions with DCO 1.1 sign-off, without copyright assignment or a separate CLA. Community publishers retain their rights and explicitly select component terms; publication never automatically relicenses a package.

The owner explicitly selected Apache-2.0, full parity with hosting/support revenue, DCO without a separate CLA or assignment, and open-source public software packages in four structured answers. The policy deliberately permits compliant competing commercial hosts and proprietary forks. Free self-hosting and paid hosting alone would not have distinguished the alternatives below.

## Primary-source comparison

| Option | Principal obligations and tradeoff | Fit for this project |
| --- | --- | --- |
| **Apache-2.0 — selected** | Permissive copyright and contributor patent grants; redistribution preserves the license, relevant notices and change notices, with NOTICE handling where applicable. Does not require publishing downstream modifications. No general trademark grant. | Prefer broad reuse and adoption; monetize operation/support. Accept proprietary forks and competing hosts. |
| **MPL-2.0 — alternative** | File-level reciprocity: distributed covered source and modifications remain available under MPL; separate files can have other terms. Server functionality alone is not distribution, but browser JavaScript delivery is. | Prefer sharing modifications to distributed covered files while allowing proprietary larger applications; does not generally require publication of server-only modifications. |
| **AGPL-3.0-only — alternative** | Strong copyleft with distribution requirements and a source offer to remote users of a modified network-interactive version. Corresponding Source includes necessary build/install/run material within the license's defined scope. | Prefer reciprocity for modified hosted versions; accept more demanding combination/distribution analysis. Competing commercial hosting remains permitted. |

Sources checked 2026-09-12: [Apache license, §§2–6](https://www.apache.org/licenses/LICENSE-2.0), [Mozilla FAQ, Q8–17](https://www.mozilla.org/en-US/MPL/2.0/FAQ/), [MPL license and OSI approval](https://opensource.org/license/mpl-2-0), [AGPL license and OSI approval, §§1–6 and 13](https://opensource.org/license/agpl-3.0). The AGPL alternative considered exact version 3, without an automatic grant under future versions.

All three are open-source choices and permit commercial use. A ban on competing hosts or commercial use is inconsistent with the unrestricted commercial-use direction in the [Open Source Definition](https://opensource.org/osd), especially clauses 1 and 6. The selection is a product judgment from those tradeoffs; it does not establish compatibility of unexamined dependencies.

## Edition contract

Parity compares the same released version and supported capabilities. Operating cost, capacity, third-party availability and release qualification remain distinct from feature entitlement.

| Area | Shared product behavior | Deployment-specific behavior |
| --- | --- | --- |
| Software scope | Publish service, workers, CLI/daemon, web/graph editor, SDK, integrations, identity/billing adapters, community implementation, deployment templates and first-party starter packages under the selected project terms. | Live credentials, private production configuration and customer data are not source-distribution contents. |
| Execution and collaboration | Same playbooks, actions, harness adapters, durable recovery, approvals, Markdown/graph collaboration, conversation and artifact capabilities. | Operators supply capacity and compatible external services; actual recovery/capability gates still apply. |
| Organization and security | Same organization roles, access controls, audit capabilities and supported identity integration features. No paid-only SSO, security or collaboration module. | Hosted uses WorkOS initially. Self-hosted/local has supported authentication independent of WorkOS, preserving authorization; exact provider/installer remains to specify. |
| Seats and billing | No self-hosted license key, subscription check, seat cap or product-imposed paid run/runner quota. Local operators may configure resource limits. | Hosted per-seat billing, invoices and service quotas concern the managed service. Stripe is disabled/replaceable locally and cannot gate core self-hosted behavior. Paid subscriptions remain deferred in the pilot. |
| Community | Same catalog and community software, including discovery, publishing, comments, ratings, bookmarks and moderation. Self-hosted operators can operate their own service. | Hosted public registry has its own invitations, identity, moderation and capacity rules. Parity does not promise a copy of its user database, social graph or permission to redistribute its entire corpus. Federation remains undecided. |
| Package portability | Complete permitted dependency-closure export/import, preserved terms/provenance and explicit local binding/grant review; no registry account, subscription or origin connection required for previously imported local use. | Connecting to a public service subjects contributions to that service's rules. External Git, model and deployment services retain their network/account requirements. |
| Data portability | Authorized export of owned definitions, versioned documents/artifacts, retained run history and relevant approval/audit records in documented machine-readable formats. Include an inventory and report unavailable/redacted records. Export remains available during the defined retained-data period after hosted suspension. | Secrets are rebound, not exposed in general exports; private data exports are separate from public package publication. Identity mapping, retention windows and safe restore schemas remain to specify. Historical export does not transfer live execution authority. |
| Commercial offering | Same software feature set. No proprietary product extensions or deliberately delayed self-hosted feature release. | Charge for hosting capacity, managed operations, backup operations, upgrades and support. Equivalent operational tooling is published under the selected open-source license; self-hosters supply infrastructure and labor. |

This extends the already approved [release contract](../first-release-contract.md) and [community contract](0010-portable-community-publication.md); it does not change their launch scope or claim implementation readiness. A parity test must use equivalent configured capabilities, never bypass a security/recovery gate to make editions appear identical.

## Contribution and package policy

- Accept contributions under the applicable outbound project/file license. Contributors retain copyright; require DCO 1.1 sign-off certifying the right to contribute. Do not add copyright assignment, a broad relicensing CLA or a commercial dual-license program. The [DCO](https://developercertificate.org/) records contribution-origin assurances and public retention of the contribution/sign-off; it is not a substitute software license.
- Apply the selected project license to project-owned source, documentation, examples and starter-package material only after identifying applicable ownership and existing notices. Exclude third-party material from blanket relicensing. A starter with bundled dependencies carries each dependency's actual terms and notices.
- Public community software packages must declare an OSI-approved software license; documentation/media/resources need explicit suitable terms compatible with the intended redistribution. This is the selected public-registry admission policy, independent of the engine's software license. Publisher-owned packages need not use Apache-2.0.
- Private organization packages may remain private or proprietary. Local use does not confer public redistribution rights; private export still needs authority and applicable permissions under ADR 0010. Software created in customer repositories does not become project-licensed merely because Agents Assemble orchestrated its creation; included source/templates retain their applicable terms.
- Preserve per-component license identifiers or full custom terms where needed, notices, provenance and recorded redistribution permission throughout the closure. Unknown/incompatible permissions block the affected publication/distribution, rather than silently replacing them with a root license. #17 can continue using synthetic allowed/denied/missing-permission fixtures.
- Keep registry service permissions limited to the operations needed for explicit publication and moderation; authors retain rights. Concrete service terms, content-license selection/compatibility rules and branding policy need separate review before public distribution. No publishing UI should promise that a public URL alone grants reuse permission.

## Dependency and distribution consequences

The current tracked main branch contains planning documents and illustrative definitions, with no application package manifest, lockfile or LICENSE. Archived experiment branches are not a production dependency inventory, and locally installed agent skills are not automatically redistributable project assets.

Before a distributable release, inventory exact direct/transitive versions, vendored resources, browser bundles, containers and generated artifacts. Record their terms and required notices/source offers in each distribution. Review the actual linking, bundling and distribution relationship; a TypeScript import, subprocess boundary or HTTP adapter alone cannot establish legal compatibility. Selecting a permissive project license cannot erase dependency obligations.

The rejected MPL alternative would require accounting for delivered browser/CLI code and source availability for covered files. The rejected AGPL alternative would require the applicable corresponding-source offer and required build/install materials, with analysis of adapters and combined works. Under the selected Apache policy, still inspect vendor SDK licenses and service terms individually. Existing native model logins and locally installed harnesses do not grant Agents Assemble redistribution rights to those harnesses or their credentials.

## Observable acceptance cases

These are policy requirements for future implementation/distribution checks, not executed tests.

| Scenario | Required result |
| --- | --- |
| A team self-hosts without WorkOS, Stripe, a hosted account or a license key | Supported local identity and the same product capabilities work; configured infrastructure limits still apply. |
| An operator adds more self-hosted members or runners | No paid seat/runner entitlement blocks the change. Ordinary authorization and capacity controls remain. |
| A hosted-only security/editor/community feature is proposed | It conflicts with this parity contract; deploying a vendor adapter does not justify withholding the underlying capability. |
| A competing provider deploys a modified fork | The project policy permits it under applicable license conditions; no competing-host ban is added. |
| A publisher uploads proprietary software to the hosted public registry | Publication fails the open-source software admission rule. Authorized private local use remains separate. |
| A public package declares Apache-2.0 but bundles a component with missing permission | Publication remains blocked until the complete closure's terms and permissions are resolved. |
| A disconnected installation imports a permitted closure | Preserve component terms and provenance without registry access; require local runtime/environment bindings and grants. |
| A hosted organization is suspended while its records remain within retention | An authorized export path remains available under the defined retained-data policy; no public-package export leaks its private records or secrets. |
| A contributor submits code without permission or a valid sign-off | Do not accept it under the contribution policy; an agent cannot manufacture the contributor's certification. |

## Remaining distribution and specification work

- Add the actual LICENSE and applicable notice/contribution files as a separate reviewable change after checking covered files and attribution. This accepted ADR does not itself apply a software license or retroactively sign off prior contributions.
- Inventory and review production dependencies and release artifacts before redistribution. There is no production dependency manifest yet. Exact SDK/service terms, starter resources and content-license compatibility remain to examine.
- Specify safe organization export/restore formats, identity mapping, retained-data windows and the authenticated suspended-account export path. Public portable envelopes remain #17; they are distinct from private organization backups and cannot migrate live execution authority.
- Define concrete public-service terms, content-license admission rules, branding and operating procedures before public distribution. Actual edition qualification and billing implementation remain future work; pilot subscriptions remain deferred.
- These are downstream obligations, not additional decisions resolved here. No speculative implementation tickets are created.

## Evidence and owner decision

The owner selected the four recommended options: “Apache-2.0 (recommended)”; “Full parity; charge for hosting/support (recommended)”; “DCO; no separate CLA or assignment (recommended)”; and “Open-source public software packages (recommended)”. The [original proposal](https://github.com/09millarda/agents-assemble/issues/5#issuecomment-5648456569) preserves the reviewed comparison and policy detail.

Evidence is repository inspection, primary-source license comparison, owner decisions and local document consistency/link/whitespace checks. No runtime tests, dependency compatibility certification or applied legal grant are claimed. This session resolves only #5. Decisions #11, #15 and #17 remain separate frontier work.
