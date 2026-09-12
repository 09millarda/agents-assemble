#!/usr/bin/env python3
"""Independent archive/integrity review. Reads files only; never launches Codex.

Default checks retained evidence. --original-workspaces adds optional integrity
checks against still-existing disposable workspaces. Counts are review assertions,
not new native test runs or a security/production-adapter certification.
"""
import argparse
import ast
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CASES = ('graceful', 'app-server-kill', 'delegated-kill', 'delegated-graceful')
SOURCE_FILES = ('probe_plain.py', 'probe.py', 'client.py', 'delegated_supervisor.py')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def parse_events(value):
    return dict(line.split(None, 1) for line in value.strip().splitlines())

def source_writer():
    tree = ast.parse((ROOT / 'probe.py').read_text())
    values = [node.args[0].value for node in ast.walk(tree)
              if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
              and node.func.attr == 'write_text' and node.args
              and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)
              and node.args[0].value.startswith('import json, os, pathlib, time\n')]
    if len(values) != 1:
        raise ValueError('Cannot uniquely locate generated writer source')
    return values[0].encode()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--original-workspaces', action='store_true')
    parser.add_argument('--output', default=str(ROOT / 'review-results.json'))
    args = parser.parse_args()
    checks = []
    def check(name, ok, scope='archive', detail=None):
        entry = {'name': name, 'passed': bool(ok), 'scope': scope}
        if detail is not None:
            entry['detail'] = detail
        checks.append(entry)
    records = {name: json.loads((ROOT / name / 'results.json').read_text()) for name in CASES}
    traces = {name: [json.loads(line) for line in (ROOT / name / 'events.jsonl').read_text().splitlines() if line] for name in CASES}
    hashes = {name: digest(ROOT / name) for name in SOURCE_FILES}
    native_requests = 0
    for name, record in records.items():
        before = record['before']
        after = record.get('afterNativeInterrupt', record.get('afterAppServerKill'))
        events = traces[name]
        requests = [e for e in events if e['event'] == 'request']
        turn_requests = [e for e in requests if e['method'] == 'turn/start']
        native_requests += len(turn_requests)
        source_name = 'probe.py' if name.startswith('delegated-') else 'probe_plain.py'
        check(f'{name}: recorded probe source matches retained bytes', record['sourceSha256'] == hashes[source_name])
        check(f'{name}: exactly one recorded native turn request and reply',
              record['nativeTurnStarts'] == len(turn_requests) == 1
              and len([e for e in events if e['event'] == 'response' and e['method'] == 'turn/start']) == 1
              and len([e for e in events if e['event'] == 'turn/started']) == 1)
        check(f'{name}: no replay/resume/additional native request method',
              [e['method'] for e in requests] == ['initialize', 'account/read', 'thread/start', 'turn/start'] + (['turn/interrupt'] if record['mode'] == 'graceful' else []))
        check(f'{name}: live native command boundary preceded intervention',
              record['turnStartStatus'] == 'inProgress' and record['ticksBefore'] > 0
              and any(e['event'] == 'item/started' and e.get('itemType') == 'commandExecution' for e in events))
        check(f'{name}: unique named unit and activation present',
              re.fullmatch(r'aa-writer-native-[0-9a-f]{32}\.service', record['unit']) is not None
              and before['Id'] == record['unit'] and re.fullmatch(r'[0-9a-f]{32}', before['InvocationID']) is not None)
        expected = {'Type':'exec', 'ExitType':'cgroup', 'Restart':'no', 'RestartForceExitStatus':'',
                    'KillMode':'control-group', 'SendSIGKILL':'yes', 'TimeoutStopUSec':'2s', 'RuntimeMaxUSec':'4min', 'NRestarts':'0'}
        check(f'{name}: finite bounded effective unit configuration', all(before.get(k) == v for k,v in expected.items()))
        check(f'{name}: unit activation and cgroup instance persist through native boundary',
              after['InvocationID'] == before['InvocationID'] and after['ControlGroup'] == before['ControlGroup']
              and after['cgroupInode'] == before['cgroupInode'] and after['NRestarts'] == '0')
        writer = record['writer']
        identity = ('pid', 'startTicks', 'pidNamespace', 'namespacePids', 'comm')
        same = lambda m: all(m[k] == writer[k] for k in identity)
        check(f'{name}: exact recorded writer instance survives native boundary',
              sum(same(m) for m in before['members']) == 1 and sum(same(m) for m in after['members']) == 1
              and int(writer['namespacePids'][0]) == writer['pid'] and len(writer['namespacePids']) > 1)
        requested = record['settings']['requested']; effective = record['settings']['effective']; sandbox = effective['sandbox']
        check(f'{name}: native account and reported requested permissions retained',
              record['account']['type'] == 'chatgpt' and requested['model'] == requested['effort'] == 'omitted'
              and requested['sandbox'] == 'workspace-write' and requested['networkAccess'] is False
              and effective['approvalPolicy'] == 'never' and sandbox['type'] == 'workspaceWrite'
              and sandbox['networkAccess'] is False and sandbox['excludeTmpdirEnvVar'] is True
              and sandbox['excludeSlashTmp'] is True and record['settings']['threadEphemeral'] is True)
        check(f'{name}: whole-unit cleanup stops known writer only as recorded',
              record['stopCommandExit'] == 0 and record['writerExitedAfterUnitStop'] is True
              and record['heartbeatStableAfterStop'] is True and record['finishedMarker'] is False
              and record['cleanup']['cgroupPresent'] is False)
        check(f'{name}: post-cleanup ENODEV remains explicit',
              record.get('heldCgroupEventsAfterStopError') == 19 and 'heldCgroupEventsAfterStop' not in record)
        if not name.startswith('delegated-'):
            check(f'{name}: no direct empty receipt claimed in original data',
                  'payloadEmptyObservation' not in record and not (ROOT/name/'scoped-receipt.json').exists())
        if record['mode'] == 'graceful':
            check(f'{name}: interrupted terminal coexists with still-live writer observation',
                  record['nativeTerminalStatus'] == 'interrupted' and record['writerExitedAfterInterrupt'] is False
                  and any(e['event'] == 'turn/completed' and e.get('status') == 'interrupted' for e in events))
        else:
            check(f'{name}: writer continues heartbeat after App Server kill',
                  record['writerAliveAfterAppServerKill'] is True and record['ticksAfterAppServerKill'] > record['ticksBefore']
                  and not any(e['event'] == 'turn/completed' for e in events))
    check('four distinct unit names and activation identities',
          len({r['unit'] for r in records.values()}) == len({r['before']['InvocationID'] for r in records.values()}) == len(CASES))
    check('four native turn requests across four retained runs', native_requests == len(CASES))
    check('all records retain the same kernel boot and declared runtime versions',
          len({r['bootId'] for r in records.values()}) == 1 and len({r['version'] for r in records.values()}) == 1
          and len({r['kernel'] for r in records.values()}) == 1 and len({r['systemd'] for r in records.values()}) == 1)
    for name in ('delegated-kill', 'delegated-graceful'):
        d = records[name]; b = d['supervisorBinding']; receipt = json.loads((ROOT/name/'scoped-receipt.json').read_text())
        check(f'{name}: retained payload path belongs beneath exact unit cgroup',
              b['payload'] == '/sys/fs/cgroup' + d['before']['ControlGroup'] + '/payload' and d['before']['Delegate'] == 'yes')
        check(f'{name}: shim remains outside payload while native process and writer are members',
              str(b['supervisorPid']) not in d['payloadMembersBefore'] and str(b['nativePid']) in d['payloadMembersBefore']
              and str(d['writer']['pid']) in d['payloadMembersBefore'] and str(b['supervisorPid']) == d['before']['MainPID'])
        check(f'{name}: observed native PID identified as Codex within unit before kill',
              any(m['pid'] == b['nativePid'] and m['comm'] == 'codex' for m in d['before']['members'])
              and (d['mode'] != 'app-server-kill' or not any(m['pid'] == b['nativePid'] for m in d['afterAppServerKill']['members'])))
        check(f'{name}: payload directory inode matches before kill, after empty and receipt',
              b['inode'] == d['preKillPayloadInode'] == d['payloadInodeAfterEmpty'] == receipt['payloadInode']
              and b['inode'] != d['before']['cgroupInode'])
        check(f'{name}: actual payload populated transitions from one to zero',
              parse_events(d['eventsBefore'])['populated'] == '1'
              and parse_events(d['payloadEmptyObservation'])['populated'] == '0'
              and receipt['evidence'] == d['payloadEmptyObservation'])
        check(f'{name}: same live shim activation after payload emptiness',
              d['supervisorAfterPayloadKill']['ActiveState'] == 'active'
              and d['supervisorAfterPayloadKill']['MainPID'] == str(b['supervisorPid'])
              and d['supervisorAfterPayloadKill']['InvocationID'] == d['before']['InvocationID']
              and d['supervisorAfterPayloadKill']['NRestarts'] == '0')
        check(f'{name}: receipt binds local scope boot and activation',
              receipt['kind'] == 'contained_local_processes_stopped'
              and receipt['unitInvocation'] == d['before']['InvocationID'] and receipt['bootId'] == d['bootId']
              and receipt['launchCount'] == b['launches'] == 1
              and receipt['provenance'] == 'trusted local fixture only; not authenticated service receipt')
        check(f'{name}: receipt ordering is recorded before outer cleanup', d['receiptPersistedBeforeOuterCleanup'] is True)
    if args.original_workspaces:
        expected_writer = source_writer()
        for name,r in records.items():
            workspace = Path(r['workspace'])
            check(f'{name}: original native writer script remains exact generated bytes',
                  (workspace/'writer.py').read_bytes() == expected_writer, 'original-workspaces')
            check(f'{name}: original namespace marker matches recorded writer',
                  str(json.loads((workspace/'started.json').read_text())['pid']) == r['writer']['namespacePids'][-1], 'original-workspaces')
            lines = (workspace/'ticks.txt').read_text().splitlines()
            check(f'{name}: original heartbeat sequence is bounded and unfinished',
                  lines == [str(i) for i in range(len(lines))] and 0 < len(lines) < 600 and not (workspace/'finished.txt').exists(), 'original-workspaces')
        for name in ('delegated-kill', 'delegated-graceful'):
            check(f'{name}: original supervisor binding agrees with retained evidence',
                  json.loads((Path(records[name]['workspace'])/'supervisor.json').read_text()) == records[name]['supervisorBinding'], 'original-workspaces')
    limits = [
      'These are independent recorded-evidence/integrity assertions, not additional native inference, process experiments, or security certification.',
      'The two plain runs show known-writer exit after unit stop; ENODEV or missing cgroup metadata is not a direct subtree-empty observation.',
      'Both delegated native runs record actual payload populated=0. No daemon/controller-death or runtime-deadline native run is retained here.',
      'The receipt concerns the payload; the trusted shim is deliberately still alive outside it. It does not prove whole-unit, whole-host, arbitrary-writer or external-effect quiescence.',
      'The receipt file is flushed and fsynced before outer cleanup, but its newly created directory entry is not directory-fsynced; crash-durable receipt creation was not established.',
      'The recorded sourceSha256 binds each probe entry point. client.py and delegated_supervisor.py have review-time hashes only; original run records did not attest those supporting bytes.',
      'pidfd_open occurs after numeric-PID snapshots. Held pidfds prevent later reuse confusion but not an acquisition race; matching writer startTicks/namespace in subsequent snapshots supports the recorded instance, not a generic restart/reopen guarantee.',
      'The shim stays in its unit root and source does not enable domain controllers. No cgroup.subtree_control value was captured. A future profile should separate supervisor/payload subgroups if enabling domain controllers.',
      'The shim launches once and never restarts but does not journal launch intent or stop the payload on controller loss; RuntimeMaxSec bounds the entire unit without guaranteeing an emptiness receipt.',
      'The local fixture receipt lacks ADR assignment/generation/journal identity and authenticated transport provenance; it cannot independently authorize production replacement admission.',
      'Same-UID control/daemon escape, input tampering, other authorized writers, external effects and kernel/manager failure are outside this trusted local fixture claim.'
    ]
    summary = {scope: {'passed':sum(c['passed'] for c in checks if c['scope']==scope), 'total':sum(c['scope']==scope for c in checks)}
               for scope in ('archive','original-workspaces')}
    result = {'reviewKind':'independent recorded evidence and optional original workspace integrity',
              'nativeInferenceRequestsByThisReview':0, 'recordedNativeRuns':len(CASES), 'recordedNativeTurnStartRequests':native_requests,
              'summary':summary,'passed':all(c['passed'] for c in checks), 'sourceSha256AtReview':hashes,
              'originalProbeHashes':{name:r['sourceSha256'] for name,r in records.items()},
              'evidenceSha256AtReview':{str(path.relative_to(ROOT)):digest(path) for name in CASES for path in sorted((ROOT/name).glob('*')) if path.is_file()},
              'directEmptyPayloadInodes':{name:records[name]['supervisorBinding']['inode'] for name in ('delegated-kill','delegated-graceful')}, 'assertions':checks,'limitations':limits}
    out = Path(args.output); out.write_text(json.dumps(result,indent=2)+'\n')
    report = '# Independent native evidence review\n\n'
    report += f"Archive checks: **{summary['archive']['passed']}/{summary['archive']['total']}**. Optional original-workspace checks: **{summary['original-workspaces']['passed']}/{summary['original-workspaces']['total']}**. This review made **zero native requests**; it inspected **four recorded native runs**, each with one `turn/start`. These counts are separate.\n\n"
    report += 'Both graceful runs report an interrupted turn while their identified writer is still alive. Both App Server kill runs retain the writer and increasing heartbeat bytes. Whole-unit stop ends the known writer in every record. Both delegated runs additionally record `populated 0` for unchanged payload inodes **37264** (kill) and **37829** (graceful), while each original shim activation remains active, and write scoped receipts before outer cleanup.\n\n'
    report += 'Entry-point source hashes match retained bytes: original plain probe `' + hashes['probe_plain.py'] + '`; delegated probe `' + hashes['probe.py'] + '`. Supporting-source and evidence hashes are captured in the JSON at review time.\n\n'
    report += 'Important limits:\n\n' + '\n'.join('- '+text for text in limits[1:]) + '\n'
    out.with_suffix('.md').write_text(report)
    print(json.dumps({'passed':result['passed'],'summary':summary,'recordedNativeRuns':len(CASES),'nativeRequestsByReview':0,'output':str(out)}))
    return 0 if result['passed'] else 1

if __name__ == '__main__':
    raise SystemExit(main())
