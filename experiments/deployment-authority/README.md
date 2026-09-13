# Throwaway deployment authority and dispatch experiment

Decision [#15](https://github.com/09millarda/agents-assemble/issues/15). This is archived experimental code, not an application or deployment controller. It extends the earlier real Lambda observations with **separate** GitHub identity observations and a local PostgreSQL/process-fault model. It creates no AWS resources and uses no AWS credentials.

## Reproduce the local experiment

Run `bash experiments/deployment-authority/run.sh` from this scratch checkout with Node 24, Docker, and npm available. For Docker Desktop use `DOCKER_CONTEXT=desktop-linux bash experiments/deployment-authority/run.sh`. The script starts a disposable, digest-pinned PostgreSQL 17.9 container on a loopback-only random port and removes it on exit. Its publicly visible `throwaway` password is only a local fixture credential. The retained `evidence/github.json` supplies two actual GitHub run IDs; the database workers receive them as **unauthenticated local inputs**.

The harness uses distinct database roles/schemas for Execution and Integrations. Seeded approvals are setup inputs, not a Human Interaction implementation. It kills subprocesses with SIGKILL after durable commits, runs concurrent claimers, observes a real database lock wait before expiry, and retains complete state at barriers. `evidence/protocol-summary.json` lists assertions and source hashes; `gzip -dc experiments/deployment-authority/evidence/protocol.json.gz` exposes every command, result and owner snapshot. `node_modules` is ignored. There is no persistent application database.

This durable process experiment intentionally follows #15's crash-evidence requirement and the preceding durable prototypes; an in-memory HTML reducer could not demonstrate database/process survival.

## Actual GitHub observations

The minimal main-branch workflow at `87be475fd628e1f5bb58ce06c55e9616168679ac` had `permissions: {}`, no checkout/action dependencies, no secrets and no cloud calls. It printed only allowlisted inputs and GitHub metadata. It is now disabled. Existing AWS deployment resources remain deleted.

`github-probe.py dispatch` is a historical, **mutating GitHub** probe, not part of the local reproduction command. It sent three requests: two identical dispatch bodies and one request whose response body went directly to `/dev/null`. The success exit code of `gh api` was still visible; this is loss of the returned run details, **not** a network timeout or proof of transport ambiguity. HTTP response headers/status were not captured. The exact API version and received JSON bodies were captured. No returned ID for the third request was retained by the collector.

`github-probe.py collect` recovered candidates from the workflow run list, then queried each attempt and retrieved allowlisted log observations. A separate `gh run rerun 34767353281` produced attempt two. The archived record contains three run IDs and four attempts. Inputs/title equality are correlation, not independent authority. This probe did not gate AWS or verify an OIDC token at a claim endpoint.

## What the controlled model establishes

The executable assertions cover exact manifest substitutions, generation-bound claim serialization, pre-claim approval cutoffs, admitted in-flight completion, durable unknown obligations, context-local receipt/outbox recovery and conflict history, finite rollback authority, complete declared rollback target binding, and A→B→A stale approval rejection. The rollback target fixture comprises code object/version, template and configuration; no secrets are used. A successful rollback receipt leaves the original release failed.

The model **fabricates AWS observations**. No provider query, request/token retry, credential issuance, deployment health sample, automatic rollback or network partition runs here. Exact time/identity records do not make local callers authenticated or fence a malicious actor holding AWS credentials. Full build provenance and production serialization are not qualified. The selected production substrate remains Execution-owned PostgreSQL under ADR 0003.

The live claim-to-AWS authority bridge and its real recovery/cancellation cutoffs remain the next qualification step. The earlier six actual CloudFormation effects are evidence of that provider path, not evidence that this local gate controlled them.
