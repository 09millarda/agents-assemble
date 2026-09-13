# Stopped local deployment bridge experiment

Issue #15 was stopped at the owner’s request on 2026-09-13. This is disposable research source and partial evidence, not a qualified deployment adapter.

Local controller source used: `f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8`. GitHub workflow revision: `3d2359e61d986f0db8ca7218fc8e3251a41a6103`; workflow client pinned to `4219516a302199aa6e08689a66c3aa46cf6d0ebc`. Runtime: local Node 24.21.0, PostgreSQL 17.9, cloudflared 2026.9.1 (binary SHA256 `03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc`).

Two baseline Lambda/API Gateway stacks were created in account 728616601473, eu-west-1. Real GitHub OIDC reached the separate local gateway through a temporary HTTPS tunnel. Three negative runs passed: revoked authority, expired authority, and wrong approved workflow revision. Two staging requests produced one admitted claim and one already-consumed rejection. The first run failed after shutdown; the duplicate was cancelled. The database retained the staging obligation as admitted; it was not relabeled successfully deployed.

At shutdown, the provider intent was still `accepted`, before its possible-create transition. Both AWS stacks independently remained CREATE_COMPLETE with no candidate change sets listed; no candidate update/recovery/automatic restoration is claimed. The owner ended the experiment before those cases ran. Earlier live deployment and controlled recovery results remain separately archived.

Cleanup stopped the gateway, supervisor, worker and tunnel, disabled GitHub workflows, preserved owner/database/provider observations, deleted both stacks and their resources, all three artifact object versions and bucket, and the five fixture roles. It also retired the earlier identity-only probe role. The account-wide GitHub OIDC provider and existing local AWS profile remain. No account/organization setting was changed during cleanup.

The first stack-deletion attempt failed with permission denials immediately after scoped cleanup policies were installed. Read-back showed the required actions/resources; the subsequent explicit retry, without replacing those policies, succeeded. IAM propagation is an inference, not a proven cause. `cleanup-first-failure.json` preserves the failures; `cleanup-verification.json` records independent final checks. Bootstrap likewise needed retries after fresh CloudFormation-role assumption errors. No blanket retry of an uncertain deployment was used.

The PostgreSQL dump/JSON, allowlisted gateway journal, actual run metadata/markers, template/artifact inventory, stopped AWS observations, audit and cleanup checks are in `evidence/`. No JWTs or AWS credentials are included. Runtime paths in source are historical fixture inputs; do not replay provisioning or dispatch commands. Retired main workflows contain a false job guard as well as being disabled in GitHub.

Unproved: full trusted build/human approval integration, live provider-acknowledgment crash recovery, automatic restoration and its interruption, production isolation and complete adapter conformance. There is no accepted deployment ADR. Closure is an owner-requested stop, not an assertion that the original acceptance criteria passed.
