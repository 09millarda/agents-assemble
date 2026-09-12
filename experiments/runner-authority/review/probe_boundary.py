#!/usr/bin/env python3
"""Adversarial boundary tests from the documented protocol, using an independent client.

Only setup and explicit fixture-admin state changes use the fixture module.
Every examined protocol operation uses RawSession's standard-library HTTPS path.
"""

import hashlib
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import fixture as subject
from raw_https import RawSession, Results, compact

SOURCE_HASH = hashlib.sha256((HERE.parent / "fixture.py").read_bytes()).hexdigest()
results = Results()


def connect(f, identity="a", ca="ca"):
    return RawSession("localhost", f.port, f.pki / f"{ca}.crt",
                      f.pki / f"{identity}.crt" if identity else None,
                      f.pki / f"{identity}.key" if identity else None)


def send(client, operation, body, **kwargs):
    return client.request("POST", "/" + operation, compact(body), **kwargs)


def auth_or_semantic_rejection(response):
    return response.get("status") in {400, 403, 409} or (
        response.get("status") == 200 and response["body"].get("accepted") is False)


def record(name, expected, response, check, **kwargs):
    results.record(name, expected, response, check, **kwargs)


def ready(f):
    client = connect(f)
    response = send(client, "receipt", f.make_receipt())
    client.close()
    assert response["status"] == 200 and response["body"].get("accepted"), response
    f.execution("UPDATE writer SET effect_state='accounted' WHERE writer_id='writer-1'")
    f.verify_checkpoint()


with subject.Fixture() as f:
    for identity, ca, label in [(None, "ca", "no_client_certificate"), ("wrong_ca", "ca", "untrusted_client_CA"),
                               ("expired_cert", "ca", "expired_client_certificate"), ("a", "foreign-ca", "untrusted_server_CA")]:
        client = connect(f, identity, ca)
        before = f.snapshot()["execution"]
        response = send(client, "receipt", f.make_receipt())
        client.close()
        record(label, "TLS failure before application state change", response,
               response["status"] is None and f.snapshot()["execution"] == before)
    for identity, operation, body, headers, error in [
        ("unregistered", "receipt", f.make_receipt(), {}, "unknown_credential"),
        ("b", "receipt", f.make_receipt(), {"X-Principal": "runner-a", "X-Observer": "observer-a"}, "runner_denied"),
        ("wrong_tenant", "query", f.query(), {}, "organization_denied"),
        ("runner_only", "receipt", f.make_receipt(), {}, "role_denied"),
    ]:
        client = connect(f, identity)
        response = send(client, operation, body, headers=headers)
        client.close()
        record(identity + "_" + operation + "_identity_boundary", error, response,
               response["status"] == 403 and response["body"].get("error") == error)

    original = compact(f.make_receipt())
    encodings = [
        ("generation_boolean", original.replace(b'"generation":1', b'"generation":true')),
        ("journal_sequence_boolean", original.replace(b'"journal_seq":7', b'"journal_seq":true')),
        ("generation_float", original.replace(b'"generation":1', b'"generation":1.0')),
        ("generation_exponent", original.replace(b'"generation":1', b'"generation":1e0')),
        ("generation_nan", original.replace(b'"generation":1', b'"generation":NaN')),
        ("oversized_integer", original.replace(b'"generation":1', b'"generation":9007199254740992')),
        ("null_metadata", original.replace(b'"issuer":"observer-a"', b'"issuer":null')),
        ("nested_object_metadata", original.replace(b'"issuer":"observer-a"', b'"issuer":{"extra":"x"}')),
        ("unknown_top_level_member", original[:-1] + b',"z_extra":"x"}'),
        ("duplicate_member", original[:-1] + b',"receipt_id":"receipt-1"}'),
        ("noncanonical_whitespace", b' ' + original + b'\n'),
        ("noncanonical_ascii_escape", original.replace(b'"observer-a"', b'"observer-\\u0061"')),
        ("negative_zero", original.replace(b'"journal_seq":7', b'"journal_seq":-0')),
        ("unicode_metadata", original.replace(b'"observer-a"', b'"observer-\\u00e9"')),
        ("control_character_metadata", original.replace(b'"observer-a"', b'"observer-\\n"')),
    ]
    client = connect(f)
    before = f.snapshot()["execution"]
    for label, raw in encodings:
        response = client.request("POST", "/receipt", raw)
        record(label, "HTTP 400; no Execution state/inbox/outbox changes", response,
               response["status"] == 400 and f.snapshot()["execution"] == before)

    accepted = send(client, "receipt", f.make_receipt())
    record("canonical_receipt_positive_control", "One accepted stopped receipt", accepted,
           accepted["status"] == 200 and accepted["body"].get("accepted") is True)
    stable = f.snapshot()["execution"]
    replay = send(client, "receipt", f.make_receipt())
    record("exact_receipt_replay", "Original verdict; no state/outbox change", replay,
           replay["body"] == accepted["body"] and f.snapshot()["execution"] == stable)
    conflict = send(client, "receipt", f.make_receipt(outcome="scope_unknown"))
    record("same_id_changed_outcome", "HTTP 409 payload_conflict; no state change", conflict,
           conflict["status"] == 409 and conflict["body"].get("error") == "payload_conflict" and f.snapshot()["execution"] == stable)

    f.execution("UPDATE authority SET expires=0")
    expired = send(client, "receipt", f.make_receipt("new-after-expiry"))
    record("new_evidence_after_grant_expiry", "Semantic grant_expired rejection", expired,
           expired["status"] == 200 and expired["body"].get("reason") == "grant_expired" and expired["body"].get("accepted") is False)
    history = send(client, "query", f.query())
    record("history_survives_invocation_grant_expiry", "Historical accepted verdict", history, history["body"] == accepted["body"])
    f.fleet_update("a", status="revoked")
    blocked = send(client, "query", f.query())
    record("revocation_on_existing_tls_connection", "403 credential_revoked on same established connection", blocked,
           blocked["status"] == 403 and blocked["body"].get("error") == "credential_revoked"
           and blocked["local_port"] == history["local_port"] and blocked["local_port"] is not None)
    client.close()

    rotated = connect(f, "a_rotated")
    replay = send(rotated, "receipt", f.make_receipt())
    record("rotated_key_exact_receipt_replay", "Original immutable verdict with original logical issuer", replay, replay["body"] == accepted["body"])
    history = send(rotated, "query", f.query())
    record("rotated_key_historical_query", "Original immutable verdict", history, history["body"] == accepted["body"])
    f.fleet_update("a_rotated", expires=0)
    blocked = send(rotated, "receipt", f.make_receipt())
    record("expired_enrollment_cannot_use_replay", "403 enrollment_expired", blocked,
           blocked["status"] == 403 and blocked["body"].get("error") == "enrollment_expired")
    rotated.close()

with subject.Fixture() as f:
    client = connect(f)
    accepted = send(client, "receipt", f.make_receipt())
    f.fleet_update("a", highwater=8)
    replay = send(client, "receipt", f.make_receipt())
    record("historical_replay_is_not_current_sequence_claim", "Old immutable verdict despite newer acknowledged highwater", replay, replay["body"] == accepted["body"])
    rotated = connect(f, "a_rotated")
    response = send(rotated, "receipt", f.make_receipt("lower-seq-new-evidence"))
    record("rotation_cannot_bypass_runner_highwater", "New evidence rejected as journal_rollback", response,
           response["body"].get("accepted") is False and response["body"].get("reason") == "journal_rollback")
    rotated.close()
    client.close()

for field, value in [("journal", "journal-2"), ("boot", "boot-2"), ("host", "host-2"), ("profile", "same-uid-unrestricted")]:
    with subject.Fixture() as f:
        ready(f)
        f.fleet_update("a", **{field: value})
        client = connect(f, "a_rotated")
        before = f.snapshot()["execution"]["run"]
        response = send(client, "admit", f.make_admission("rotated-" + field))
        client.close()
        record("rotated_key_cannot_bypass_changed_" + field, "Reject old destination binding; admission budget unchanged", response,
               auth_or_semantic_rejection(response) and f.snapshot()["execution"]["run"] == before)

with subject.Fixture() as f:
    ready(f)
    client = connect(f, "wrong_tenant")
    before = f.snapshot()["execution"]["run"]
    response = send(client, "admit", f.make_admission(organization="org-other"))
    client.close()
    record("cross_tenant_recovery_known_writer", "Deny selected writer owned by another tenant", response,
           auth_or_semantic_rejection(response) and f.snapshot()["execution"]["run"] == before)

with subject.Fixture() as f:
    client = connect(f)
    accepted = send(client, "receipt", f.make_receipt())
    f.verify_checkpoint()
    response = send(client, "admit", f.make_admission("effects-still-unknown"))
    record("stopped_writer_does_not_account_external_effect", "external_effect_unknown", response,
           response["body"].get("accepted") is False and response["body"].get("reason") == "external_effect_unknown")
    f.execution("UPDATE writer SET effect_state='accounted',quarantined=1 WHERE writer_id='writer-1'")
    query = send(client, "query", f.query())
    record("quarantined_evidence_retains_immutable_history", "Accepted original history remains queryable", query, query["body"] == accepted["body"])
    response = send(client, "admit", f.make_admission("quarantined-new-admission"))
    record("quarantined_evidence_cannot_authorize_recovery", "evidence_quarantined", response,
           response["body"].get("accepted") is False and response["body"].get("reason") == "evidence_quarantined")
    f.execution("UPDATE writer SET quarantined=0 WHERE writer_id='writer-1'")
    repeated_rejection = send(client, "admit", f.make_admission("quarantined-new-admission"))
    record("semantic_rejection_is_not_reinterpreted", "Original quarantine rejection remains after assessment changes", repeated_rejection, repeated_rejection["body"] == response["body"])
    admitted = send(client, "admit", f.make_admission("fresh-after-assessment"))
    record("eligible_fresh_admission_positive_control", "One fresh replacement admitted", admitted,
           admitted["body"].get("accepted") is True and f.snapshot()["execution"]["run"][0]["admissions"] == 1)
    before = f.snapshot()["execution"]
    replay = send(client, "admit", f.make_admission("fresh-after-assessment"))
    record("admission_replay_charges_once", "Same admitted verdict; no new replacement or budget change", replay,
           replay["body"] == admitted["body"] and f.snapshot()["execution"] == before)
    replay_receipt = send(client, "receipt", f.make_receipt())
    record("predecessor_receipt_replay_cannot_clear_replacement", "Historical fact leaves replacement unknown", replay_receipt,
           replay_receipt["body"] == accepted["body"] and f.snapshot()["execution"] == before)
    response = send(client, "admit", f.make_admission("second-attempt-old-writer"))
    record("stopped_predecessor_cannot_bypass_live_replacement", "stale_current_writer; still one admission", response,
           response["body"].get("reason") == "stale_current_writer" and f.snapshot()["execution"]["run"][0]["admissions"] == 1)
    current_writer = admitted["body"]["replacement_writer"]
    grant_id, grant_digest = f.authorize_replacement_probe(current_writer)
    response = send(client, "admit", f.make_admission("current-still-active", writer_id=current_writer,
                    generation=2, grant_id=grant_id, grant_digest=grant_digest))
    record("live_replacement_with_own_valid_grant_still_blocks", "local_writer_unresolved; still one admission", response,
           response["body"].get("reason") == "local_writer_unresolved" and f.snapshot()["execution"]["run"][0]["admissions"] == 1)
    client.close()

with subject.Fixture() as f:
    identity = f.short_lived_identity(3)
    client = connect(f, identity)
    accepted = send(client, "receipt", f.make_receipt())
    assert accepted["body"].get("accepted") is True, accepted
    time.sleep(3.2)
    expired = send(client, "query", f.query())
    record("actual_certificate_expiry_on_existing_tls_connection", "403 certificate_expired on same established TLS socket", expired,
           expired["status"] == 403 and expired["body"].get("error") == "certificate_expired"
           and expired["local_port"] == accepted["local_port"] and expired["local_port"] is not None,
           note="Toy client certificate was genuinely valid for 3 seconds; operation was retried after its actual notAfter.")
    client.close()

with subject.Fixture() as f:
    client = connect(f, "a_rotated")
    accepted = send(client, "receipt", f.make_receipt())
    assert accepted["body"].get("accepted") is True, accepted
    f.revoke_runner("a")
    response = send(client, "query", f.query())
    record("runner_retirement_revokes_rotated_key_too", "403 credential_revoked for rotated credential on existing connection", response,
           response["status"] == 403 and response["body"].get("error") == "credential_revoked")
    client.close()

with subject.Fixture() as f:
    def revoke_after_snapshot(authority):
        f.after_auth = None
        f.fleet_update(authority["identity"], status="revoked")
    f.after_auth = revoke_after_snapshot
    client = connect(f)
    response = send(client, "receipt", f.make_receipt())
    record("explicit_revocation_linearization_limitation", "Already-authorized operation may commit after Fleet mutation", response,
           response["body"].get("accepted") is True,
           note="Expected limitation: no ordered Execution-local gate/authorization permit is implemented by this fixture.")
    blocked = send(client, "query", f.query())
    record("subsequent_operation_observes_revocation", "Next operation denied", blocked,
           blocked["status"] == 403 and blocked["body"].get("error") == "credential_revoked")
    client.close()

report_path = HERE / "boundary-results.json"
report = results.save(report_path)
report.update(fixture_sha256=SOURCE_HASH, reviewed_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              limits=["Real TLS and application acceptance; fixture setup/admin/verifier/physical observation are controlled inputs.",
                      "No production PostgreSQL, native supervisor, enrollment UI, compromised-host resistance or propagated revocation gate certification."])
report_path.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"passed": report["passed"], "failed": report["failed"], "output": str(report_path)}))
sys.exit(bool(report["failed"]))
