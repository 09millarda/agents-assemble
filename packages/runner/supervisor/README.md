# Optional protected Linux observer

The default user daemon provides no protected observer. This optional installation runs the controller, credential custody, keeper, and reporter as root. Git, check commands, and Codex run as one configured ordinary user with empty supplementary groups and `no_new_privs`. Codex retains that user's existing login. Model credentials are not copied into the control plane.

This profile reports **incomplete writer coverage** and **automatic takeover disabled**. An empty retained cgroup proves only that the recorded local scope is empty. Native code may have caused remote work, escaped through a previously delegated service, or used credentials to create external writers. Neither a stop receipt nor native completion certifies global quiescence.

## Install

Use Linux with systemd, unified cgroup v2 and `cgroup.kill`, Python 3.11+, root-owned Node.js 24+, `/usr/bin/setpriv`, and Codex 0.153.4 installed for the ordinary native user. Review the helper and installer before running them as root. The installer requires a new root-owned runner directory; it never copies an existing user-held enrollment private key.

```bash
npm run build --workspace @aa/runner
sudo python3 apps/runner/dist/supervisor/install.py \
  --native-user NATIVE_USER \
  --codex /ABSOLUTE/PATH/TO/codex \
  --node /usr/bin/node \
  --cli apps/runner/dist/cli.js
sudo /usr/bin/node /opt/agents-assemble/runner/aa.mjs doctor --protected
sudo /usr/bin/node /opt/agents-assemble/runner/aa.mjs enroll --protected \
  --directory /var/lib/agents-assemble-runner \
  --service https://SERVICE:3443 --ca /root/service-ca.pem --token-stdin
sudo /usr/bin/node /opt/agents-assemble/runner/aa.mjs daemon install \
  --directory /var/lib/agents-assemble-runner
sudo /usr/bin/node /opt/agents-assemble/runner/aa.mjs daemon start \
  --directory /var/lib/agents-assemble-runner
```

Supply the short-lived enrollment token through stdin using your normal secret-delivery process. Root owns `/etc/agents-assemble/supervisor.json`, the installed helper and CLI, the enrollment certificate/key, journal, requests, sockets, and receipts. Workspaces have a separate root-owned traversable parent; each attempt directory belongs to the native user. The controller verifies these paths before work. Credential rotation preserves the supervisor configuration and generates the replacement key under root custody.

Every native invocation creates a unique `agents-assemble-keeper@INVOCATION.service`. The keeper opens the original payload `cgroup.events` and `cgroup.kill` files once, binds them to the exact command, invocation, boot, manager activation, device/inode and live incarnation, and retains the descriptors. It independently requests a fresh mTLS launch decision for those exact bytes before spending its single launch gate. The decision expires within five seconds; the command retains its original finite execution expiry. No reconnect grants a second launch.

Stop closes and fsyncs the launch gate before using the retained kill descriptor. A separate reporter authenticates the root keeper's PID through `SO_PEERCRED`, receives the original descriptor through `SCM_RIGHTS`, verifies filesystem and object identity, and persists an immutable scoped observation. Reporter and controller restart can recover through a surviving keeper. Keeper death, changed manager activation, missing descriptor custody, altered journal, reboot, or scope substitution yields `scope_unknown`; the helper never reopens a cgroup path to recover a clean observation. Completed receipt replay returns the original observation with its original journal sequence.

Keep keeper units alive while post-restart observations are required. There is no automatic keeper restart or automatic cleanup/replacement. After reconciliation, an operator may stop the individual unit; historical receipts remain available, but fresh observation then becomes unknown.

## Qualification

The automated unprivileged suite checks protocol framing and descriptor transfer, exact requests, rejection of untrusted/mutable paths, single-gate transitions, privilege-wrapper construction, and conservative receipts. `diagnose` reports prerequisites, not qualification. The production root install and live Codex execution have **not** been qualified by that suite.

Before relying on scoped observations, run an explicitly authorized root-host test with a real enrolled runner: launch a harmless Codex task; stop it; verify the receipt's exact scope; restart only the reporter/controller and replay the same receipt; attempt a second launch; kill/restart the keeper and confirm fresh observation is unknown; try path/journal substitution from the native UID and confirm denial. Independently test reboot, manager restart, descendants, cgroup deletion/recreation, truncated journal, stale launch decision, revoked enrollment, and network loss. Keep results attached to the installed helper hash and host/systemd/kernel versions. Coverage remains incomplete even after those checks.
