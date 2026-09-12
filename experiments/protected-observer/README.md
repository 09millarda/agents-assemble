# Protected observer prerequisite probe

Throwaway evidence for [decision #11](https://github.com/09millarda/agents-assemble/issues/11).
This directory contains a read-only preflight and a subsequently authorized
native observer prototype. All code is throwaway, not a production daemon.

```sh
python3 preflight.py --output preflight.json
```

The probe reads tool versions, user identity and cgroup-v2 availability, asks the
existing sudo policy whether `true` can run without interaction, and records every
command result. It does not modify sudo policy, create users, install services,
read native account files, launch a model turn, or create a writer. It writes only
the requested output file. A successful administrative check would merely allow
operator/environment review; it would not prove observer protection.

The initial preflight lacked noninteractive administrative access. The owner
subsequently selected this machine and authenticated through its fingerprint
reader. That earlier prerequisite record is retained unchanged.

## Native experiment

On the specifically authorized Linux/systemd machine, with the intended native
user already logged into Codex, run:

```sh
sudo /usr/bin/python3 -I run.py bootstrap --user amillard98
```

The explicit root controller freezes three source files under a new root-owned
`/var/tmp/aa-protected-observer-*` directory. It creates a unique transient root
systemd keeper, a delegated payload, root-only toy credentials/journal and a
temporary native-user workspace. It invokes Codex under the existing native UID,
with no supplementary groups and `NoNewPrivileges`, using its existing login.
The keeper derives its fixed launch from a real mTLS grant fetch. Reporter
subprocesses recover the original descriptor from that surviving root keeper.
The controller also creates one uniquely named user service to demonstrate a
writer outside the original payload. Native tool-sandbox certification is
separate from this same-UID/NNP capability probe.

No users, sudoers rules, persistent services, packages or model-account copies
are created. Only generated toy mTLS keys are used. All created services are
stopped and toy PKI is deleted in `finally`; retained root-owned source/evidence
directories are removed after exporting the sanitized evidence. A hard kill of
the controller still requires operator reconciliation/cleanup: this is not a
production installer. Service runtime limits are cleanup backstops, not receipts.

`evidence.json` records **25 named cases**, including 14 actual denial attempts
inside one case, a native writer, two reporter SIGKILL barriers, mTLS lost-ack
replay, four journal disruptions, actual missing/recreated cgroups and keeper
loss. Counts are categories, not independent end-to-end runs. The final verdict
is scoped observation only; automatic takeover is ineligible. A user-manager
sibling continued writing outside an empty payload and regained its ordinary
supplementary groups. No complete host/workload sandbox is claimed.

`vendor/native_client.py` is retained from #9's archived native client;
`vendor/authority.py` is the unchanged #10 reduced TLS/SQLite fixture. Source
hashes in every record identify the exact frozen bytes. The server's profile
registry and complete=false policy are controller-provisioned. The actual
observer supplies the original observed envelope; registry booleans do not
prove isolation. The keeper, service and controller survive reporter crashes;
whole-keeper/host restart, power loss and full production durability are unproved.

## Retained failures and review

- `archive/run-1`: stopped before native launch because CLI role `denials` did
  not map to `denial_probe`. Cleanup and removal of toy PKI were recorded.
- `archive/run-2`: 21 original cases completed, but source review found that the
  root evidence reader followed workload file paths. This is superseded evidence,
  not certification of that reader. No exploit was attempted against real data.
- `archive/run-3`: final 25-case run. The reader pins a root-owned workspace entry,
  rejects symlinks, nonregular/non-workload-owned files and excessive input, and
  limits top-level artifact fields. Actual fixture-sentinel symlink and root-owned
  file rejection cases pass. The manager mutation probe is denied. A source
  reviewer rechecked those two fixes and found no remaining material issue in
  that bounded recheck; this is not a penetration test or an independent native run.

The source comparison, ADR and evidence interpretation belong in planning
records; no fixture code should merge into the mainline application.
