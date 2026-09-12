#!/usr/bin/env python3
"""Throwaway actual native conversation probes. Synthetic content only; no credentials copied."""
import json,time,uuid,subprocess,tempfile,hashlib,platform
from pathlib import Path
from base_client import Client,clean_error
ROOT=Path(__file__).resolve().parent
class Probe(Client):
 def __init__(self,*a,**kw):
  self.responses={}; self.observed=[]; self.items={}
  super().__init__(*a,**kw)
 def capture(self,method,p):
  super().capture(method,p)
  if method in ('item/started','item/completed'):
   i=p['item']; r={'event':method,'type':i['type'],'item':self.alias(i['id'],self.items,'item'),'turn':self.alias(p['turnId'],self.turns,'turn')}
   if i['type']=='userMessage':
    r['text']=[x.get('text') for x in i.get('content',[]) if x.get('type')=='text']
    r['clientUserMessageId']=i.get('clientUserMessageId')
   if i['type']=='agentMessage': r['text']=i.get('text')
   if i['type']=='commandExecution': r.update(status=i.get('status'),exitCode=i.get('exitCode'))
   if i['type']!='reasoning': self.observed.append(r)
  if method in ('item/agentMessage/delta','item/commandExecution/outputDelta'):
   self.observed.append({'event':method,'item':self.alias(p.get('itemId'),self.items,'item'),'bytes':len(p.get('delta',''))})
 def request(self,method,params,rid=None):
  self.serial+=1; rid=rid or self.serial
  self.events.append({'event':'request','method':method,'request':rid})
  self.send({'id':rid,'method':method,'params':params});return rid
 def collect(self,ids,timeout=60):
  end=time.monotonic()+timeout; out={}
  while len(out)<len(ids):
   d=self.next(end)
   if 'id' in d and 'method' not in d:
    self.responses[d['id']]=d
   for i in ids:
    if i in self.responses:out[i]=self.responses.pop(i)
  return [out[i] for i in ids]
 def rpc(self,method,p):return self.collect([self.request(method,p)])[0]
 def until(self,pred,timeout=90):
  end=time.monotonic()+timeout
  while True:
   d=self.next(end)
   if 'id' in d and 'method' not in d:self.responses[d['id']]=d
   if pred(d):return d
 def summary(self,d):
  if 'error' in d:return {'error':{'code':d['error'].get('code'),'message':clean_error(d['error'].get('message'))}}
  r=d.get('result',{}); t=r.get('turnId') or r.get('turn',{}).get('id')
  return {'accepted':True,**({'turn':self.alias(t,self.turns,'turn')} if t else {})}
 def read_summary(self,d):
  if 'error' in d:return self.summary(d)
  return {'turns':[{'turn':self.alias(t['id'],self.turns,'turn'),'status':t['status'],'items':[{'type':i['type'],'item':self.alias(i['id'],self.items,'item'),**({'text':[x.get('text') for x in i.get('content',[]) if x.get('type')=='text'],'clientUserMessageId':i.get('clientUserMessageId')} if i['type']=='userMessage' else {})} for i in t.get('items',[]) if i['type']!='reasoning']} for t in d['result']['thread'].get('turns',[])]}

def inp(text):return [{'type':'text','text':text}]
def main():
 results={'version':subprocess.check_output(['codex','--version'],text=True).strip(),'os':platform.release(),'cases':[]}
 with tempfile.TemporaryDirectory(prefix='aa-conversation-native-') as w:
  p=Probe(ROOT/'events.jsonl',w)
  try:
   results['account']=p.account(); th,settings=p.start(w);results['settings']=settings
   r=p.rpc('turn/start',{'threadId':th,'input':inp("This is a harmless protocol experiment. Run exactly python3 -c 'import time; time.sleep(20); print(\"PROBE_DONE\")' using the shell tool, with no file changes or network operations. After that reply DONE. Do not use any other tools."),'clientUserMessageId':str(uuid.uuid4())});turn=r['result']['turn']['id']
   p.until(lambda d:d.get('method')=='item/started' and d.get('params',{}).get('item',{}).get('type')=='commandExecution')
   bad=p.rpc('turn/steer',{'threadId':th,'expectedTurnId':'wrong-turn','input':inp('SHOULD_NOT_APPLY')})
   results['cases'].append({'name':'wrong active turn','result':p.summary(bad)})
   uid=str(uuid.uuid4());text='Sender Alice: synthetic message ALPHA. After the sleep, mention ALPHA.'
   a=p.request('turn/steer',{'threadId':th,'expectedTurnId':turn,'clientUserMessageId':uid,'input':inp(text)})
   b=p.request('turn/steer',{'threadId':th,'expectedTurnId':turn,'clientUserMessageId':str(uuid.uuid4()),'input':inp('Sender Bob: synthetic message BETA. After the sleep, mention BETA.')})
   results['cases'].append({'name':'concurrent senders','results':[p.summary(x) for x in p.collect([a,b])]})
   for name,txt in [('same client ID same payload',text),('same client ID changed payload','Sender Alice: synthetic message CHANGED.')]:
    r=p.rpc('turn/steer',{'threadId':th,'expectedTurnId':turn,'clientUserMessageId':uid,'input':inp(txt)})
    results['cases'].append({'name':name,'result':p.summary(r)})
   # Preserve actual acceptance, deliberately withhold it from a hypothetical daemon verdict.
   r=p.rpc('turn/steer',{'threadId':th,'expectedTurnId':turn,'clientUserMessageId':str(uuid.uuid4()),'input':inp('Synthetic LOST_ACK message; this probe will not resend it.')})
   results['cases'].append({'name':'acceptance observed by harness probe but reply withheld from modeled caller','result':p.summary(r),'nativeFault':False})
   r=p.rpc('turn/interrupt',{'threadId':th,'turnId':'wrong-turn'})
   results['cases'].append({'name':'wrong turn interrupt','result':p.summary(r)})
   r=p.rpc('turn/interrupt',{'threadId':th,'turnId':turn})
   results['cases'].append({'name':'interrupt acknowledgment','result':p.summary(r)})
   if not any(e.get('event')=='turn/completed' and e.get('turn')==p.turns[turn] for e in p.events):
    p.until(lambda d:d.get('method')=='turn/completed' and d['params']['turn']['id']==turn)
   results['cases'].append({'name':'interrupted turn read','result':p.read_summary(p.rpc('thread/read',{'threadId':th,'includeTurns':True}))})
   results['cases'].append({'name':'steer after terminal','result':p.summary(p.rpc('turn/steer',{'threadId':th,'expectedTurnId':turn,'input':inp('STALE_INPUT')}))})
   # A new turn is explicitly started only by this experimental controller.
   r=p.rpc('turn/start',{'threadId':th,'input':inp('Reply exactly REDIRECT_OK. Do not run any tools.'),'clientUserMessageId':str(uuid.uuid4())});new=r['result']['turn']['id']
   p.until(lambda d:d.get('method')=='turn/completed' and d['params']['turn']['id']==new)
   results['cases'].append({'name':'explicit redirect after terminal','result':p.read_summary(p.rpc('thread/read',{'threadId':th,'includeTurns':True}))})
  except Exception as e:results['failure']=clean_error(e)
  finally:
   p.close();results['observed']=p.observed;results['environmentNames']=p.env_names
 ROOT.joinpath('results.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps({'cases':len(results['cases']),'failure':results.get('failure'),'names':[x['name'] for x in results['cases']]}))
if __name__=='__main__':main()
