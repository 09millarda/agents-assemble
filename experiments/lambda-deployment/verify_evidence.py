"""Check archived evidence consistency; does not rerun AWS or certify the adapter."""
import datetime,hashlib,json,re
from pathlib import Path

root=Path(__file__).resolve().parent/'evidence'
records=json.loads((root/'github-runs.json').read_text())
events=json.loads((root/'stack-events.json').read_text())
assert len(records)==7 and len({r['run']['databaseId'] for r in records})==7
healthy=[];unhealthy=[]
for record in records:
 assert record['run']['status']=='completed'
 manifests=[r for r in record['observations'] if 'manifest' in r]
 assert len(manifests)==1
 m=manifests[0]
 assert hashlib.sha256(json.dumps(m['manifest'],sort_keys=True,separators=(',',':')).encode()).hexdigest()==m['manifest_sha256']
 assert m['manifest']['workflow_sha']==record['run']['headSha']
 results=[r for r in record['observations'] if 'provider_update' in r]
 if not results:
  assert record['run']['databaseId']==34766091078 and record['run']['conclusion']=='failure'
  continue
 assert len(results)==1
 r=results[0];a=m['manifest']['artifact'];env=m['manifest']['environment']
 assert r['manifest_sha256']==m['manifest_sha256']
 assert r['lambda']['sha256']==a['sha256'] and r['lambda']['environment']==env
 assert r['health']['body']['release']==a['source'] and r['health']['body']['environment']==env
 assert any(e['ClientRequestToken']==r['effect'] and e['ResourceType']=='AWS::CloudFormation::Stack' and e['ResourceStatus']=='UPDATE_COMPLETE' for e in events[env])
 if r['application_health']=='healthy':
  assert r['health']['status']==200 and record['run']['conclusion']=='success';healthy.append(a)
 else:
  assert r['health']['status']==503 and record['run']['conclusion']=='failure';unhealthy.append(a)
assert len(healthy)==4 and all(a==healthy[0] for a in healthy)
assert len(unhealthy)==2 and unhealthy[0]==unhealthy[1] and healthy[0]['sha256']!=unhealthy[0]['sha256']
state=json.loads((root/'bootstrap-and-cleanup.json').read_text())
start=datetime.datetime.fromisoformat(state['created_at']);end=datetime.datetime.fromisoformat(state['cleanup_completed_at'])
assert datetime.timedelta(0)<end-start<datetime.timedelta(hours=24)
checks=json.loads((root/'cleanup-verification.json').read_text())
assert checks['bucket_absent'] and checks['fixture_roles_absent'] and not checks['remaining_fixture_apis'] and not checks['remaining_fixture_log_groups']
for p in root.glob('*.json'):
 text=p.read_text();assert not re.search(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|eyJ[A-Za-z0-9_-]+\.eyJ',text),p
print('Validated 7 run records, 6 provider-effect chains, same-artifact promotion/restoration, 2 detected health failures and cleanup within 24 hours.')
