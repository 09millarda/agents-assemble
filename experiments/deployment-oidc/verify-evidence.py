"""Read-only verification of sanitized real-token probe evidence. No credentials/API calls."""
import hashlib,json,pathlib,re
p=pathlib.Path(__file__).parent
r=json.loads((p/'evidence/result.json').read_text())
m=json.loads((p/'evidence/run.json').read_text())
assert m['conclusion']=='success' and m['id']==34770046279
assert len(r['checks'])==7 and all(c['passed'] for c in r['checks'])
for name,h in r['source_sha256'].items():assert hashlib.sha256((p/name).read_bytes()).hexdigest()==h,name
c=r['claims'];assert c['run_id']==str(m['id']) and c['run_attempt']==str(m['run_attempt']) and c['workflow_sha']==m['head_sha']
assert c['repository_id']=='1366483946' and c['iss']=='https://token.actions.githubusercontent.com'
effects={e['id']:e for e in r['snapshot']['effects']}
assert effects['approved']['state']=='claimed' and effects['approved']['claim_run']==c['run_id']
assert effects['wrong-workflow']['state']=='approved' and effects['revoked']['state']=='approved' and effects['revoked']['revoked']
assert len(r['snapshot']['outbox'])==1
assert sum(o.get('result',{}).get('verdict')=='claim-admitted' for o in r['observations'])==1
assert not re.search(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',json.dumps(r))
print('Verified seven real-token/controlled-claim scenarios, one durable claim, binding denials and matching executed source hashes')
