# Independent OIDC claim-gate audit

Static inspection on 2026-09-13 of `/tmp/agents-assemble-lambda-deployment/experiments/deployment-oidc/gate.mjs` and `probe.mjs`. No execution or implementation changes. The primary agent reports successful GitHub run 34769912699; this audit independently evaluates the source and evidence boundaries, not that run's collected output.

## Initial binding gap — resolved by follow-up

The initial review found the gate did not compare the selected effect's approved workflow revision with its verified claimant. **Resolved in follow-up source:** `gate.mjs:52` now rejects when `effect.manifest.workflow_revision !== claims.workflow_sha`. `probe.mjs` seeds a `wrong-workflow` effect with a different approved revision and presents its correct digest with the otherwise valid token; the regression requires `effect-workflow-mismatch`. The primary agent reports this regression passed in GitHub run **34770046279**. This audit verifies the source correction; it did not independently execute or collect that run.

An effect-specific dispatch/run assignment is still separate from this revision check. The gate authorizes its configured trusted job to address any otherwise approved registered effect whose digest/revision matches. That remains a fixture limit, not the previously identified missing workflow-revision comparison.

## Checks that are defensible

- **Cryptographic identity:** fixed issuer and fixed remote JWKS endpoint, RS256 allowlist, required claims, exact scalar audience, key identifier presence, token time checks and explicit expected repository/owner IDs, ref, event, subject, workflow path/SHA, SHA and run/attempt are configured in `gate.mjs:6–20`. The HTTP caller cannot submit `policy.override`; it is used only by the local negative test.
- **Body cannot choose execution identity:** HTTP permits only `effect` and `digest` keys (`gate.mjs:48–49`). Run/attempt passed to the worker come from verified claims (`53–54`), and manifest/environment come from the owner database. The test explicitly rejects a caller-supplied `run` field before consuming the effect.
- **Digest and generation:** the gate compares the submitted digest to stored digest, and the existing worker rechecks the stored manifest under its environment/effect lock, including expected generation. Changes between the gate read and worker lock therefore fail the worker's manifest comparison. The OIDC probe exercises digest substitution, while the separate authority fixture provides generation-substitution/ABA tests. Do not describe this OIDC run as independently exercising all generation scenarios.
- **One-use claim:** the concurrent HTTP calls expect one 201 and one 409, then replay is denied. The database assertion checks exactly one claim outbox entry and the verified run/attempt in the effect. This is one effect's durable consumption, not globally one-use JWT semantics; the same valid token can address another approved effect permitted by the gate.
- **Revocation:** the test revokes a separately seeded effect before the authenticated claim and requires `authority-closed`. This establishes pre-claim local authority rejection despite a valid token.

## Bearer handling

No raw OIDC token or issuer request credential is deliberately printed, placed in the worker command, or saved in observations. `mint` retains tokens in memory and reports only a generic issuer failure. The gate returns only an allowlisted claims object; authentication failures emit generic rejection entries. Worker environment construction permits only PATH and PostgreSQL connection coordinates, excluding the GitHub OIDC request credential. Worker commands contain stored fixture manifests and verified identity only, so the existing owner journal does not acquire the JWT through this path.

`probe.mjs` emits allowlisted claims, results, source hashes and database snapshots. Those fixture manifests have no live secrets. The emitted `aud` is a correlation value, not a bearer token. I found no source path that leaks the bearer in a successful run. This static finding should be paired with the primary agent's scan of actual logs/artifacts; it does not prove process-memory or hostile same-host isolation.

## Remaining limits to retain

1. Client, verifier and PostgreSQL are co-resident in one trusted job; verifier policy derives from that job's environment. The probe demonstrates real GitHub issuer authentication, not an independent trusted server that a malicious runner cannot change.
2. Approvals and staging receipts are seeded. There is no authenticated human approval flow, deployed authority service, AWS credentials, AWS operation, automatic restoration, or remote uncertain-provider reconciliation.
3. Negative repository/owner/workflow/run tests use a genuine token against altered verifier expectations. They do not mint tokens from actual different repositories or workflows. The wrong-audience case does mint a second real token, and the tampered-payload case modifies a token without its signature.
4. Token time is validated when the gate begins handling the request, before reading its body and before database claim lock acquisition. Expiration during a later wait is neither rejected by a second JWT check nor exercised here. The owner separately checks approval expiry after lock. State explicitly whether the intended contract requires token validity at request authentication or at claim consumption; this fixture proves the former.
5. No HTTP lost-ack/crash barrier is present in these two files. Post-commit crashes are exercised by the separate authority fixture. Likewise, this run does not exercise real rerun attempts; it rejects a mismatched attempt policy and repeats HTTP requests from one actual run attempt.
6. The catch at `gate.mjs:57` maps worker/internal failure to HTTP 400 `invalid-request`, potentially obscuring an uncertain committed worker result. One-use durable state still prevents a second claim, but that error path and its recovery are not tested by this run. Production handling needs a distinct uncertain/internal outcome rather than inferring no claim from 400.

Defensible summary: real signed GitHub identity was connected to a controlled local durable claim boundary, including digest substitution, identity-field injection, duplicate request and revoked-authority checks. It is meaningful progress beyond unauthenticated run-ID labels. The follow-up additionally binds the selected effect's approved workflow revision to the verified token. Effect-specific dispatch assignment and the live Integrations-to-AWS authority bridge remain outside this fixture.
