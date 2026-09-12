# Protected observer: pending native experiment

Date: 2026-09-12 · Decision [#11](https://github.com/09millarda/agents-assemble/issues/11) · Map [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Current status

**Unresolved: the native experiment requires an administrative environment.**
This session claimed #11 before investigation. The read-only prerequisite probe
found Linux `7.0.0-31-generic`, systemd `259.5-0ubuntu3.4`, cgroup v2 and an installed
Codex executable. `sudo -n true` failed with `interactive authentication is required`.
No protected observer, additional user, system service, native writer or receipt
service was created. No account credentials were accessed or copied.

The [probe source and complete prerequisite observations](https://github.com/09millarda/agents-assemble/tree/3546b65/experiments/protected-observer)
are archived separately at `3546b65` on `codex/prototype-protected-observer`.
The recorded source SHA-256 is
`621acf121ab41af98b22236093a313562da1104e3d6b1127355d676bbff28351`.
The probe ran successfully as a prerequisite recorder; its result explicitly
reports `conformance_passed: false` and lists all unexercised acceptance areas.

This is a missing prerequisite, not a rejection of protected-observer feasibility.
The [source comparison](protected-observer-sources.md) recommends which profile to
test; it does not establish that profile's native compatibility or protection.
[ADR 0005](../architecture/0005-native-writer-supervision.md) and
[ADR 0006](../architecture/0006-enrolled-runner-authority.md) remain unchanged.
Automatic takeover remains ineligible without their independent recovery gates.

## Environment needed

Use a disposable Linux/cgroup-v2 host with a working systemd system manager,
administrative access for a bounded test service and protected directory, and
Codex already installed and authenticated under its intended ordinary OS user.
The host administrator is trusted. A native tool sharing that user's UID is the
untrusted workload; placing observer files in the user's home with mode 0600
does not separate them. Do not acquire or copy native model credentials to the
observer identity. The administrator provisions the boundary; the harness uses
its existing account directly, as required by
[ADR 0001](../architecture/0001-control-plane-and-runners.md).

Before a native run, record the exact system service, executable ownership,
directory ownership/modes, native UID/groups, effective capabilities, cgroup
ownership, manager/API permissions and bounded cleanup policy. A cached sudo
authorization is an execution prerequisite, not evidence of a protected profile.
Any administrative capability still available to the workload must be exposed
as a limitation or denied and measured before claiming isolation.

## Proposed experiment and acceptance records

These are planned observations, **not passing test results**. Compare at most two
profiles in the source note; exercise the distinct-principal reference first.

| Case | Evidence to retain | Required interpretation |
| --- | --- | --- |
| Credential and journal boundary | Actual harmless native-UID attempts to read/use a toy service key, replace or modify the journal, access protected process descriptors/memory and alter trusted executable/configuration paths; OS results and effective policy | Test each relevant path. Separate processes or a fixture trust flag are insufficient. |
| Observer request authorization | Workload requests for an arbitrary invocation, scope path, operation digest and receipt payload, including a valid identifier belonging to another grant | Observer derives scope from its protected authenticated grant journal. It must not expose an arbitrary attest/sign interface. |
| Native account compatibility | Native harness initialized as the existing account user, with a harmless tool writing only in a disposable workspace | Preserve native login. Do not count a stand-in subprocess as harness evidence. Retain sanitized identifiers/events, never account files or tokens. |
| One bound launch | Service-granted deployment/organization/runner, journal incarnation, run/occurrence, assignment/generation, invocation/admission/input digest, original manager activation and retained payload binding | Durably journal intent before launch. A lost acknowledgment cannot create another native invocation. |
| Stop and observer restart | Known writer observed in the exact payload; stop gate durably closed; reporter killed at a recorded barrier; recovered original handle/binding; actual terminal observation; immutable receipt durable before cleanup | Identify every surviving trusted component. Reporter restart with a surviving keeper/manager does not prove loss of all observer state. |
| Lost observation object | Original object deleted or unavailable, and a separate case with an empty same-name replacement; captured read errors and manager identities | Missing/recreated objects leave `scope_unknown`; path, inode number, unit name or boot string alone cannot recover a terminal fact. |
| Journal discontinuity | Missing, corrupt and restored older journal, including a rollback newer than the last service-acknowledged sequence | Fail closed where continuity is unproved. A matching sequence cannot certify local-only history. |
| Receipt and lost acknowledgment | Original canonical receipt, real mTLS peer identity, server authorization/verdict and exact replay after observer restart | Exercise the ADR 0006 contract with the actual observer. Earlier independent TLS and cgroup experiments do not prove their composition. |
| Coverage challenge | Explicit inventory and harmless escape attempts for alternate user services, cgroup migration, privileged/container sockets, external executors and other available writer capabilities | A protected observation of one empty payload remains scoped unless every writer capability is accounted for. Unknown remote effects and checkpoint verification remain separate. |

For the stop/restart case, test a crash before receipt persistence and a crash
after durable persistence but before acknowledgment. If using a descriptor store
or separate keeper, record exactly who retains the original handle, the recovery
authentication, and the failure behavior when that keeper or stored handle is
lost. Validate effective retention settings and actual cgroup read behavior on
this runtime. Do not treat proposed systemd settings as measured continuity.

Keep complete sanitized state snapshots and source hashes at the crash barriers.
Separate native/OS observations, authenticated service observations and controlled
protocol fixtures in the report. Record the known probe processes and clean up
only those processes and their disposable resources after retaining evidence.
Do not count cleanup success as a historical stop receipt.

## Resume and completion

Rerun the archived read-only preflight when an environment is available. Then
build the smallest native fixture on the separate prototype branch, use a
loopback service with disposable credentials, and execute the cases above.
Keep #11 open while required cases are unproved. A conservative fallback may
record scoped observations while retaining automatic takeover ineligibility;
it must be based on observed limits, not merely unavailable sudo access.

Only after the evidence supports a verdict should the session create an ADR,
post a resolution, close #11, update `Decisions so far`, and graduate any sharp
new frontier question. #15 is outside this session's one-decision scope. The
pending experiment itself creates no new speculative tickets.
