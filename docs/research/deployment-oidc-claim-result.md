# Signed GitHub identity reaches a durable deployment claim

Date: 2026-09-13 · [Decision #15](https://github.com/09millarda/agents-assemble/issues/15) · **Bounded authentication result passed; full AWS bridge remains open.**

A real GitHub-issued OIDC token now passes signature and execution-policy verification before an HTTP gate consumes a PostgreSQL deployment claim. This closes the earlier fixture's unauthenticated run-ID input gap within a trusted, co-resident experiment. It does not yet establish an independent controller that gates AWS.

## Actual execution and evidence

[Final GitHub run 34770046279](https://github.com/09millarda/agents-assemble/actions/runs/34770046279) passed seven scenarios using [workflow revision 129fba8](https://github.com/09millarda/agents-assemble/blob/129fba802e6dd55865317eb32cac29e84e63658e/.github/workflows/deployment-oidc-claim-probe.yml) and disposable source `6c845240184ea9217dc45de3278a1ce7b0bdf46f`. The runner used Node 22.23.2, digest-pinned PostgreSQL 17.9, `jose` 6.2.12 and `pg` 8.16.3 with lockfiles. [Sanitized archive and read-only verifier](https://github.com/09millarda/agents-assemble/tree/67695aa9ecb676fd6fec79a87bdbb6850f156a9a/experiments/deployment-oidc).

The workflow fetched pinned experimental code, hosted a temporary PostgreSQL service, and minted tokens for two distinct audiences. The gate fetched public signing keys only from the fixed GitHub issuer's JWKS endpoint and verified RS256 signatures, issuer, exact scalar audience, timestamps, repository/owner IDs, event/ref, workflow path/SHA and expected run/attempt. All caller tokens remained in memory. Logs/evidence contain only allowlisted claims, outcomes and database state. See [source and library verification](deployment-authority-bridge-sources.md).

| Case | Observed outcome |
| --- | --- |
| Real token | Signature, issuer, audience, current timestamps and expected execution bindings accepted. |
| Changed expected execution policy | The same valid signed token was denied when expected repository, owner, workflow, ref, run or attempt changed. These are verifier-policy negative tests, not jobs from other real repositories. |
| HTTP authentication failures | Missing token, a separately minted real token for another audience and a tampered signed payload returned 401. |
| Caller substitution | Changed manifest digest returned 409; caller-selected run field returned 400. Authority remained unconsumed. |
| Approved workflow mismatch | A valid authenticated job presenting the correct digest for an effect approved under another workflow revision was denied; authority remained unconsumed. |
| Concurrent claim and replay | Two HTTP requests produced one 201 admission and one 409 denial. A later replay was denied. Exactly one durable claim/outbox record named the verified run and attempt. |
| Revoked authority | The valid authenticated job received `authority-closed`; signature validity did not override the stored revocation. |

The [initial run 34769912699](https://github.com/09millarda/agents-assemble/actions/runs/34769912699) passed six cases at source `ce9893f` and workflow `a938cc3`. Review then found that global workflow authentication was not separately compared with the selected effect's approved workflow revision. The final run adds that check and its negative case. Both runs and the review are retained; the initial success is not presented as proof of the missing binding.

The probe workflow was disabled after collection. No deployment credentials were issued and no AWS provider operations occurred in these GitHub jobs. Existing AWS fixture resources were not recreated. Separate local STS, EC2 network and public AMI-parameter reads confirmed Proof of Concept access and an available Ireland default VPC/public-subnet candidate. These are recorded read-only prerequisites, not proof of launch capacity, deployment authority or provisioning approval.

## Trust and qualification limits

The caller, gate and PostgreSQL server share one trusted GitHub job. Expected execution policy, accepted production authority and staging receipt are fixture setup. The experiment therefore proves actual issuer/signature validation plus the observed durable transitions; it does not protect against a malicious process sharing that host or implement authenticated human approval. It also lacks a complete effect-specific dispatch registry: the accepted run/attempt policy is set for this particular probe.

JWT validity is checked at request authentication, while product authority is checked under the database lock. Actual token expiration during body/lock waits, key rotation, unavailable JWKS, HTTP lost acknowledgments and an independent controller restart were not exercised. The generic HTTP error path is not a qualified unknown-commit recovery protocol. The reused worker retains its documented rejection-journaling crash gap. These limits must not be inferred away from the seven passing cases.

## Resulting direction

The [candidate bridge contract](deployment-authority-bridge-plan.md) recommends retaining AWS credentials inside Integrations, separated from the GitHub runner, and letting that controller execute only the registered manifest after an authenticated Execution claim. The source audit shows why merely handing ordinary STS credentials to a job after approval does not establish full manifest enforcement: optional narrowing can be bypassed when a broader role is directly assumable, and CloudFormation has its own service-role authority.

The remaining live experiment needs that separate trust boundary, authenticated approval/dispatch handoffs, actual original-operation reconciliation across provider failures and automatic bounded restoration. Trusted merged build, automatic staging and explicit production approval still need to be connected. No accepted deployment ADR follows yet; #15 remains open.
