#!/usr/bin/env python3
"""Disposable fault scenarios and full state snapshots; no production test suite."""
import concurrent.futures,json,os,signal,subprocess,sys,tempfile,time,hashlib
from pathlib import Path
from protocol import Lab,digest
ROOT=Path(__file__).resolve().parent
results=[]
def scenario(name,fn):
 with tempfile.TemporaryDirectory(prefix='aa-delivery-') as td:
  l=Lab(td);checks=[]
  def check(actual,want):
   checks.append({'actual':actual,'expected':want,'pass':actual==want})
   if actual!=want:raise AssertionError(f'{name}: {actual!r} != {want!r}')
  error=None
  try:fn(l,check)
  except Exception as e:error=str(e)
  results.append({'name':name,'checks':checks,'error':error,'state':l.snap()});l.close()
def happy(l,c):
 c(l.submit(),'queued');c(l.send('input-1'),'accepted');c(l.submit(),'accepted');c(len(l.native.read()['events']),1)
scenario('exact retries replay verdict without another native call',happy)
scenario('changed duplicate conflicts',lambda l,c:(c(l.submit(),'queued'),c(l.submit(text='changed'),'conflict')))
scenario('different sender cannot borrow identity',lambda l,c:(c(l.submit(),'queued'),c(l.submit(sender='bob'),'conflict')))
scenario('unauthorized sender',lambda l,c:c(l.submit(sender='mallory'),'unauthorized'))
for field,value in [('org','org-B'),('run','run-B'),('attempt','attempt-B'),('generation',2),('journal','journal-B'),('thread','thread-B'),('turn','turn-B')]:
 scenario('reject mismatched '+field,lambda l,c,f=field,v=value:c(l.submit(scope={**l.service.read()['scope'],f:v}),'wrong-scope'))
def revoke(l,c):
 l.submit();l.receive('input-1');l.mutate(members={'alice':False,'bob':True});c(l.intent('input-1'),'unauthorized');c(l.native.read()['events'],[])
scenario('revoke before native dispatch',revoke)
def pause(l,c):
 l.submit();l.receive('input-1');l.mutate(revisionPaused=True);c(l.intent('input-1'),'not-admitted');c(l.service.read()['approval'],False)
scenario('document revision gate independently blocks instruction',pause)
def scope(l,c):
 l.submit();l.receive('input-1');l.mutate(scope={**l.service.read()['scope'],'attempt':'successor','generation':2});c(l.intent('input-1'),'wrong-scope')
scenario('queued predecessor input never follows successor',scope)
def ordering(l,c):
 l.submit();l.submit(key='input-2',sender='bob');l.receive('input-2');c(l.intent('input-2'),'ordered-wait');c(l.send('input-1'),'accepted');c(l.send('input-2'),'accepted');c([x['key'] for x in l.native.read()['events']],['input-1','input-2'])
scenario('reordered transport preserves two-sender order',ordering)
def unknown(l,c):
 l.submit();l.submit(key='input-2');l.receive('input-1');l.intent('input-1');l.native_call('input-1');l.recover();l.receive('input-2');c(l.intent('input-1'),'unknown');c(l.intent('input-2'),'ordered-wait');c(len(l.native.read()['events']),1)
scenario('uncertain input blocks later instructions',unknown)
def interrupt(l,c):
 unknown(l,c);l.submit(key='stop',kind='interrupt');c(l.send('stop'),'accepted');c(l.service.read()['writerStopped'],False);c(l.service.read()['newAdmission'],False);c(l.service.read()['effectsSettled'],False)
scenario('interrupt bypasses uncertain instruction queue without stop or admission claim',interrupt)
def terminal(l,c):
 l.submit();l.receive('input-1');l.mutate(terminal=True);c(l.intent('input-1'),'not-admitted');c(l.submit(key='redirect'),'not-admitted')
scenario('terminal race requires new admission for redirect',terminal)
def ack(l,c):
 l.submit();l.receive('input-1');l.intent('input-1');l.native_call('input-1');l.receipt('input-1');l.recover();c(l.reconcile('input-1'),'accepted');c(l.send('input-1'),'accepted');c(len(l.native.read()['events']),1)
scenario('lost service receipt reply replays durable daemon verdict',ack)
def reject(l,c):
 l.submit();l.receive('input-1');l.intent('input-1');l.native_call('input-1','rejected');l.receipt('input-1','rejected');c(l.reconcile('input-1'),'rejected');c(l.send('input-1'),'rejected')
scenario('definitive native rejection stays rejected',reject)
def bound(l,c):
 for i in range(4):c(l.submit(key=str(i)),'queued')
 c(l.submit(key='overflow'),'queue-full')
scenario('bounded input queue gives explicit refusal',bound)
def concurrency(l,c):
 def worker(i):
  p=Lab(l.path)
  try:return p.submit(key='one',text='same')
  finally:p.close()
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:c(list(ex.map(worker,range(4))),['queued']*4)
 c(len(l.service.read()['commands']),1);c(l.service.read()['next'],2)
scenario('actual concurrent commits allocate one input identity',concurrency)
def out(l,c):
 c(l.output(1,{'text':'hello'}),'stored');c(l.output(1,{'text':'hello'}),'duplicate');c(l.output(1,{'text':'bad'}),'conflict');c(l.output(3,{}),'gap');c(l.output(2,{},'old'),'wrong-journal');c(l.output(2,{'done':True}),'stored');c(l.replay('alice',1)['through'],2)
scenario('output deduplication gap and epoch',out)
def replay(l,c):
 for i in range(1,7):l.output(i,{'item':str(i)})
 c(l.replay('alice',0)['error'],'snapshot-required');l.mutate(members={'alice':False});c(l.replay('alice',5)['error'],'unauthorized')
scenario('slow reader snapshot boundary and read revocation',replay)
for stage,want,calls in [('after-receive','received',0),('after-intent','unknown',0),('after-native','unknown',1),('after-receipt','accepted',1),('after-service','accepted',1)]:
 def crash(l,c,stage=stage,want=want,calls=calls):
  l.submit();p=subprocess.Popen([sys.executable,str(ROOT/'protocol.py'),str(l.path),stage])
  try:
   end=time.monotonic()+10
   while time.monotonic()<end:
    status=Path(f'/proc/{p.pid}/status').read_text()
    if (l.path/'barrier').exists() and '\nState:\tT' in status:break
    time.sleep(.01)
   else:raise RuntimeError('worker did not reach stopped barrier')
   os.kill(p.pid,signal.SIGKILL);p.wait(timeout=5);c(p.returncode,-9)
   l.close();l.__init__(l.path);l.recover();c(l.daemon.read()['commands']['input-1']['status'],want);c(len(l.native.read()['events']),calls)
   if want=='received':c(l.send('input-1'),'accepted');c(len(l.native.read()['events']),1)
   elif want=='accepted':c(l.reconcile('input-1'),'accepted');c(l.send('input-1'),'accepted');c(len(l.native.read()['events']),1)
   else:c(l.intent('input-1'),'unknown');c(len(l.native.read()['events']),calls)
  finally:
   if p.poll() is None:p.kill();p.wait()
 scenario('actual process SIGKILL '+stage,crash)
report={'kind':'separate durable SQLite and modeled-native experiment','sourceHash':digest({n:(ROOT/n).read_text() for n in ['protocol.py','run_experiment.py']}),'scenarios':len(results),'checks':sum(len(x['checks']) for x in results),'failed':sum(bool(x['error']) for x in results),'results':results}
(ROOT/'evidence.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='results'}));sys.exit(bool(report['failed']))
