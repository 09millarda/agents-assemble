"""Read-only checks on the retained experiment archive; no provider calls."""
import gzip, hashlib, json, pathlib
p = pathlib.Path(__file__).parent
g = json.loads((p/'evidence/github.json').read_text())
e = json.loads(gzip.decompress((p/'evidence/protocol.json.gz').read_bytes()))
assert all(c['passed'] for c in e['checks'])
for name, digest in e['source_sha256'].items():
    assert hashlib.sha256((p/name).read_bytes()).hexdigest() == digest, name
first, duplicate, lost = g['dispatches']
assert first['request'] == duplicate['request']
assert first['response']['workflow_run_id'] != duplicate['response']['workflow_run_id']
assert lost['response'] is None
assert len(g['runs']) == 3 and sum(len(r['attempts']) for r in g['runs']) == 4
assert len([r for r in g['runs'] if r['run_attempt'] == 2]) == 1
for r in g['runs']:
    assert r['repository_id'] == 1366483946 and r['head_sha'] == g['workflow_commit']
    for a in r['attempts']:
        assert a['conclusion'] == 'success'
        o = a['observation']
        assert o['GITHUB_RUN_ID'] == str(r['id']) and o['GITHUB_RUN_ATTEMPT'] == str(a['run_attempt'])
        assert o['GITHUB_WORKFLOW_SHA'] == g['workflow_commit']
        request = next(d['request']['inputs'] for d in g['dispatches'] if d['request']['inputs']['effect_id'] == o['EFFECT_ID'])
        assert o['MANIFEST_SHA256'] == request['manifest_sha256'] and o['NONCE'] == request['nonce']
assert any(t.get('barrier') == 'worker-confirmed-waiting-before-expiry' for t in e['traces'])
assert sum(t.get('outcome',{}).get('signal') == 'SIGKILL' for t in e['traces']) == 5
print(f"Verified {len(e['checks'])} controlled scenario groups, five SIGKILL barriers, three actual GitHub runs/four attempts and matching source hashes")
