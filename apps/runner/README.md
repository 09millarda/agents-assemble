# Agents Assemble runner

The `aa` CLI runs on a customer-controlled Linux machine with Node.js 24 and an
existing native Codex installation. The pinned native adapter is Codex CLI
`0.153.4`, using its App Server protocol and the current user's existing ChatGPT
login. Agents Assemble does not read, upload, or substitute model credentials.

Build and install from the repository:

```sh
npm install
npm run build --workspace=@aa/runner
npm install --global ./apps/runner
aa doctor
```

The control-plane administrator creates an enrollment authorization through
`POST /api/v1/fleet/enrollments` or the Fleet UI. Obtain the service CA certificate
through the installation's trusted operator channel. Do not disable hostname or
CA verification. Select the service and provide the finite enrollment token on
standard input or through a protected file:

```sh
aa service --service https://control-plane.example:3443 --ca /absolute/path/ca.pem
aa enroll --token-file /absolute/path/enrollment-token
aa daemon install
aa daemon start
aa daemon status
```

`aa daemon run` runs in the foreground. `aa daemon stop` and `aa daemon restart`
manage the systemd user service. `aa status` inspects local enrollment and journal
state. `--directory` selects a different state directory. A background user
service that must survive logout needs operator-configured systemd user lingering.
Installing the CLI does not silently enable privileged host settings.

The service uses outbound TLS 1.3 with client certificates. Keys are generated
locally. A signed certificate request proves possession; enrollment atomically
registers its fingerprint and consumes the authorization. The server checks
registration, expiry, status and generation for every operation, including an
existing connection. TLS headers cannot supply runner identity.

For rotation, the administrator creates another enrollment authorization for the
existing runner ID. Stop the daemon, run `aa rotate --token-file FILE`, and start
it again. Rotation preserves the journal incarnation and historical receipts and
retires the prior credential. `aa de-enroll` revokes future operations and keeps
the local history. Revocation does not prove that prior local writers or remote
effects stopped.

## Runtime and environment

Each command pins the repository commit, runtime/environment revisions, model,
effort, sandbox and finite assignment scope. The daemon rejects unavailable native
login, model/effort mismatches, unsupported settings and expired scope. Model
fallback is disabled. The harness gets an allowlist of ordinary OS variables and
the selected environment; service and model API credentials are not inherited.

Optional local secrets come from `--secret-file /absolute/path/secrets.json`
during enrollment. The file must be an ordinary owner-only file, outside the
repository, containing logical names:

```json
{"development.database":{"value":"operator-supplied-value","version":"1"}}
```

The supported policy is `local-file` resolution with `refresh_per_attempt` rotation.
Each new attempt reads the current protected file and pins the observed logical
names and versions into its receipt. Environment-based resolution and profile-pinned
secret values are rejected because this adapter does not implement them. Both
supported policy settings travel in the immutable command payload.

Only authorized bindings reach the process. Shared receipts contain logical
names and versions. Resolved values are filtered from captured output and rejected
from artifacts/checkpoints when detected. This filtering is not a complete
confidential-data detector; trusted code with a secret can disclose it.

## Durability and limits

The local journal is append-only with a hash chain and file synchronization before
acknowledgment. Receipt identity and invocation uniqueness are separate. Launch
and message dispatch intents are written before native calls. A process crash
between intent and accepted result becomes `outcome_unknown`; restart replays
receipts without repeating the native action. Missing, damaged or mismatched
journals block continuation. Keep the complete journal for the replay horizon;
there is no automatic tombstone deletion.

Every work attempt uses an isolated Git worktree. Checkpoints retain the exact
commit/tree, baseline, input digest and assignment scope; they are pushed to an
attempt-specific ref and verified through a fresh fetch. Submodules and Git LFS
are rejected by this initial adapter. `prepare` and `check` are deterministic
commands; checks execute only the policy-pinned argument arrays and upload bounded
evidence. Native tool `aa_read_artifact` reads only exact immutable references in
the assigned inputs; `aa_create_artifact` and `aa_checkpoint` create actual service
references. Structured native results are validated before submission. Repository
preparation, native thread/turn launch and each check require fresh, finite service
authorization for the exact command, scope and payload digest.

Conversation steering binds the exact thread and turn. Interruption has a
separate control path and blocks continuation while pending or uncertain. Output
captures permitted assistant/tool events, records stable cursors, omits reasoning,
limits individual payloads and pauses after a one-MiB attempt capture overflow.
Completed-item snapshots replace their deltas in the service projection.
The pinned Codex adapter enables `features.default_mode_request_user_input` only
for its own native thread. Typed native questions retain their request, item,
thread and turn identities through the Human API; answers require confirmed
native delivery and are never replayed after an uncertain outcome.

This adapter advertises **trusted runner, incomplete writer coverage, automatic
takeover disabled**. A worktree is not a hostile-workload sandbox. Native turn
interruption, App Server exit and systemd service cleanup are not accepted proof
that every write-capable descendant or external effect stopped. A protected
keeper/reporter supervisor and complete-writer qualification remain a separate
release requirement; the direct adapter does not claim those properties.

## Verification

`npx vitest run packages/runner/test` exercises protocol validation, fsynced journal
replay/conflict/corruption, actual Git publication and independent retrieval,
real PostgreSQL enrollment, TLS, CLI/daemon subprocesses, credential rotation and
revocation, and SIGKILL after native start with no relaunch. The native process in
fault suites is a protocol-faithful conformance executable. The opt-in installed
native readiness smoke test is distinct from the opt-in live native journeys.

After verifying the selected model and effort through the installed runtime, run:

```sh
AA_NATIVE_CONFORMANCE=1 AA_NATIVE_MODEL=gpt-5.6-sol AA_NATIVE_EFFORT=low npx vitest run packages/runner/test/native-live.test.ts
AA_NATIVE_JOURNEY=1 AA_NATIVE_MODEL=gpt-5.6-sol AA_NATIVE_EFFORT=low npx vitest run tests/integration/native-runner-journey.test.ts
```

The first command exercises real structured output, steering, interruption and a
delayed native question reply. The second crosses the actual CLI, mutual TLS,
HTTP Human API, immutable Knowledge artifacts and a temporary local bare Git
remote. It replaces the API application while the dedicated runner listener stays
available and proves the pending request is retained. It uses the existing native
login and never substitutes a model or transfers account credentials. Set
`AA_NATIVE_JOURNEY_EVIDENCE` to retain the bounded qualification result as JSON.
Privileged supervisor installation, browser rendering and live external provider
deployment have their own qualification paths.
