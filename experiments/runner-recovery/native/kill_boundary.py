#!/usr/bin/env python3
"""Observe a real native app-server crash; do not retry the accepted turn."""
import json, os, signal, subprocess, sys, tempfile, time
from pathlib import Path
from probe import Client, ROOT, clean_error, create_fixture, run


def processes():
    result = {}
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            content = path.read_text()
            rest = content[content.rfind(')')+2:].split()
            result[int(path.parent.name)] = {'ppid':int(rest[1]),'state':rest[0], 'start':rest[19]}
        except (FileNotFoundError,ProcessLookupError,PermissionError,ValueError):
            pass
    return result


def descendants(root):
    table = processes()
    owned = {root}
    changed = True
    while changed:
        more = {pid for pid, info in table.items() if info['ppid'] in owned}
        changed = bool(more-owned)
        owned |= more
    return {pid:table[pid]['start'] for pid in owned if pid in table}


def still_alive(owned):
    table = processes()
    return [pid for pid,start in owned.items() if pid in table and table[pid]['start']==start and table[pid]['state']!='Z']


def cleanup(owned):
    # Only act on exact observed descendants with the same Linux process start
    # time. Do not search another user's processes or assume process-group scope.
    for sig in [signal.SIGTERM,signal.SIGKILL]:
        for pid in still_alive(owned):
            try: os.kill(pid,sig)
            except ProcessLookupError: pass
        time.sleep(0.2)
    return still_alive(owned)


def main():
    output = ROOT/'kill-results'
    output.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='aa-native-kill-'))
    repo = create_fixture(work)
    (repo/'boundary_work.py').write_text('''import json, os, pathlib, time
pathlib.Path("boundary-started.json").write_text(json.dumps({"pid": os.getpid()}))
print("boundary-started", flush=True)
time.sleep(30)
pathlib.Path("boundary-finished.txt").write_text("finished\\n")
''')
    result = {'version':run(['codex','--version']).stdout.strip(),'workDirectory':str(work),
              'operation':'write local started marker, sleep 30 seconds, write local finished marker',
              'status':'started','noAutomaticTurnRetry':True,'nativeTurnStarts':0}
    client = None
    lookup = None
    owned = {}
    try:
        client = Client(output/'crash-events.jsonl',repo)
        result['account'] = client.account()
        assert result['account']['type']=='chatgpt'
        thread,result['settings'] = client.start(repo)
        response = client.response('turn/start', {'threadId':thread, 'input':[{'type':'text','text':
            'This authorized disposable local crash experiment needs one harmless tool invocation. '
            'Use only a local shell tool. Immediately run exactly python3 -B boundary_work.py in this workspace, then wait for it to finish. '
            'The script writes a local marker, sleeps for 30 seconds, and writes another local marker. '
            'Do not modify any file, inspect credentials/environment/other directories, call plugins or external services, use network/web, commit, push, or spawn agents. '
            'After it finishes answer with one sentence.'}]})
        result['nativeTurnStarts'] += 1
        result['turnStartAcknowledged'] = True
        result['acceptedTurnStatus'] = response['turn']['status']
        seen_command = False
        deadline = time.monotonic()+180
        while time.monotonic()<deadline:
            data = client.next(deadline)
            params = data.get('params',{})
            if data.get('method')=='item/started' and params.get('item',{}).get('type')=='commandExecution':
                seen_command=True
            if seen_command and (repo/'boundary-started.json').exists():
                break
            if data.get('method')=='turn/completed':
                raise RuntimeError('Native turn completed before requested active-command crash boundary')
        assert seen_command and (repo/'boundary-started.json').exists(), 'Active local marker boundary not observed'
        result['structuredCommandStartedObserved'] = True
        result['localOperationStartedMarkerObserved'] = True
        assert not (repo/'boundary-finished.txt').exists(), 'Operation finished before crash injection'
        result['operationUnfinishedAtCrashBoundary'] = True
        owned = descendants(client.proc.pid)
        namespace_pid = json.loads((repo/'boundary-started.json').read_text())['pid']
        candidates = []
        for pid in owned:
            try:
                status = Path(f'/proc/{pid}/status').read_text()
                namespace_ids = next(line for line in status.splitlines() if line.startswith('NSpid:')).split()[1:]
                command = Path(f'/proc/{pid}/comm').read_text().strip()
                if int(namespace_ids[-1]) == namespace_pid and command.startswith('python'):
                    candidates.append(pid)
            except (FileNotFoundError, ProcessLookupError, StopIteration):
                pass
        result['markerProcessInObservedDescendants'] = len(candidates)==1
        result['processCorrelation'] = 'unique observed Python descendant whose final NSpid matches marker namespace PID'
        assert len(candidates)==1, 'Marker process namespace identity is ambiguous'
        marker_pid = candidates[0]
        result['observedProcessCountBeforeKill'] = len(owned)
        os.kill(client.proc.pid,signal.SIGKILL)
        client.proc.wait(timeout=10)
        client.events.append({'event':'fault_injected','fault':'SIGKILL probe-owned app-server after turn/start ack and local operation marker','parentExitCode':client.proc.returncode})
        result['appServerExitCode'] = client.proc.returncode
        time.sleep(1)
        result['observedDescendantsAliveAfterParentKill'] = len(still_alive(owned))
        result['operationProcessAliveAfterParentKill'] = marker_pid in still_alive(owned)
        result['finishedMarkerAfterParentKill'] = (repo/'boundary-finished.txt').exists()
        result['turnCompletedReceivedBeforeCrash'] = any(e['event']=='turn/completed' for e in client.events)
        client.close(); client=None
        # A fresh local app-server knows no ephemeral thread from the dead process.
        # A negative read is not proof the prior operation never happened.
        lookup = Client(output/'lookup-events.jsonl',repo)
        for method,params in [('thread/read',{'threadId':thread,'includeTurns':False}),('thread/resume',{'threadId':thread})]:
            try:
                reply = lookup.response(method,params,timeout=30)
                result[method] = {'rpc':'returned','threadStatus':reply.get('thread',{}).get('status')}
            except RuntimeError as error:
                # Drop native UUIDs from the reviewable error.
                message=clean_error(str(error)).replace(thread,'<lost-ephemeral-thread>')
                result[method] = {'rpc':'error','message':message}
                for event in lookup.events:
                    if 'message' in event: event['message']=event['message'].replace(thread,'<lost-ephemeral-thread>')
        result['recoveryVerdict'] = 'pause-dispatch-unknown: accepted turn and started operation observed; no terminal result or resumable ephemeral session'
        result['status'] = 'observed_unknown_outcome'
    except Exception as error:
        result['status']='blocked'
        result['error']=type(error).__name__+': '+clean_error(str(error))
    finally:
        if client:
            if not owned: owned=descendants(client.proc.pid)
            client.close()
        if lookup: lookup.close()
        survivors=cleanup(owned) if owned else []
        result['identifiedDescendantsRemainingAfterCleanup']=len(survivors)
        result['cleanupScope']='only exact observed Linux descendants; no universal escaped-descendant/remote-effect guarantee'
        (output/'results.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({k:result[k] for k in ['status','nativeTurnStarts','noAutomaticTurnRetry','identifiedDescendantsRemainingAfterCleanup']}))
    if result['status']=='blocked' or result['identifiedDescendantsRemainingAfterCleanup']:
        sys.exit(1)

if __name__=='__main__': main()
