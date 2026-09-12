# Bounded authenticated-channel protocol

## Ownership and transport

Fleet owns the authenticated certificate-fingerprint enrollment registry and the
server-approved logical runner/profile bindings. Credential status and expiry are
per key. Host, boot, journal, highwater and profile changes apply to every key for
the same deployment/organization/runner; runner revocation retires all such keys.
Execution separately owns grants, writer obligations, recovery admission, verdicts,
checkpoint verification references, allowance and outbox. Runner SQLite owns its
local journal and immutable pending receipt bytes. No transaction spans these
contexts.

Every operation uses outbound-request-style HTTPS/mTLS. The loopback fixture is
server-direct: it does not implement an Internet outbound tunnel or long polling.
Clients verify the service certificate against their configured CA and exact
hostname. The service requires a CA-valid TLS client certificate, then derives its
SHA-256 fingerprint from the actual peer DER certificate. A CA-valid certificate
must additionally map to a live enrollment. Request headers and body IDs cannot
choose the authenticated principal. TLS 1.3 is required. No application early-data
API is used; application requests follow the completed handshake.

Fleet authorization is reread for every operation, including every operation on an
already-established TLS connection and every historical replay/query. A credential
must be active and unexpired and have the required role plus exact organization,
deployment and runner scope. The observer issuer is the stable server-bound
logical observer, allowing a replacement key to replay unchanged bytes. Certificate
fingerprints are acceptance metadata, never the stable receipt issuer. The service
also checks the actual peer certificate's `notBefore` and `notAfter` on every
operation; a real short-lived certificate is tested expiring on an existing TLS
connection. Verdicts retain the acceptance time, key fingerprint and complete
Fleet authorization snapshot in addition to the immutable receipt and result.

Fleet's read completes before the Execution-local transaction starts. It is a
request authorization linearization point, not an atomic distributed revocation
guarantee. The fixture deliberately revokes Fleet immediately after that point and
observes that the already-authorized request can still commit. The next operation
is denied. Production needs a bounded request-digest authorization permit and an
ordered Execution-local revocation gate/acknowledgment if it promises an effective
cutover. The fixture does not implement those distributed controls. Revocation
cannot retroactively cancel previously admitted work or disconnected actions.

## Metadata and immutable identity

This protocol version accepts only schema-defined metadata. Its canonical encoding
is UTF-8 (equivalently ASCII) compact sorted-key JSON with object keys sorted in
ASCII order, no insignificant whitespace, and printable ASCII strings (`0x20`
through `0x7e`). Quotes and backslashes use JSON `\"` and `\\` escaping; other
printable characters remain literal. Numbers are unsigned base-10 integers in
`0..9007199254740991`, with no leading zeros except zero itself. Schema-defined
booleans are JSON `true` and `false`; booleans cannot stand in for integer fields.
Null, floats, NaN, infinities, controls, non-ASCII strings, duplicate keys and
unknown/missing fields are rejected. The wire must exactly equal this canonical
encoding: whitespace, alternate escaped ASCII and `-0` are rejected. Arrays retain
order. This is a scoped metadata format, **not RFC 8785/JCS**.

The metadata digest is SHA-256 over the exact byte concatenation
`b"agents-assemble/runner-authority/v1\x00" + canonical_metadata_bytes`.
Artifact references are lowercase ASCII 64-character SHA-256 hex digests of exact
artifact bytes, without that metadata prefix. Schemas and domain version are fixed
for this disposable experiment; production schema migration is unproved.

A writer binding includes deployment, organization, enrolled runner, host, boot,
journal incarnation and retained journal sequence, run, occurrence, assignment
generation, attempt, invocation, admission, pinned input digest, never-reused scope,
manager activation, profile, manager kind and retained payload-object identity.
The stop command has its own immutable ID/digest. Grants additionally bind the
Execution audience, observer, exact writer binding, allowed operations, finite
expiry and one-invocation admission bound. An authenticated grant-fetch endpoint
returns the grant and digest; the runner verifies typed schema, exact expected
binding, audience, digest, expiry and bound before using it.

Receipt bodies bind all writer fields, stable issuer, receipt ID, grant ID/digest,
stop command ID/digest, typed outcome and exact observation artifact reference.
Metadata authenticates the sender and binds the observation; it cannot make a
false observation truthful.

## Receipt acceptance, replay and recovery

After live peer authorization, Execution starts its own local transaction. Its
inbox key contains operation, deployment, organization, runner and message ID.
An existing exact payload returns its immutable prior verdict before checking an
old grant's expiry/current journal. A changed payload under that key conflicts.
Queries require current authorized identity for the exact scope. Revoked/expired
credentials never get replay/query exceptions. Rejected semantic receipts and
admissions also retain immutable rejection verdicts and outbox records. Authentication
and malformed-wire rejections create no domain verdict.

A new receipt must match the exact stored writer, current authorized host/boot/
journal/profile, server-retained sequence highwater, stable observer, stop command
and active scoped grant. Its artifact reference must resolve to exact bytes and
the fixture observation must match exact scope, payload object and activation,
empty payload and closed launch gate. Authenticated observations from an incomplete
or untrusted profile are recorded as `authenticated_scope_only`; they do not
settle the whole local-writer obligation. Only the explicitly trusted complete
fixture profile produces `stopped`.

The receipt verdict, writer change and outbox commit together. A deliberate fault
between the writer/verdict operations and outbox insert rolls all three back.
Another deliberate fault drops the acknowledgment after commit; identical replay
recovers the fact without a second writer transition or outbox row. SQLite proves
this reduced local transaction only; ADR 0003's selected production PostgreSQL
and its earlier fault evidence remain separate.

Admission separately checks current writer/generation, exact authenticated owner
and current host/boot/journal/profile, fresh bounded authority, eligible profile,
all historical/current writers for the run, external effects, independently verified
baseline/working checkpoint refs and pinned input, evidence quarantine, and budget.
It rehashes checkpoint artifact bytes. Acceptance creates one replacement writer,
advances the current writer/generation, charges allowance, and records its verdict/
outbox in one Execution-local transaction. The observer receipt alone cannot grant
work. Historical acceptance remains queryable after evidence quarantine, but its
future admission use is blocked. An accepted admission replay reports its prior
decision and grants no additional invocation.

A stopped predecessor does not settle an active replacement. The suite separately
rejects a stale predecessor and a current replacement with newly scoped valid
authority whose local-writer obligation remains unresolved.

## Journal continuity and observer trust

A new journal or boot claim cannot attest an old missing scope, and reusing old
writer names with a new incarnation conflicts with the immutable writer binding.
The server retains old obligations and historical accepted verdicts. New identity
can query/replay already accepted history, but cannot create new evidence for old
missing continuity or admit using an old-incarnation grant. Restoring an actual
earlier runner SQLite database is rejected against a retained service highwater.
All active key versions see the current logical identity. This does not detect
rollback of state never observed by the service or establish hardware/boot attestation.
The rollback probe explicitly advances local sequence and uses fixture administration
to retain that highwater in Fleet before restoring the old database; it does not
implement production authenticated highwater synchronization.

The suite intentionally permits a native same-UID subprocess to read the toy
observer private key, edit the journal and authenticate as the observer. Therefore
the unrestricted same-UID profile remains ineligible even after authentication.
Key possession, certificate issuance and signatures would not fix cgroup escape,
unaccounted writers, malicious tools or unknown provider effects. The one positive
recovery relies on a controlled complete observer and independent fixture artifact
verifier; it is not certification of the ADR 0005 native supervisor composition.

No model-account credentials are inspected, copied or proxied. Certificates and
keys are generated solely for this fixture and removed before evidence archival.
Receipts are service-durable immutable accepted verdicts, not portable signed
artifacts. PKI provisioning, administration authorization, production grants,
distributed revocation, HA, remote effects and real checkpoint provenance need
their own implementation and conformance evidence.
