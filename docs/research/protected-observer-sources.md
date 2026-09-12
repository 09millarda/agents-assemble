# Protected observer: separation and restart sources

Research for [decision #11](https://github.com/09millarda/agents-assemble/issues/11), 2026-09-12. This is the pre-experiment candidate comparison, not a native conformance report. Initial session context reported Linux `7.0.0-31`, systemd `259.5`, UID `1000`, and interactive authentication required by `sudo -n true`. At that checkpoint no elevated experiment had run. Lack of elevation is an execution prerequisite, not evidence against either profile. Sources pin systemd to `v259.5` and kernel implementation to upstream `v7.0`; distribution patches still require runtime validation.

The owner later authorized this host and authenticated. [ADR 0013](../architecture/0013-protected-observer-and-retained-scope-recovery.md) and the [native report](protected-observer-conformance.md) now record the scoped keeper/reporter verdict. The comparison below preserves the pre-experiment recommendations; the final fixture used a surviving keeper with SCM_RIGHTS, not systemd FD-store recovery.

## Two candidate profiles

**A — separate system-service principal; native workload UID 1000 (recommended first experiment).** An administrator installs a protected observer service, with root or a dedicated service UID holding the toy mTLS client credential and owning its receipt journal. A privileged launch/stop component owns the cgroup subtree and allows only grant-bound operations. The native harness remains UID 1000 using its existing login; the observer never copies or proxies model-account credentials. These are proposed responsibilities, not installed controls. [ADR 0006](../architecture/0006-enrolled-runner-authority.md) retains channel-authenticated receipt delivery; this proposal does not add portable receipt signatures.

Systemd credentials are accessible to the unit's configured UID and superuser; `LoadCredential=` provides a suitable delivery mechanism, while plaintext `SetCredential=` is explicitly unsuitable for secrets. This supports different-UID separation, not a same-UID confidentiality claim. [systemd 259.5, credentials](https://github.com/systemd/systemd/blob/v259.5/man/systemd.exec.xml#L3342-L3353), [plaintext warning](https://github.com/systemd/systemd/blob/v259.5/man/systemd.exec.xml#L3510-L3518)

Use an administrator-owned parent and a service-owned journal with restrictive permissions; test read, append, replacement, deletion, and symlink attempts. Ordinary signaling requires matching credentials or the relevant capability, so distinct principals also provide a process-control boundary subject to privileges. [Linux `kill(2)`, permission checks](https://man7.org/linux/man-pages/man2/kill.2.html#DESCRIPTION)

The system manager authorizes unit mutations through `org.freedesktop.systemd1.manage-units`. Do not grant that general authority to the workload. [systemd 259.5, manager security](https://github.com/systemd/systemd/blob/v259.5/man/org.freedesktop.systemd1.xml#L1765-L1785)

**B — administrator-enforced AppArmor domains; native workload UID 1000.** Keep native account access but separate observer and workload through enforced policy, potentially retaining UID 1000 for both. AppArmor requires loaded policy to restrict access beyond DAC. Its rules mediate files, ptrace, signals, D-Bus, and UNIX sockets. [Kernel AppArmor documentation](https://docs.kernel.org/admin-guide/LSM/apparmor.html), [AppArmor policy reference, ptrace and signal](https://manpages.ubuntu.com/manpages/resolute/man5/apparmor.d.5.html#PTrace_rules), [D-Bus rules](https://manpages.ubuntu.com/manpages/resolute/man5/apparmor.d.5.html#DBus_rules)

Recommended policy obligations: observer-only credential/journal access; deny workload tracing/signaling the observer; constrain executable transitions and IPC helpers; prevent workload policy changes. A protected manager must still own launch/stop and scope custody. These obligations need a concrete loaded policy and native denial tests. Allowing arbitrary unconfined helpers would invalidate the intended boundary. B requires more policy and compatibility validation than A; it is not rejected.

For both profiles the trusted host administrator is the person controlling initial-namespace root, system units, kernel/policy configuration and privileged authorization. On this host the session is authenticated as `amillard98`/UID 1000; successful administrator authorization has not been obtained. An adversary with administrator authority is outside these candidates' trust boundary.

## API authorization is separate from key secrecy

`SO_PEERCRED` identifies the connected peer's PID/UID/GID at connection establishment, not its entitlement to attest arbitrary invocation IDs. [Linux `unix(7)`, `SO_PEERCRED`](https://man7.org/linux/man-pages/man7/unix.7.html#DESCRIPTION)

Recommended API: accept a service-issued grant, bind it once to the observer-created invocation and retained object, and derive receipt fields from that binding. Never expose “sign this receipt” or “attest this supplied cgroup path.” Test substituted grants, scope IDs, duplicate requests, and direct credential use. A denied key read alone does not prove this authorization property.

## Same-user shortcuts do not establish protection

`PrivateUsers=self` maps the unit's own UID to itself; read-only filesystem settings do not prevent UNIX-socket communication. [systemd 259.5, UID mappings](https://github.com/systemd/systemd/blob/v259.5/man/systemd.exec.xml#L1929-L1962), [sandbox limitations](https://github.com/systemd/systemd/blob/v259.5/man/systemd.exec.xml#L1275-L1290)

A process in the parent user namespace matching its owner's UID has all capabilities in the child namespace. Filesystem checks translate identities into the initial namespace. Therefore a UID-1000-created user namespace alone does not isolate an observer from hostile UID-1000 peers outside it. [Linux `user_namespaces(7)`, capabilities and mappings](https://man7.org/linux/man-pages/man7/user_namespaces.7.html#DESCRIPTION)

## Exact scope continuity across observer restart

`cgroup.events:populated=0` describes the cgroup and descendants, not every writer. Delegation containment depends on migration permissions at source/destination ancestry. [Kernel cgroup v2, population](https://docs.kernel.org/admin-guide/cgroup-v2.html#un-populated-notification), [delegation containment](https://docs.kernel.org/admin-guide/cgroup-v2.html#delegation-containment)

Recommended experiment: keep a separately managed privileged owner alive outside the payload, retain the original payload cgroup until receipt commit, and transfer its already-open observation descriptor through the system manager's FD store. Observer restart must not stop that owner or clean the payload. This is a design to test, not a guarantee inferred from a unit name.

Systemd returns stored descriptors to the same service on restart. `FileDescriptorStorePreserve=` controls lifetime; `yes` still ends when the unit is unloaded. Configure sufficient storage and protected unit ownership. [systemd 259.5, descriptor store](https://github.com/systemd/systemd/blob/v259.5/man/systemd.service.xml#L1056-L1128)

Use `FDSTORE=1`, stable metadata binding, `FDPOLL=0` where automatic error-event eviction would lose custody, and a notification barrier before acknowledging retention. The barrier confirms prior notification processing; it does not commit the application journal. [systemd 259.5, FD protocol](https://github.com/systemd/systemd/blob/v259.5/man/sd_notify.xml#L343-L426)

An open descriptor does **not** guarantee that its cgroup remains live. Kernel removal permits immediate same-name recreation; kernfs reads can fail `ENODEV` after deactivation. [Linux 7.0, cgroup destruction](https://github.com/torvalds/linux/blob/v7.0/kernel/cgroup/cgroup.c#L5762-L5808), [kernfs read](https://github.com/torvalds/linux/blob/v7.0/fs/kernfs/file.c#L153-L174)

Fail closed on missing descriptors, removal, recreation, journal inconsistency, reboot, or lost manager custody. Do not reopen by path and infer continuity. Durably bind grant, custody metadata and receipt; flush the file and directory when publishing a new journal entry because file `fsync()` alone does not persist its directory entry. [Linux `fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html#DESCRIPTION)

## Evidence required at the research checkpoint

At the research checkpoint neither profile had proved actual credential/journal/API denials, native account compatibility, original-object recovery, crash ordering, authenticated #10 delivery, or cleanup safety. Writer completeness additionally requires demonstrating that all write-capable helpers, siblings, IPC services and remote actors fall under the declared contract. Protecting the observer only authenticates its scoped statement. Until that separate coverage obligation is met, automatic takeover stays ineligible; remote-effect and checkpoint obligations remain.
