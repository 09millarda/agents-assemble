# Disposable enrolled-runner authority experiment

This experiment exercises real TLS client/server authentication and a reduced,
durable receipt/admission protocol for decision #10. It is deliberately disposable
and is not production enrollment, tunnel, supervision or PKI code.

Run from this directory with Python 3.11+ and the OpenSSL command-line tool:

```sh
python3 fixture.py --output evidence.json
```

The fixture creates a private temporary directory (`0700`), generates two local
CAs and short-lived server/client certificates, starts a loopback TLS 1.3 HTTPS
service, and creates separate Fleet, Execution and runner SQLite databases. It
deletes that directory at completion. Do not archive keys, certificates, runtime
databases or temporary directories. `evidence.json` contains sanitized complete
before/after database state and artifact hash/length state for each probe. It
contains no private keys, certificates, model credentials or real user payloads.

`fixture.py` prints PASS only after all assertions complete. A failure raises an
exception. The evidence file records runtime versions and authoritative scenario
and check counts; avoid interpreting a high count as proof of production coverage.

The probes include failed real TLS handshakes (no client certificate, wrong client
CA, genuinely expired certificate, wrong service hostname and wrong service CA),
CA-valid but unenrolled credentials, two enrolled runner identities, server-owned
roles/tenant/deployment bindings, receipt issuer and scope substitution, canonical
metadata rejection, authenticated grant fetch and runner-side grant verification,
expiry/revocation, same-connection revocation, rotation, durable lost acknowledgments,
atomic rollback, actual journal database replacement/rollback, historical queries,
artifact-byte corruption, independent recovery gates and one exact positive recovery.

A same-UID subprocess reads the toy observer key, tampers with the toy journal and
successfully impersonates the observer over TLS. Its profile remains ineligible for
recovery. The positive profile is explicitly trusted, complete controlled fixture
input. No actual cgroup empty observation or general tool-isolation proof is made.

## Independent probe interface

Import `Fixture`, `ProtocolError`, `canonical`, `digest`, `BINDING` and
`run_suite` from `fixture.py`. Importing the module does not run the suite.

```python
from fixture import Fixture

with Fixture() as f:
    receipt = f.make_receipt()
    status, result = f.request("a", "receipt", receipt)
    assert status == 200 and result["accepted"]
    connection = f.connection("a")
    try:
        assert f.request("a", "query", f.query(), connection=connection)[0] == 200
        f.fleet_update("a", status="revoked")
        assert f.request("a", "query", f.query(), connection=connection)[0] == 403
    finally:
        connection.close()
```

`request(identity, operation, body, raw=..., connection=..., headers=...,
hostname=..., ca=...)` returns `(HTTP status, decoded response)`; status zero
denotes TLS/transport failure. `identity` is only a local selector for an actual
certificate/key pair; the HTTP server never accepts that argument or a caller
principal. The service derives client identity from
`SSLSocket.getpeercert(binary_form=True)`; clients verify the service CA and hostname.

Available local certificate selectors are `a`, `a_rotated`, `b`, `runner_only`,
`wrong_tenant`, `expired_cert`, `unregistered`, `wrong_ca`; `None` sends no certificate.
`f.port` is the service port. `f.pki` contains temporary test credentials for custom
network probes; do not print or archive their contents. `f.snapshot()` returns
sanitized full durable state. `make_receipt`, `make_admission` and `query` produce
request templates. `fetch_grant` uses real HTTPS; `verify_grant` validates the
returned structured grant digest and exact expected binding.

`fleet_update`, `revoke_runner`, `execution`, `verify_checkpoint`, `add_artifact`,
`replace_journal`, `persist_runner_receipt`, `authorize_replacement_probe`,
`after_auth` and `fail_transaction` are explicit fixture-administration/fault
injection interfaces. None is remotely exposed. The test can revoke a credential,
change current logical identity or independently account a controlled external
effect; this does not implement or authenticate a production administrative API.

See [protocol.md](protocol.md) for the exact contract and limits.

## Independent review and browser lab

```sh
python3 review/probe_boundary.py
python3 viewer/build.py
```

The final independent suite passes 52 boundary cases against the source hash
recorded in `review/boundary-results.json`; see `review/results.md`. The earlier
five regression cases overlap that suite and are not five additional unique tests.

Open `runner-authority-lab.html` directly to explore the illustrative model and
inspect embedded measured evidence. Its free-play/guided scenarios do not perform
TLS and do not contribute to empirical counts. The bundle includes complete
sanitized state records; the model exposes its complete state after each action.
