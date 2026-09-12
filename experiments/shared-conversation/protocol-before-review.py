#!/usr/bin/env python3
"""THROWAWAY durable delivery experiment; separate SQLite journals, modeled authority/native.
Not production schema. SQLite is a fixture choice; service PostgreSQL remains ADR 0003.
"""
import hashlib,json,sqlite3,sys,os,signal
from pathlib import Path

def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def initial():return {'scope':{'org':'org-A','run':'run-A','attempt':'attempt-A','generation':1,'journal':'journal-A','thread':'thread-A','turn':'turn-A'},'members':{'alice':True,'bob':True},'valid':True,'revisionPaused':False,'terminal':False,'next':1,'commands':{},'events':[],'output':{},'cursor':0,'approval':False,'writerStopped':False,'effectsSettled':False,'newAdmission':False}
class Journal:
 def __init__(self,path):
  self.db=sqlite3.connect(path,timeout=15,isolation_level=None)
  self.db.execute('pragma journal_mode=WAL');self.db.execute('pragma synchronous=FULL')
  self.db.execute('create table if not exists journal (id integer primary key check(id=1), body text not null)')
  self.db.execute('insert or ignore into journal values(1,?)',(json.dumps(initial()),))
 def read(self):return json.loads(self.db.execute('select body from journal where id=1').fetchone()[0])
 def change(self,f):
  self.db.execute('begin immediate')
  try:
   s=self.read();r=f(s);self.db.execute('update journal set body=? where id=1',(json.dumps(s,sort_keys=True),));self.db.execute('commit');return r
  except BaseException:self.db.execute('rollback');raise
 def close(self):self.db.close()
class Lab:
 def __init__(self,path):
  self.path=Path(path);self.path.mkdir(exist_ok=True,parents=True)
  self.service=Journal(self.path/'service.db');self.daemon=Journal(self.path/'daemon.db');self.native=Journal(self.path/'native.db')
 def close(self):
  for j in (self.service,self.daemon,self.native):j.close()
 def snap(self):return {'service':self.service.read(),'daemon':self.daemon.read(),'modeledNative':self.native.read()}
 def mutate(self,**kw):return self.service.change(lambda s:s.update(kw))
 def submit(self,key='input-1',sender='alice',text='ALPHA',scope=None,kind='steer'):
  def f(s):
   if not s['members'].get(sender):return 'unauthorized'
   body={'key':key,'sender':sender,'text':text,'scope':scope or s['scope'].copy(),'kind':kind};h=digest(body)
   if body['scope']!=s['scope']:return 'wrong-scope'
   old=s['commands'].get(key)
   if old:return old['status'] if old['digest']==h else 'conflict'
   if kind not in ('steer','interrupt'):return 'unsupported'
   if not s['valid'] or (s['revisionPaused'] and kind=='steer') or s['terminal']:return 'not-admitted'
   if len([c for c in s['commands'].values() if c['status']=='queued'])>=4:return 'queue-full'
   s['commands'][key]={'body':body,'digest':h,'seq':s['next'],'status':'queued'};s['next']+=1
   return 'queued'
  return self.service.change(f)
 def receive(self,key):
  s=self.service.read();c=s['commands'][key]
  def f(d):
   old=d['commands'].get(key)
   if old:return old['status'] if old['digest']==c['digest'] else 'conflict'
   d['commands'][key]={**c,'status':'received'};return 'received'
  return self.daemon.change(f)
 def gate(self,key):
  s=self.service.read();d=self.daemon.read();c=d['commands'][key];b=c['body']
  # The fixture calls current authority synchronously. Production requires scoped,
  # bounded authorization and effective revocation cutoff (ADR 0006).
  if b['scope']!=s['scope']:return 'wrong-scope'
  if not s['members'].get(b['sender']):return 'unauthorized'
  if not s['valid'] or s['terminal'] or (s['revisionPaused'] and b['kind']=='steer'):return 'not-admitted'
  if b['kind']=='steer' and any(x['seq']<c['seq'] and x['status'] not in ('accepted','rejected') for x in d['commands'].values()):return 'ordered-wait'
  # Missing earlier daemon command is also a barrier: delivery can reorder.
  if b['kind']=='steer' and any(x['seq']<c['seq'] and x['body']['kind']=='steer' and d['commands'].get(k,{}).get('status') not in ('accepted','rejected') for k,x in s['commands'].items()):return 'ordered-wait'
  return 'allowed'
 def intent(self,key):
  g=self.gate(key)
  if g!='allowed':return g
  def f(d):
   c=d['commands'][key]
   if c['status']!='received':return c['status']
   c['status']='sending';return 'sending'
  return self.daemon.change(f)
 def native_call(self,key,outcome='accepted'):
  # No native dedup assumed; count actual modeled side effects.
  c=self.daemon.read()['commands'][key]
  if c['status']!='sending':return 'not-sending'
  def f(n):
   n['events'].append({'key':key,'digest':c['digest'],'kind':c['body']['kind'],'outcome':outcome});return outcome
  return self.native.change(f)
 def receipt(self,key,outcome='accepted'):
  def f(d):
   c=d['commands'][key]
   if c['status'] in ('accepted','rejected'):return c['status']
   if c['status'] not in ('sending','unknown'):return 'not-sent'
   c['status']=outcome;return outcome
  return self.daemon.change(f)
 def reconcile(self,key):
  c=self.daemon.read()['commands'][key]
  def f(s):
   old=s['commands'][key]
   if old['digest']!=c['digest']:return 'conflict'
   # History stays about original target; it never advances current scope.
   old['status']=c['status'];return old['status']
  return self.service.change(f)
 def recover(self):
  def f(d):
   for c in d['commands'].values():
    if c['status']=='sending':c['status']='unknown'
  self.daemon.change(f)
 def send(self,key):
  self.receive(key);r=self.intent(key)
  if r=='sending':self.native_call(key);self.receipt(key);return self.reconcile(key)
  return r
 def output(self,seq,payload,epoch='journal-A'):
  def f(s):
   if epoch!=s['scope']['journal']:return 'wrong-journal'
   key=f'{epoch}:{seq}';h=digest(payload)
   if key in s['output']:return 'duplicate' if s['output'][key]['digest']==h else 'conflict'
   if seq!=s['cursor']+1:return 'gap'
   s['output'][key]={'digest':h,'payload':payload};s['cursor']=seq;return 'stored'
  return self.service.change(f)
 def replay(self,sender,cursor):
  s=self.service.read()
  if not s['members'].get(sender):return {'error':'unauthorized'}
  if cursor<max(0,s['cursor']-3):return {'error':'snapshot-required','earliest':max(1,s['cursor']-2),'through':s['cursor']}
  return {'through':s['cursor'],'events':[v for k,v in s['output'].items() if int(k.split(':')[-1])>cursor]}

def crash_worker(path,stage):
 l=Lab(path);l.receive('input-1')
 if stage!='after-receive':l.intent('input-1')
 if stage in ('after-native','after-receipt','after-service'):l.native_call('input-1')
 if stage in ('after-receipt','after-service'):l.receipt('input-1')
 if stage=='after-service':l.reconcile('input-1')
 Path(path,'barrier').write_text(stage);os.kill(os.getpid(),signal.SIGSTOP)
if __name__=='__main__':crash_worker(sys.argv[1],sys.argv[2])
