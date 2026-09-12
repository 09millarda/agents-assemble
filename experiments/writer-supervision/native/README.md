# Native supervision reference probes

THROWAWAY evidence for Agents Assemble #9, not a production supervisor or a security sandbox. Four recorded runs use Codex CLI 0.153.4 App Server stdio on Linux 7.0.0-31-generic/systemd259.5 and the existing OS user/native ChatGPT login. No auth files are read/copied. Each run submits one exact harmless heartbeat command, with model and effort omitted. The child allow-list excludes provider keys and host/session tokens. Normal native inference is used only by explicit probe reproduction.

From this directory, choose a new output directory for each invocation:

```sh
python3 probe_plain.py --mode graceful --output /tmp/aa-writer-plain-graceful-rerun
python3 probe_plain.py --mode app-server-kill --output /tmp/aa-writer-plain-kill-rerun
python3 probe.py --delegated --mode graceful --output /tmp/aa-writer-delegated-graceful-rerun
python3 probe.py --delegated --mode app-server-kill --output /tmp/aa-writer-delegated-kill-rerun
python3 review-native.py
```

Requires the installed normally authenticated harness, Git, Python, cgroup v2 and a systemd user manager permitting transient service delegation. No replacement model key, sudo, global config mutation or external Git/publication is used. Native tool permissions request workspace-write, no tool network, no extra tmp writes, never approvals and an ephemeral thread. These reported settings are not a complete tool-escape audit.

Every native turn runs only the generated `writer.py` in a fresh disposable repository. The script appends heartbeat bytes for at most 60 seconds. Service RuntimeMaxSec=240s bounds the containing service; TimeoutStopSec=2s bounds graceful cleanup before KILL. All unit names are unique. Finalizers stop only that owned unit. Do not treat observed process IDs from an old run as safe cleanup targets.

The plain entry point is retained unchanged to match its recorded SHA-256. The revised entry point adds a Delegate=yes service and trusted single-launch shim: the native child moves into a fresh delegated payload before exec; the shim remains outside. Payload kill is followed by actual empty-state observation on the retained object and a local receipt file before outer cleanup.

The coarse raw status `observed_scoped_stop` is not a certification label. Plain runs establish known-writer exit after manager stop; both held cgroup descriptors return ENODEV, without a direct empty reading. Delegated runs establish payload-only emptiness, with a still-live outer supervisor, and incomplete production receipt fields. No result establishes arbitrary writer coverage or remote-effect cancellation.

`review-results.md` records 69 archive checks and 14 additional original-workspace checks, with no new inference. The latter are optional once the original temporary workspaces are unavailable. Native top-level hashes match execution records; helper hashes are captured at review time. File fsync without parent-directory fsync establishes recorded receipt ordering, not power-loss durability. Numeric PID-to-pidfd acquisition has a race; matching birth/namespace evidence supports these recorded writers only. No native daemon-restart/deadline probe is included. See the independent review for full limits.

`client.py` is extracted from #8 archive 16bd3cf, adapting only launch argument injection so systemd can own the process. It keeps lifecycle metadata, discards stderr, and does not archive prompts, reasoning, tool output, raw native IDs or account PII. The installed generated `TurnInterruptParams` type was inspected; its exact signature is `{ threadId: string, turnId: string }`.
