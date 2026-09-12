#!/usr/bin/env python3
"""Throwaway persistent native readback; all input synthetic; login stays native."""
from probe import Probe,inp,ROOT
from base_client import clean_error
import tempfile,json,time,uuid,subprocess

def main():
 result={'version':subprocess.check_output(['codex','--version'],text=True).strip(),'cases':[]}
 with tempfile.TemporaryDirectory(prefix='aa-conversation-persistent-') as w:
  p=Probe(ROOT/'persistent-events.jsonl',w);second=None;th=None
  try:
   r=p.rpc('thread/start',{'cwd':w,'sandbox':'read-only','approvalPolicy':'never','ephemeral':False});th=r['result']['thread']['id'];result['settings']={k:r['result'].get(k) for k in ['model','reasoningEffort','approvalPolicy','sandbox']}
   uid=str(uuid.uuid4()); result['clientIds']={'initial':uid,'duplicate':str(uuid.uuid4()),'bob':str(uuid.uuid4()),'startWhileActive':str(uuid.uuid4())}
   hold="Run exactly python3 -c 'import time; time.sleep(12); print(\"HOLD_DONE\")' once. No file changes or network operations. Afterwards acknowledge each synthetic user message you have received with its token. Use no other tools."
   r=p.rpc('turn/start',{'threadId':th,'input':inp(hold),'clientUserMessageId':uid});old=r['result']['turn']['id']
   p.until(lambda d:d.get('method')=='item/started' and d.get('params',{}).get('item',{}).get('type')=='commandExecution')
   shared=result['clientIds']['duplicate']
   for name,method,text,cid in [('alice','turn/steer','Sender Alice token ALPHA.',shared),('bob','turn/steer','Sender Bob token BETA.',result['clientIds']['bob']),('duplicate exact','turn/steer','Sender Alice token ALPHA.',shared),('duplicate changed','turn/steer','Sender Alice token CHANGED.',shared),('start while active','turn/start','Sender Carol token START_ACTIVE.',result['clientIds']['startWhileActive'])]:
    params={'threadId':th,'input':inp(text),'clientUserMessageId':cid}
    if method=='turn/steer':params['expectedTurnId']=old
    r=p.rpc(method,params);result['cases'].append({'name':name,'result':p.summary(r)})
   p.until(lambda d:d.get('method')=='turn/completed' and d['params']['turn']['id']==old,timeout=150)
   result['cases'].append({'name':'completed duplicate readback','result':p.read_summary(p.rpc('thread/read',{'threadId':th,'includeTurns':True}))})
   r=p.rpc('turn/start',{'threadId':th,'input':inp(hold),'clientUserMessageId':str(uuid.uuid4())});new=r['result']['turn']['id']
   p.until(lambda d:d.get('method')=='item/started' and d.get('params',{}).get('item',{}).get('type')=='commandExecution')
   result['cases'].append({'name':'old steer while successor active','result':p.summary(p.rpc('turn/steer',{'threadId':th,'expectedTurnId':old,'input':inp('DO_NOT_APPLY')}))})
   result['cases'].append({'name':'old interrupt while successor active','result':p.summary(p.rpc('turn/interrupt',{'threadId':th,'turnId':old}))})
   result['cases'].append({'name':'exact successor interrupt','result':p.summary(p.rpc('turn/interrupt',{'threadId':th,'turnId':new}))})
   if not any(e.get('event')=='turn/completed' and e.get('turn')==p.turns[new] for e in p.events):p.until(lambda d:d.get('method')=='turn/completed' and d['params']['turn']['id']==new)
   result['beforeRestart']=p.read_summary(p.rpc('thread/read',{'threadId':th,'includeTurns':True}))
   p.close();result['observed']=p.observed
   second=Probe(ROOT/'restart-events.jsonl',w)
   # Preserve aliases so comparisons are meaningful.
   second.threads=p.threads.copy();second.turns=p.turns.copy();second.items=p.items.copy()
   result['afterRestart']=second.read_summary(second.rpc('thread/read',{'threadId':th,'includeTurns':True}))
   result['resume']=second.read_summary(second.rpc('thread/resume',{'threadId':th}))
   result['archive']=second.summary(second.rpc('thread/archive',{'threadId':th}))
  except Exception as e:result['failure']=clean_error(e)
  finally:
   if p.proc.poll() is None:p.close()
   if second:second.close()
 ROOT.joinpath('persistent-results.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'cases':len(result['cases']),'failure':result.get('failure'),'restartRead':bool(result.get('afterRestart'))}))
if __name__=='__main__':main()
