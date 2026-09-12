#!/usr/bin/env python3
"""Focused independent checks after review; modeled-native, no inference."""
import concurrent.futures,json,tempfile,threading
from pathlib import Path
from protocol import Lab,digest
ROOT=Path(__file__).resolve().parent
results=[]
def run(name, fn):
 with tempfile.TemporaryDirectory(prefix='aa-review-final-') as td:
  l=Lab(td);checks=[];error=None
  def c(actual,expected):
   checks.append({'actual':actual,'expected':expected,'pass':actual==expected})
   assert actual==expected,(actual,expected)
  try:fn(l,c)
  except Exception as e:error=repr(e)
  finally:l.close()
  results.append({'name':name,'checks':checks,'error':error})
def repeated(l,c):
 l.submit();l.receive('input-1');c(l.intent('input-1'),'dispatch-ready');c(l.native_call('input-1'),'accepted')
 c(l.send('input-1'),'inflight');c(l.native_call('input-1'),'no-dispatch-claim');c(len(l.native.read()['events']),1)
run('inflight retry and consumed native permit',repeated)
def concurrent_send(l,c):
 l.submit();barrier=threading.Barrier(2)
 def worker(_):
  p=Lab(l.path);original=p.intent
  def intent(key):
   r=original(key);barrier.wait(timeout=5);return r
  p.intent=intent
  try:return p.send('input-1')
  finally:p.close()
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:responses=list(ex.map(worker,range(2)))
 c(sorted(responses),['accepted','inflight']);c(len(l.native.read()['events']),1)
run('concurrent dispatch grants one native permit',concurrent_send)
def recover(l,c):
 l.submit();l.receive('input-1');l.intent('input-1');l.recover()
 c(l.native_call('input-1'),'no-dispatch-claim');c(l.send('input-1'),'unknown');c(len(l.native.read()['events']),0)
run('recovery consumes undispatched permit conservatively',recover)
def absent_interrupt(l,c):
 l.submit(key='stop',kind='interrupt');l.submit(key='later');l.receive('later');c(l.intent('later'),'interrupt-barrier');c(len(l.native.read()['events']),0)
run('missing daemon stop still closes continuation',absent_interrupt)
def after_interrupt(l,c):
 l.submit(key='stop',kind='interrupt');c(l.send('stop'),'accepted');l.submit(key='later')
 c(l.send('later'),'interrupt-barrier');c(l.service.read()['terminal'],False);c(l.service.read()['writerStopped'],False)
run('interrupt acceptance cannot reopen continuation',after_interrupt)
def capacity(l,c):
 for i in range(4):c(l.submit(key=str(i)),'queued')
 c(l.submit(key='stop',kind='interrupt'),'queued');c(l.submit(key='stop2',kind='interrupt'),'queue-full');c(l.send('stop'),'accepted')
run('reserved stop capacity at full instruction queue',capacity)
def output(l,c):
 for i in range(1,11):l.output(i,{'seq':i})
 events=l.replay('alice',7)['events'];c([x['payload']['seq'] for x in events],[8,9,10]);c([x['seq'] for x in events],[8,9,10]);c(len(l.service.read()['output']),3)
 c(l.output(1,{'seq':1}),'expired');c(l.replay('alice',0)['error'],'snapshot-required')
 c(l.submit(key='stop',kind='interrupt'),'queued');c(l.send('stop'),'accepted')
run('numeric replay bounded retention and stop after overflow',output)
def stale(l,c):
 l.submit();l.receive('input-1');l.intent('input-1');l.native_call('input-1')
 successor={**l.service.read()['scope'],'attempt':'B','generation':2};l.mutate(scope=successor)
 l.receipt('input-1');c(l.reconcile('input-1'),'accepted');c(l.service.read()['scope'],successor);c(l.service.read()['newAdmission'],False)
run('late receipt remains historical after successor',stale)
def stale_projection(l,c):
 l.submit();l.receive('input-1');l.intent('input-1');snapshot=l.daemon.read()
 l.native_call('input-1');l.receipt('input-1');l.reconcile('input-1')
 original=l.daemon.read;l.daemon.read=lambda:snapshot
 try:c(l.reconcile('input-1'),'stale-or-conflicting-receipt')
 finally:l.daemon.read=original
 c(l.service.read()['commands']['input-1']['status'],'accepted')
run('captured earlier receipt cannot regress terminal projection',stale_projection)
def revoke(l,c):
 l.submit();l.receive('input-1');l.intent('input-1');l.mutate(members={'alice':False});l.native_call('input-1');c(len(l.native.read()['events']),1)
run('explicit fixture authority cutoff is before native write',revoke)
report={'kind':'independent repaired-fixture checks; native effects modeled','sourceHash':digest({n:(ROOT/n).read_text() for n in ['protocol.py','independent_final_probe.py']}),'scenarios':len(results),'checks':sum(len(x['checks']) for x in results),'failed':sum(bool(x['error']) for x in results),'results':results}
(ROOT/'independent-final-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));raise SystemExit(bool(report['failed']))
