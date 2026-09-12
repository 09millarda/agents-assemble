# Project scope and admission: consistency review

Decision [#18](https://github.com/09millarda/agents-assemble/issues/18) · [ADR 0014](../architecture/0014-project-scope-and-run-admission.md) · [map #1](https://github.com/09millarda/agents-assemble/issues/1).

## Verdict and evidence class

Select the narrow Projects ownership boundary as a planning contract. The owner
asked to skip live AWS setup/validation and continue; this review neither resumes
#15 nor treats its unperformed probes as passing evidence.

One writable repository per run, within a project containing several registrations,
is an explicit agent-selected default. The owner was asked about multi-repository
writes and did not answer during this decision episode. It is amendable and is
not an owner-approved removal of a requested capability. Declared read-only
dependency/context sources remain independently authorized.

This is a source-to-contract consistency review plus **14 documentary failure/
concurrency walkthroughs**. No code, database, provider API, harness or timing
experiment was run. There are no runtime pass counts or throughput claims.

## Existing contracts checked

- [ADR 0002](../architecture/0002-playbook-and-action-contract.md): immutable run
  manifest, distinct occurrence/attempt/effect identities and explicit successors.
- [ADR 0003](../architecture/0003-durable-execution-and-recovery.md): context-local
  acceptance/outbox, retained duplicate/conflict verdicts, unknown effects and
  separate participant receipt versus Execution acceptance.
- [ADR 0006](../architecture/0006-enrolled-runner-authority.md): finite authority,
  ordered policy gates, acknowledged consumer cutoffs and admitted in-flight work.
- [ADR 0007](../architecture/0007-collaborative-drafts-and-revision-submission.md):
  admission cursors matching immutable inputs and explicit proposal/lineage routing.
- [ADR 0009](../architecture/0009-shared-harness-conversation.md): conversation
  targeting and independent continuation holds, without implicit approval.
- [ADR 0010](../architecture/0010-portable-community-publication.md): authoritative
  Catalog checkpoint for the entire package/runtime closure and independent holds.
- [Release contract](../first-release-contract.md) and [domain context](../../CONTEXT.md):
  GitHub feature journey, existing owner boundaries and project ownership gap.

## Independent review and amendments

An independent agent checked the proposed contract against the records above and
identified three concrete gaps:

1. Workspace preparation follows committed admission. A preparation failure must
   leave an admitted run with failed/unknown preparation and retained budget history.
2. Archival cannot settle a permit from a temporary absence or expiry alone.
   Execution must return a durable admitted/rejected/expired-unused verdict,
   serialized with admission and database-time expiry checks.
3. A suspension consumer snapshot is insufficient unless enrollment and scope
   handoff serialize with the suspension decision. New or restarted consumers
   need the current checkpoint before accepting inherited authority.

ADR 0014 incorporates these corrections and the corresponding walkthroughs. It
also distinguishes permit admission expiry from the lifetime of an admitted run,
requires fresh scope permission for a successor, and prohibits carrying a PR
mapping into a different target registration/lineage.

A focused independent recheck found all three repairs consistent and no further
contradiction in those related clarifications. This was a document recheck, not
an independent runtime experiment.

## Remaining qualification

Prove concrete message encodings, authenticated grants/checkpoints, actual durable
expiry/closure races, consumer enrollment/recovery, integration routing and real
provider identity/access changes when implementing these boundaries. The review
does not claim that a shared database transaction, global lease or GitHub setting
supplies those guarantees. Hosting, installer packaging and deferred AWS
deployment/rollback qualification remain separate work on the map.
[#19](https://github.com/09millarda/agents-assemble/issues/19) now captures the
sharp local persistence/failure question exposed by this contract.
