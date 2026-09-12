# Protected observer native conformance experiment

Date: 2026-09-12 · Decision [#11](https://github.com/09millarda/agents-assemble/issues/11) · Map [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Verdict

**Retain a protected keeper/reporter split for scoped observations across reporter
restart. Keep this profile ineligible for automatic takeover.** The reporter
recovered the original retained descriptor, persisted its receipt and replayed
an actual mTLS acceptance after a lost acknowledgment. A same-UID user-manager
sibling continued writing outside the emptied payload and regained ordinary
supplementary groups. [ADR 0013](../architecture/0013-protected-observer-and-retained-scope-recovery.md)
records that conditional decision.

## Archive and reproducibility

[Disposable source, all three run records, review and offline lab](https://github.com/09millarda/agents-assemble/tree/78ac607/experiments/protected-observer)
are archived at `78ac607` on `codex/prototype-protected-observer`. No fixture code
belongs in mainline. The final run has **25 named cases**, with 14 actual denial
attempts grouped in one case. It contains one native Codex invocation and two
reporter SIGKILL barriers; these case counts are not separate end-to-end runs.

The final executed `run.py` SHA-256 is
`15e5c4ccc73a389e02a94e1168206f5a465a972255ee1b4c99ba2d0f23f25295`.
The unchanged vendored #10 authority fixture hash is
`28eced26fa319f7676ec400c00ee1e1707c423309fc3dbc8c7f49f1129cc68dd`;
the #9 native client hash is
`7d26fce040be20db1047715e6880da005d88d70487156658e1d3c2bc96946445`.
All three hashes match the final frozen sources. Earlier failures retain their
own source hashes and snapshots; they are not silently replaced by the final run.

The host is Linux `7.0.0-31-generic`, systemd `259.5-0ubuntu3.4`, Python `3.14.4`,
OpenSSL `3.5.5`, cgroup v2 and Codex `0.153.4`. The initial read-only preflight
could not authenticate sudo. The owner then explicitly selected this machine and
authenticated through the fingerprint reader. The fixture used that bounded
authenticated terminal; no password was sent through chat or added to a script.

In the archived experiment directory, on an explicitly authorized matching host:

```sh
sudo /usr/bin/python3 -I run.py bootstrap --user amillard98
python3 build_viewer.py
```

The first command prints a new root-owned evidence path. Export its sanitized
record as `evidence.json` before rebuilding the offline viewer. The CLI's user
argument must identify the intended existing account on that host. See the
archive README for ownership, bounded services and cleanup. This is a throwaway
root experiment, not an installer or unattended production service.

## Measured evidence

| Boundary | Actual observation and limit |
| --- | --- |
| Direct protection | UID 1000 with empty supplementary groups, zero effective/permitted capabilities and NNP was denied toy-key open, journal write/rename, protected code write, keeper signal/memory/descriptor access and payload migration. Four local API operations were denied by kernel peer identity. sudo was blocked by NNP; a valid `CPUWeight=100` mutation against the disposable system unit was denied without interactive authorization. These 14 denials are not a complete helper/polkit audit. |
| Exact binding and one launch | The keeper refused a wrong binding even from the root controller. It fetched the bounded grant through actual mTLS, persisted launch uncertainty, launched once and rejected a duplicate launch. The service's enrollment/authority rows were provisioned by the root fixture controller. |
| Native account and writer | Codex initialized under the existing UID and reported native ChatGPT account mode. The actual command wrote bounded heartbeat markers; namespace-PID correlation placed its writer in the original payload. Effective workspace-write/no-network tool settings were checked before the turn. Prompts and capability settings are not a complete native sandbox audit. |
| Reporter restart | A reporter obtained the original observation FD, observed emptiness and was killed before persistence. A replacement obtained the same retained event-object inode `45795` on device `30` from the same keeper and original manager activation, persisted the receipt, then was killed before delivery. The containing payload inode was `45789`; these two inodes describe different objects. |
| Authenticated delivery/replay | A replacement reporter read the immutable receipt and submitted it to the actual TLS/SQLite #10 fixture. The service committed and dropped its acknowledgment. Another reporter replayed the same receipt and received HTTP 200 with `accepted: true`, `local_state: authenticated_scope_only`. Replacement admission returned `ineligible_profile`. |
| Journal continuity | Missing, corrupt, changed-incarnation and older journal records were rejected against the surviving keeper's retained state. The rollback was newer than the service high-water mark, exposing why service sequence checks alone are insufficient. This does not validate recovery after keeper-memory loss. |
| Object loss/recreation | Removing the actual payload made the original held descriptor return `ENODEV` (19). Creating an empty same-name payload still returned `ENODEV` from the original descriptor. A new reporter refused that replacement. |
| Keeper loss | Stopping the keeper service ended the exact keeper process observed through its held pidfd. Reconnecting to the old socket failed with `ECONNREFUSED` (111), preserving unknown custody. No replacement keeper was allowed to adopt the old name. |
| Coverage failure | A controlled same-UID/NNP helper successfully invoked the user service manager. Its sibling writer remained in the user manager's cgroup after the original system-service payload reported `populated 0`, and its heartbeat grew. The user manager supplied the normal supplementary groups, including 27 and 114. This is a separate OS capability probe, not a claim that the selected native tool sandbox executed that escape. |

The keeper, system manager, root controller and reduced service survive reporter
crashes. The keeper's original descriptor reaches the reporter by `SCM_RIGHTS`;
systemd FD-store persistence was researched but not exercised. No full observer
tree restart, kernel reboot, power loss or disk-rollback resistance was proved.

Full native observations and service snapshots remain distinct. The reporter
derives the #10 fixture's canonical scoped projection from the actual original
descriptor. Root fixture code uploads that artifact to the reduced service; the
production artifact transport/verifier is not implemented. The fixture's
`trusted=1, complete=0` registry row is explicit policy configuration, not an
empirical claim of complete observation authority. The native receipt never
clears the complete writer obligation.

## Defects, audit and cleanup

Run 1 stopped before native launch because the CLI role `denials` did not dispatch
to its function. Run 2 completed the original 21 cases but source review found a
privileged evidence-reader flaw: user-controlled paths could redirect root reads
and disclose root-readable JSON. It is retained as superseded evidence.

The final reader uses a pinned workspace directory, `O_NOFOLLOW`, file type/owner
checks, a byte limit and allowed top-level fields. Actual attacks against a toy
root sentinel via symlink and a root-owned workspace file are rejected. No real
credential or private account file was targeted. The same reviewer also identified
missing administrative-helper probes; the final manager denial and outside-writer
case address that bounded gap. Independent source reinspection found no remaining
material issue in those fixes. It was not a second independent native run or
penetration test.

All generated system/user services ended with `ActiveState=inactive` and
`MainPID=0`. The final repeated system stop returned code 5 because the already
stopped transient unit had been collected; this is disclosed separately from the
earlier successful stop and held-pidfd observation. Toy TLS directories were
removed, then all three root-owned experiment trees were removed after exporting
sanitized evidence. The authenticated terminal's sudo timestamp was invalidated.
No users, sudoers rules, persistent units, packages or model-account copies were
created. Complete machine inventory and production cleanup robustness are not
claimed.

The offline lab was inspected in a browser: scoped-receipt creation retained a
takeover pause, and a replacement object refused a receipt. Model buttons do not
count as native checks. Source hashes, local documentation links and whitespace
are verified separately from the experiment results.

## Remaining uncertainty

Keep native helper/IPC privilege routes and whole-workload containment open.
NNP does not constrain requests to an already privileged daemon, and a user
manager can create children with different supplementary groups. This reference
does not test container/LXD authority, every polkit operation, hostile plugins,
remote executors or all same-user processes.

Production stop-command authentication, service-account hardening, launch/grant
expiry races, full keeper/manager/storage restart, enrollment/renewal/revocation,
PostgreSQL context integration and bounded installation/retention remain to
validate. Remote effects and independently verified checkpoints remain mandatory
separate recovery gates. No speculative child decision was created from these
broader implementation and qualification questions.
