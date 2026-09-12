# ADR 0006: enrolled-runner authority and authenticated recovery receipts

Date: 2026-09-12
Status: **Accepted conditionally — authenticated channel/receipt authority supported by bounded real-TLS evidence; protected native observation and production revocation propagation remain unproved.**
Decision: [#10](https://github.com/09millarda/agents-assemble/issues/10) · Map: [#1](https://github.com/09millarda/agents-assemble/issues/1)

## Decision

Use a customer-initiated HTTPS channel with mutual TLS for the reference runner transport. Map the verified peer certificate to a registered deployment, organization, runner and credential version. Check current authorization for each operation. Execution retains immutable receipt acceptance records; this profile does not require runner-signed, independently transferable receipt artifacts.

Keep enrollment, invocation admission and observation trust separate. Enrollment permits a named principal to request a bounded set of operations. Execution alone grants work and accepts results. An observer additionally needs a registered authority/profile and an exact scope binding. Possession of an observer credential cannot establish that its claimed observation is true or that all writers are covered.

This is a portable protocol decision, not a production PKI, identity vendor, tunnel package or isolation certification. HTTPS polling is sufficient for the experiment; a multiplexed tunnel can implement the same port later. Native model-account login remains with the harness under the intended user identity. Service credentials must never be derived from, copied out of, or substituted for model-account credentials.

The [source comparison](../research/runner-authority-sources.md) contrasts client certificates, bearer/device enrollment and portable signed receipts. TLS authenticates the peer and protects the channel; application policy still determines what that peer may do. [RFC 8446, authentication](https://www.rfc-editor.org/rfc/rfc8446.html#section-4.4).

## Ownership and enrollment

Organization and Access authorizes an organization's runner administrator through a replaceable identity adapter. Runner Fleet owns enrollment, credential versions, capabilities, registered observer profiles and retirement. Execution owns grants, assignment generations, writer obligations and receipt/admission verdicts. Preserve the separate transactions and inbox/outbox ownership in [ADR 0003](0003-durable-execution-and-recovery.md).

The selected enrollment contract is:

1. An authenticated, currently authorized administrator creates a short-lived, single-use enrollment authorization scoped to one deployment, organization, requested runner and permitted profile ceiling. Hosted and self-hosted deployments expose the same operation through replaceable authentication.
2. The runner generates its service private key locally and proves possession. The service atomically consumes the enrollment authorization when binding the public key to the registered identity. Retry uses an enrollment operation ID and identical key/scope; substitution conflicts. A runner-supplied organization, role, boot ID or certificate subject never grants authority.
3. Issue a finite-lived client certificate and retain its fingerprint, credential version, validity and status in Fleet. The TLS trust anchor is necessary but not sufficient: an unregistered certificate from a trusted CA has no application authority. Do not auto-enroll by certificate common name.
4. Register any observer role separately, with a finite authority lifetime, permitted operation types and an immutable profile version. A transport daemon may report liveness without being eligible to attest stopped writers. An administrator cannot make an unvalidated same-user profile trustworthy merely by setting a flag.

An interactive device flow is an optional bootstrap adapter, not the machine's ongoing execution authority. PKI issuance, administrator authentication, enrollment invitation delivery and unattended renewal remain adapter work; a fixture registry provisioned by the local test controller does not prove them. Device authorization's browser approval and token steps are described in [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html#section-3).

## Authenticated channel and wire identity

The runner verifies the configured service identity and deployment trust anchor, including hostname verification. The service requires client authentication. Disable TLS early data for commands, receipts and admission; its weaker replay properties do not meet this contract. [RFC 8446, 0-RTT replay](https://www.rfc-editor.org/rfc/rfc8446.html#section-8). Derive the peer fingerprint from the actual verified TLS certificate; discard caller-supplied principal headers. A TLS-terminating proxy would become part of this trust boundary and would need its own authenticated, non-spoofable forwarding contract. It is not covered by this direct-channel reference. [Service identity verification](https://www.rfc-editor.org/rfc/rfc9525.html).

Bind every command/result/receipt to a versioned operation and explicit audience. Minimum immutable scope includes deployment/organization, runner, journal incarnation, run/occurrence, assignment/generation, attempt/invocation, admission and command/request identities, input digest, observer profile and scope binding. Stop evidence also binds the registered host/boot correlation, manager activation and retained payload identity from [ADR 0005](0005-native-writer-supervision.md). Result identity is not invocation identity; a new message ID cannot create a second invocation.

The receipt's logical issuer must match the TLS principal's registered observer authority. Record the actual credential fingerprint/version and server acceptance time as separate acceptance metadata. This permits the same logical observer to replay exactly the same receipt after credential rotation without rewriting its issuer or old payload. No relay may substitute its own principal for an arbitrary payload issuer.

For the bounded metadata envelope, use a versioned restricted canonical ASCII JSON encoding: schema-approved printable ASCII keys and strings (0x20–0x7e), booleans, ordered arrays and integers from 0 through 9007199254740991. Sort object keys by ASCII order and use compact separators. Escape only quotes and backslashes with JSON backslashes; leave other permitted characters literal. Integer encoding is unsigned base ten with no leading zero except zero itself; booleans cannot substitute for integers. Reject null, controls, duplicate members, unsupported fields, floats, whitespace and alternate escapes. SHA-256 covers the exact bytes `b"agents-assemble/runner-authority/v1\x00"` followed by the canonical metadata bytes. Endpoint schema and operation-scoped inbox identity keep operation types distinct. Artifact contents remain external exact-byte objects referenced by digest. A digest detects conflict; it never authenticates a sender. This deliberately constrained envelope does not claim to implement general JSON Canonicalization Scheme. A future broader encoding is a new negotiated version, not a silent serializer change. [RFC 8785's general canonicalization requirements](https://www.rfc-editor.org/rfc/rfc8785.html#section-3).

Server commands are authenticated through the verified service connection and durably recorded with their immutable bytes/digest. A runner checks its own audience, journal incarnation, exact bounded scope and deadline before local receipt and again before launch. Reconnect fetches existing commands and verdicts; it creates no grant. Locally stored copies are not signed portable grants: after uncertain journal continuity, revalidate with the service. Launch uncertainty and stop/launch serialization remain [ADR 0004](0004-runner-assignment-and-checkpoint-recovery.md) obligations.

## Acceptance, replay and revocation

Authenticate and authorize before any receipt deduplication or history lookup. Within Execution's own transaction, verify the exact operation scope and current local authority gate, retain the scoped inbox ID and payload digest, persist the verdict and permitted writer transition, and emit its outbox record together. An authorized exact replay returns the original verdict; changed bytes under that identity conflict. Retain rejected verdicts for semantic operations as well: later state changes require a new operation identity.

A late valid observation can settle only the historical writer it names. Historical invocation grant expiry does not erase an accepted observation, but expired or revoked transport credentials cannot bypass authentication by asking for replay. An active replacement credential with permission over the same history may query the original acceptance record. A record of acceptance is an Execution fact, not fresh permission to launch work.

Check mutable credential/enrollment/observer authority on every operation, including an already-established TLS connection. Certificate validity at handshake alone is insufficient for application revocation. Routine rotation retains the stable logical runner/observer identity and its historical records; the previous key loses operation authority when retired. This is additional application policy, not a claim that TLS automatically checks Fleet state. [TLS session and authentication semantics](https://www.rfc-editor.org/rfc/rfc8446.html#section-4.6.1).

Revocation has a defined boundary. Fleet blocks new authorization at its own decision point. An operation authorized before that point may still reach Execution. Do not hide that race inside a transaction spanning contexts: a production adapter must bind a short-lived authorization decision to the exact request digest and authority epoch, and deliver ordered revocation gates to Execution's own inbox. Execution checks its local gate and decision deadline in its acceptance transaction. Report service revocation as effective only once the relevant consumers acknowledge their gates; fail closed when the required authorization cannot be established. This cross-context propagation protocol is a requirement, not something a single-process registry lookup proves.

Revocation cannot retract an already running native process or a request already sent with direct downstream credentials. An already issued, unexpired grant may also permit disconnected local action until its bounded expiry or the runner receives and durably applies its stop/revocation gate; server revocation alone does not prove that gate was observed. Account for those obligations separately. On suspected credential or observer compromise, preserve accepted receipt history but quarantine its use in future recovery through a separate assessment. Routine key rotation alone does not invalidate history; an old acceptance timestamp does not prove the observation predated compromise.

## Journal and observer trust

Enrollment identity, local journal incarnation, host correlation and kernel boot identity have different lifetimes. Persist server-observed incarnation and acknowledged sequence high-water marks. For current continuity reports and new evidence, reject a lower reported sequence or incompatible boot/scope; an unchanged historical receipt replay or authorized history read does not claim a new current journal sequence. In particular, a replacement installation registers a new incarnation and retains all old unresolved writers. It cannot attest an old missing payload by reusing its name, path, PID or certificate subject.

A matching or higher sequence is not rollback attestation. The service cannot infer local-only records lost after its last acknowledgment, and an authenticated malicious process can lie about a sequence or boot claim. Unproved continuity requires protected journal recovery and authoritative retained-scope correlation, or an explicit pause. Rotation of a service key does not by itself replace the journal; replacing the journal does not authorize an old observer scope.

Two profile classes are explicit:

| Profile | Permitted meaning |
| --- | --- |
| Native tools can read/use observer credentials, change the observer journal or direct its observation path | Sender authentication only; ineligible for automatic writer clearance/takeover. |
| Protected observer with independently validated credential/journal isolation, launch gate, retained-scope continuity and complete writer coverage | Eligible for exact scoped stop evidence subject to all remaining recovery gates. This is a required profile contract, not a certified deployment from this experiment. |

Mode 0600 protects a key from other ordinary users, not processes with the same effective identity. Signing a receipt with that accessible key would preserve the same impersonation problem. A separated observer process also needs a constrained request interface: granting arbitrary signing or observation requests to tools defeats the separation. Host administrator/root and the deployment operator remain explicit trusted parties for this reference, not adversaries defeated by mTLS. [Linux credential access checks](https://man7.org/linux/man-pages/man7/credentials.7.html).

## Recovery admission and limits

Accepting an exact stopped-payload receipt records only its declared observation. Clearing the full writer obligation additionally requires an eligible observer/profile, closed launch gate, complete coverage and established continuity. Keep effect reconciliation and checkpoint verification independent. A trusted receipt cannot cancel a remote provider effect or authenticate artifact contents on its own.

Fresh recovery requires the current predecessor/generation, every required writer settled, unquarantined evidence, accounted effects, an independently verified checkpoint reference pinned to the exact original input/baseline/artifact scope, an eligible recovery class and destination, current authorization, and remaining allowance. Commit the new bounded invocation and charge once in Execution's transaction. A replayed predecessor receipt must not bypass a live replacement or mint another grant.

See the [authentication experiment](../research/runner-authority-conformance.md) for actual TLS boundaries, durable fixture behavior, independent review and explicit omissions. The fixture's trusted positive observer and checkpoint verifier are controlled inputs; actual protected native supervision, physical host attestation, enrollment user interaction, full PostgreSQL/transport/harness composition, production renewal/revocation propagation and provider effects are not certified. First release #4 is subsequently resolved in the [release contract](../first-release-contract.md); licensing/parity #5 is subsequently resolved by the owner in [ADR 0011](0011-open-source-licensing-and-edition-parity.md), with actual license application separate.

The next sharp technical decision is [#11, protected observer authority and native recovery continuity](https://github.com/09millarda/agents-assemble/issues/11). It tests enforced credential/journal separation and exact retained-scope recovery while preserving native user login. Broader daemon packaging and capability coverage remain conditional.

The follow-up #11 is now resolved conditionally by [ADR 0013](0013-protected-observer-and-retained-scope-recovery.md): actual root-separated keeper/reporter evidence supports original-scope recovery across reporter restart. The surviving keeper is required; user-manager sibling escape and unvalidated indirect privilege routes keep complete writer clearance and automatic takeover ineligible.
