#!/usr/bin/env python3
"""Independent adversarial observations; intentionally records defects, not passing certification."""
import concurrent.futures,json,tempfile,threading
from pathlib import Path
from protocol import Lab
ROOT=Path(__file__).resolve().parent
results=[]
def run(name, fn):
 with tempfile.TemporaryDirectory(prefix='aa-review-') as td:
  l=Lab(td)
  try:results.append({'name':name,'observed':fn(l)})
  finally:l.close()
def repeated(l):
 l.submit();l.receive('input-1');l.intent('input-1');l.native_call('input-1')
 return {'retry':l.send('input-1'),'native_calls':len(l.native.read()['events'])}
run('retry while sending repeats possibly accepted input',repeated)
def concurrent_send(l):
 l.submit();barrier=threading.Barrier(2)
 def worker(_):
  p=Lab(l.path);original=p.intent
  def intent(key):
   r=original(key);barrier.wait(timeout=5);return r
  p.intent=intent
  try:return p.send('input-1')
  finally:p.close()
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:responses=list(ex.map(worker,range(2)))
 return {'responses':responses,'native_calls':len(l.native.read()['events'])}
run('concurrent dispatch duplicates side effect',concurrent_send)
def absent_interrupt(l):
 l.submit(key='stop',kind='interrupt');l.submit(key='later');l.receive('later')
 return {'later_intent':l.intent('later')}
run('missing preceding interrupt fails to block later steer',absent_interrupt)
def after_interrupt(l):
 l.submit(key='stop',kind='interrupt');l.send('stop');l.submit(key='later')
 return {'later_send':l.send('later'),'terminal':l.service.read()['terminal'],'writerStopped':l.service.read()['writerStopped']}
run('accepted interrupt does not close continuation gate',after_interrupt)
def capacity(l):
 for i in range(4):l.submit(key=str(i))
 return {'interrupt_submit':l.submit(key='stop',kind='interrupt')}
run('full queue blocks interruption',capacity)
def history(l):
 for i in range(1,11):l.output(i,{'seq':i})
 return {'cursor_7':l.replay('alice',7),'stored_count':len(l.service.read()['output'])}
run('output retention only signals and never prunes',history)
def stale(l):
 l.submit();l.receive('input-1');l.intent('input-1');l.native_call('input-1')
 l.mutate(scope={**l.service.read()['scope'],'attempt':'B','generation':2})
 l.receipt('input-1');l.reconcile('input-1')
 return {'scope':l.service.read()['scope'],'status':l.service.read()['commands']['input-1']['status'],'newAdmission':l.service.read()['newAdmission']}
run('late historical receipt scope isolation',stale)
def revoke(l):
 l.submit();l.receive('input-1');l.intent('input-1');l.mutate(members={'alice':False});l.native_call('input-1')
 return {'native_calls':len(l.native.read()['events'])}
run('authority revoke after modeled gate',revoke)
(ROOT/'independent-probe-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
