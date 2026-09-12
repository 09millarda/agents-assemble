#!/usr/bin/env python3
"""Inspect retained native evidence without new inference."""
import json,hashlib
from pathlib import Path
R=Path(__file__).resolve().parent
r=json.loads((R/'persistent-results.json').read_text());e=json.loads((R/'results.json').read_text());checks=[]
def check(name,ok):checks.append({'name':name,'pass':bool(ok)})
check('ephemeral probe completed',not e.get('failure'))
check('persistent probe completed',not r.get('failure'))
case={x['name']:x['result'] for x in r['cases']}
items=case['completed duplicate readback']['turns'][0]['items'];dup=[i for i in items if i.get('clientId')==r['clientIds']['duplicate']]
check('three occurrences share one clientId',len(dup)==3)
check('same and changed payloads all retained',[i['text'] for i in dup]==[['Sender Alice token ALPHA.'],['Sender Alice token ALPHA.'],['Sender Alice token CHANGED.']])
check('native item IDs distinct',len({i['item'] for i in dup})==3)
check('start while active targeted original turn',case['start while active']['turn']=='turn-1')
for name in ['old steer while successor active','old interrupt while successor active']:check(name,case[name]['error']['code']==-32600)
check('exact interrupt acknowledged',case['exact successor interrupt']['accepted'])
check('restart read has interrupted status',r['afterRestart']['turns'][-1]['status']=='interrupted')
check('resume reads same retained representation',r['resume']==r['afterRestart'])
check('persistent probe archived its thread',r['archive']['accepted'])
before=[i for t in r['beforeRestart']['turns'] for i in t['items'] if i['type']=='userMessage'];after=[i for t in r['afterRestart']['turns'] for i in t['items'] if i['type']=='userMessage']
check('user IDs and bytes survive restart',before==after)
check('restart hydration differs from immediate interrupt snapshot',r['beforeRestart']!=r['afterRestart'])
check('ephemeral history unsupported',any(x['name']=='interrupted turn read' and 'ephemeral' in x['result']['error']['message'] for x in e['cases']))
check('terminal steering rejected',any(x['name']=='steer after terminal' and 'error' in x['result'] for x in e['cases']))
check('redirect output observed',any(x.get('text')=='REDIRECT_OK' for x in e['observed']))
for filename in ['events.jsonl','persistent-events.jsonl','restart-events.jsonl']:
 ev=[json.loads(x) for x in (R/filename).read_text().splitlines()]
 check(filename+' owned server exited',ev[-1]['event']=='probe_owned_process_exit' and ev[-1]['returnCode']==0)
report={'checks':len(checks),'failed':sum(not x['pass'] for x in checks),'results':checks}
(R/'audit-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));assert not report['failed']
