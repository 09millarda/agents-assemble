#!/usr/bin/env python3
"""Independent targeted protocol regressions. Never invokes native inference.

Uses only the fixture's public model operations and isolated SQLite files; does
not rerun its full suite or claim OS/process/authentication conformance.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import threading

ROOT = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output',default=str(ROOT/'review-admission-results.json'))
    args=parser.parse_args()
    source=ROOT/'probe.py'; source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    spec=importlib.util.spec_from_file_location('writer_stop_protocol_review_target',source)
    model=importlib.util.module_from_spec(spec); spec.loader.exec_module(model)
    checks=[]
    def check(condition,message):
        if not condition: raise AssertionError(message)
    with tempfile.TemporaryDirectory(prefix='aa-independent-admission-review-') as temporary:
        def case(name,run):
            f=model.Fixture(Path(temporary)/str(len(checks)))
            try:
                details=run(f) or {}
                checks.append({'name':name,'passed':True,'details':details})
            except Exception as error:
                checks.append({'name':name,'passed':False,'error':type(error).__name__+': '+str(error)})
            finally:
                f.close()
        def negative_admission(f,command):
            before=f.service.snapshot()
            verdict=f.service.admit(command)
            after=f.service.snapshot()
            check(verdict['accepted'] is False,'unqualified admission accepted')
            check(after['objects']==before['objects'],'rejected admission mutated authoritative objects')
            return {'verdict':verdict}
        def stale_predecessor(f):
            f.ready(); first=f.service.admit(f.recovery())
            check(first['accepted'],'setup admission rejected')
            command=f.recovery('recover-stale-predecessor-3'); command['target']=model.binding(3)
            result=negative_admission(f,command)
            check(f.service.get('writer','writer-2')['state']=='active','second writer was affected')
            return result
        case('active replacement cannot be skipped by reusing its stopped predecessor',stale_predecessor)
        def side_writer(f):
            f.ready(); side=model.binding(20)
            f.service.put('writer',side['writer_obligation'],{'binding':side,'issuer':model.RUNNER,'state':'active'})
            return negative_admission(f,f.recovery('recover-side-writer'))
        case('additional active writer in same occurrence prevents admission',side_writer)
        def side_effect(f):
            f.ready(); side=model.binding(20)
            f.service.put('writer',side['writer_obligation'],{'binding':side,'issuer':model.RUNNER,'state':'stopped'})
            f.service.put('effect','effect-side',{'writer':side['writer_obligation'],'state':'unknown'})
            return negative_admission(f,f.recovery('recover-side-effect'))
        case('unknown effect of another same-occurrence writer prevents admission',side_effect)
        def unrelated_occurrence(f):
            f.ready(); side=model.binding(20); side['occurrence']='occurrence-unrelated'
            f.service.put('writer',side['writer_obligation'],{'binding':side,'issuer':model.RUNNER,'state':'active'})
            f.service.put('effect','effect-unrelated',{'writer':side['writer_obligation'],'state':'unknown'})
            verdict=f.service.admit(f.recovery('recover-independent-occurrence'))
            check(verdict['accepted'],'unrelated occurrence incorrectly blocks recovery')
            check(f.service.get('writer',side['writer_obligation'])['state']=='active','unrelated writer mutated')
            check(f.service.get('effect','effect-unrelated')['state']=='unknown','unrelated effect mutated')
            return {'verdict':verdict}
        case('unrelated occurrence retains independent writers and effects',unrelated_occurrence)
        for key in ('profile','enrollment','runner','journal_incarnation'):
            def mismatch(f,key=key):
                f.ready(); command=f.recovery('recover-invalid-'+key); command['target'][key]='unapproved-'+key
                return negative_admission(f,command)
            case('replacement '+key+' must satisfy trusted registry',mismatch)
        def registry_revoked(f):
            f.ready(); registry=f.service.get('registry',model.RUNNER); registry['trusted']=False
            f.service.put('registry',model.RUNNER,registry)
            return negative_admission(f,f.recovery('recover-revoked-runner'))
        case('revoked replacement runner cannot receive fresh admission',registry_revoked)
        def immutable_replay(f):
            f.ready(); command=f.recovery(); first=f.service.admit(command)
            check(first['accepted'],'setup admission failed')
            before=f.service.snapshot(); replay=f.service.admit(copy.deepcopy(command),now=1000)
            check(replay==first,'exact accepted admission replay changed after expiry')
            check(f.service.snapshot()==before,'exact replay changed durable state')
            changed=copy.deepcopy(command); changed['target']['profile']='changed-profile'
            check(f.service.admit(changed)['accepted'] is False,'same admission ID accepted changed payload')
            check(f.service.snapshot()==before,'changed replay changed durable state')
        case('exact admission replay remains immutable after expiry and changed payload',immutable_replay)
        def historical_receipt(f):
            receipt=f.ready(); check(f.service.admit(f.recovery())['accepted'],'setup admission failed')
            check(f.service.receive(receipt)['accepted'],'historical exact receipt replay rejected')
            check(f.service.get('writer','writer-2')['state']=='active','historical receipt stopped new writer')
            changed=copy.deepcopy(receipt); changed['target']=model.binding(2); changed['target_digest']=model.digest(changed['target'])
            check(f.service.receive(changed)['accepted'] is False,'historical receipt ID rebound to new writer')
            check(f.service.get('writer','writer-2')['state']=='active','mismatched historical receipt mutated new writer')
        case('historical stop receipt cannot settle replacement identity',historical_receipt)
        def receipt_conflict(f):
            first=f.stop(); second_request=f.service.request_stop(f.target,'stop-second')
            check(f.daemon.request(second_request)['accepted'],'second stop request setup failed')
            try:
                returned=f.daemon.observe(second_request,f.supervisor,receipt_id=first['id'])
            except ValueError:
                pass
            else:
                check(isinstance(returned,dict) and returned.get('accepted') is False,'receipt ID silently reused for another request')
            check(f.daemon.get('receipt',first['id'])==first,'prior immutable local receipt overwritten')
        case('local receipt ID conflicts across different exact stop requests',receipt_conflict)
        def parallel_receipt(f):
            request_a=f.request; request_b=f.service.request_stop(f.target,'stop-parallel-other')
            check(f.daemon.request(request_a)['accepted'] and f.daemon.request(request_b)['accepted'],'parallel request setup failed')
            f.supervisor.stop(f.target)
            gate=threading.Barrier(2); outcomes=[]; lock=threading.Lock()
            def observe(request):
                daemon=model.Daemon(f.directory/'daemon.sqlite'); supervisor=model.Supervisor(f.directory/'supervisor.sqlite')
                try:
                    gate.wait(timeout=5)
                    result=daemon.observe(request,supervisor,receipt_id='parallel-shared-receipt')
                    item={'result':result}
                except ValueError as error:
                    item={'conflict':str(error)}
                except Exception as error:
                    item={'unexpected':type(error).__name__+': '+str(error)}
                finally:
                    daemon.db.close(); supervisor.db.close()
                with lock: outcomes.append(item)
            threads=[threading.Thread(target=observe,args=(request,),daemon=True) for request in (request_a,request_b)]
            for thread in threads: thread.start()
            for thread in threads: thread.join(timeout=10)
            check(not any(thread.is_alive() for thread in threads),'parallel observer did not finish')
            check(len(outcomes)==2 and not any('unexpected' in o for o in outcomes),'parallel observer failed unexpectedly: '+repr(outcomes))
            successes=[o['result'] for o in outcomes if 'result' in o and 'id' in o['result']]
            conflicts=[o for o in outcomes if 'conflict' in o or o.get('result',{}).get('accepted') is False]
            check(len(successes)==len(conflicts)==1,'receipt allocation did not produce one success and one identity conflict')
            check(f.daemon.get('receipt','parallel-shared-receipt')==successes[0],'persisted receipt differs from winner')
            return {'success_count':len(successes),'conflict_count':len(conflicts)}
        case('concurrent distinct requests cannot overwrite a shared receipt identity',parallel_receipt)
    evidence_file=ROOT/'evidence.json'
    evidence=json.loads(evidence_file.read_text()) if evidence_file.exists() else {}
    result={'reviewKind':'independent targeted admission/replay protocol regressions',
            'nativeRequests':0,'fullSuiteRerun':False,'sourceSha256':source_hash,
            'sourceMatchesCurrentFullSuiteEvidence':evidence.get('source_sha256')==source_hash,
            'passed':sum(c['passed'] for c in checks),'total':len(checks),'checks':checks,
            'limits':['Controlled SQLite protocol only; trusted identity/OS scope/checkpoint/effect fixtures remain assumptions.',
                      'Four native runs and native archive assertions are separate evidence and are not counted here.',
                      'The concurrent test is one synchronized two-observer run, not a general concurrency proof.']}
    out=Path(args.output); out.write_text(json.dumps(result,indent=2)+'\n')
    failed=[c['name'] for c in checks if not c['passed']]
    markdown='# Independent targeted protocol review\n\n'
    markdown+=f"**{result['passed']}/{result['total']} targeted checks pass** against source `{source_hash}`. No native requests; no full-suite rerun. Full-suite source hash matches: `{result['sourceMatchesCurrentFullSuiteEvidence']}`.\n\n"
    markdown+='The review originally found reachable admission through a stale predecessor, missing replacement registry eligibility, and non-serialized local receipt allocation. The executable regressions independently check those boundaries, relevant side-writer/effect obligations, unrelated-occurrence isolation, accepted replay immutability, and historical receipt scoping.\n\n'
    if failed: markdown+='Remaining failures: '+', '.join(failed)+'.\n\n'
    markdown+='Limits: '+ ' '.join(result['limits'])+'\n'
    out.with_suffix('.md').write_text(markdown)
    print(json.dumps({'passed':result['passed'],'total':result['total'],'sourceMatchesCurrentFullSuiteEvidence':result['sourceMatchesCurrentFullSuiteEvidence'],'output':str(out)}))
    return 0 if not failed else 1

if __name__=='__main__': raise SystemExit(main())
