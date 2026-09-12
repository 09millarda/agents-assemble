#!/usr/bin/env python3
"""Independent network reproductions of source-review findings."""

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from fixture import Fixture
from raw_https import RawSession, Results, compact


def connect(f, identity="a"):
    return RawSession("localhost", f.port, f.pki / "ca.crt", f.pki / f"{identity}.crt", f.pki / f"{identity}.key")


def prepare(f):
    client = connect(f)
    receipt = client.request("POST", "/receipt", compact(f.make_receipt()))
    client.close()
    assert receipt["status"] == 200 and receipt["body"].get("accepted"), receipt
    f.execution("UPDATE writer SET effect_state='accounted' WHERE writer_id='writer-1'")
    f.verify_checkpoint()


def denied(result):
    return result.get("status") in {400, 403, 409} or (result.get("status") == 200 and result["body"].get("accepted") is False)


results = Results()
with Fixture() as f:
    prepare(f)
    client = connect(f, "wrong_tenant")
    before = f.snapshot()["execution"]["run"]
    response = client.request("POST", "/admit", compact(f.make_admission(organization="org-other")))
    after = f.snapshot()["execution"]["run"]
    client.close()
    results.record("cross_tenant_recovery_known_writer", "Denied and org-1 run/admissions unchanged", {"response": response, "before": before, "after": after}, denied(response) and before == after)

with Fixture() as f:
    prepare(f)
    f.replace_journal()
    client = connect(f)
    before = f.snapshot()["execution"]["run"]
    response = client.request("POST", "/admit", compact(f.make_admission()))
    after = f.snapshot()["execution"]["run"]
    client.close()
    results.record("new_incarnation_cannot_inherit_old_destination", "Denied and admissions unchanged", {"response": response, "before": before, "after": after}, denied(response) and before == after)

for name, transform in [
    ("noncanonical_whitespace", lambda raw: b" " + raw + b"\n"),
    ("alternate_ascii_escape", lambda raw: raw.replace(b'"observer-a"', b'"observer-\\u0061"')),
    ("negative_zero_journal_sequence", lambda raw: raw.replace(b'"journal_seq":7', b'"journal_seq":-0')),
]:
    with Fixture() as f:
        client = connect(f)
        raw = transform(compact(f.make_receipt()))
        response = client.request("POST", "/receipt", raw)
        client.close()
        results.record(name, "Rejected at encoding/schema boundary", response, response.get("status") == 400)

out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "regression-results.json"
report = results.save(out)
report["fixture_sha256"] = hashlib.sha256((HERE.parent / "fixture.py").read_bytes()).hexdigest()
out.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"passed": report["passed"], "failed": report["failed"], "output": str(out)}))
