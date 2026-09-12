#!/usr/bin/env python3
"""THROWAWAY Linux supervision experiment; never a production supervisor.

Run: python3 experiments/writer-supervision/fixtures/throwaway_fixture.py
Every writer has a 20-second self-expiry; service units also have RuntimeMaxSec.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
SELF = Path(__file__).resolve()
BOOT = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
PROPERTIES = [
    'Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID',
    'ControlGroup', 'ExitType', 'Restart', 'KillMode', 'TimeoutStopUSec',
    'SendSIGKILL', 'RuntimeMaxUSec', 'Delegate', 'Result', 'ExecMainCode',
    'ExecMainStatus', 'NRestarts', 'RestartForceExitStatus',
]
EVENTS = []
UNITS = []
OWNED_PIDS = []


def identity(pid):
    try:
        raw = Path(f'/proc/{pid}/stat').read_text()
        fields = raw[raw.rfind(')') + 2:].split()
        return {'pid': pid, 'state': fields[0], 'ppid': int(fields[1]),
                'process_group': int(fields[2]), 'session': int(fields[3]),
                'start_ticks': int(fields[19]), 'boot_id': BOOT,
                'cgroup': Path(f'/proc/{pid}/cgroup').read_text().strip()}
    except (FileNotFoundError, ProcessLookupError):
        return None


def exact_signal(item, sig):
    actual = identity(item['pid'])
    if actual and actual['start_ticks'] == item['start_ticks'] and actual['boot_id'] == item['boot_id']:
        os.kill(item['pid'], sig)
        return True
    return False


def write_json(path, payload):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, indent=2) + '\n')
    temporary.replace(path)


def raw(command, timeout=8):
    start = time.monotonic()
    result = subprocess.run(command, text=True, capture_output=True, timeout=timeout)
    event = {'command': command, 'returncode': result.returncode,
             'stdout': result.stdout, 'stderr': result.stderr,
             'elapsed_seconds': round(time.monotonic() - start, 4)}
    EVENTS.append(event)
    return event


def require_command(command):
    event = raw(command)
    if event['returncode']:
        raise RuntimeError(json.dumps(event))
    return event


def wait_for(test, label, timeout=5):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = test()
        if value:
            return value
        time.sleep(.04)
    raise RuntimeError(f'timed out waiting for {label}')


def ready(directory, name='writer.json'):
    path = Path(directory) / name
    return wait_for(lambda: json.loads(path.read_text()) if path.exists() else None, str(path))


def growth(path, delay=.22):
    path = Path(path)
    before = path.stat().st_size if path.exists() else 0
    time.sleep(delay)
    after = path.stat().st_size if path.exists() else 0
    return {'before_bytes': before, 'after_bytes': after, 'grew': after > before,
            'observation_seconds': delay}


def cg_state(control_group):
    if not control_group:
        return {'exists': False, 'path': None}
    path = Path('/sys/fs/cgroup') / control_group.lstrip('/')
    try:
        inode = path.stat().st_ino
        events = dict(line.split() for line in (path / 'cgroup.events').read_text().splitlines())
        pids = [int(p) for p in (path / 'cgroup.procs').read_text().split()]
        return {'path': str(path), 'exists': True, 'inode': inode, 'events': events,
                'direct_pids': pids, 'processes': [identity(p) for p in pids]}
    except FileNotFoundError:
        return {'path': str(path), 'exists': False}


def snapshot(unit):
    event = raw(['systemctl', '--user', 'show', unit,
                 '--property=' + ','.join(PROPERTIES)])
    props = dict(line.split('=', 1) for line in event['stdout'].splitlines() if '=' in line)
    return {'boot_id': BOOT, 'properties': props, 'cgroup': cg_state(props.get('ControlGroup')),
            'query_returncode': event['returncode']}


def launch_args(unit, directory, mode='escaped', sibling=None):
    command = ['systemd-run', '--user', '--quiet', '--unit=' + unit,
               '--property=Type=exec', '--property=ExitType=cgroup',
               '--property=Restart=no', '--property=RestartForceExitStatus=', '--property=KillMode=control-group',
               '--property=SendSIGKILL=yes', '--property=TimeoutStopSec=750ms',
               '--property=RuntimeMaxSec=20s', '--property=Delegate=no',
               sys.executable, str(SELF), '--worker', mode, '--directory', str(directory)]
    if sibling:
        command += ['--unit', sibling]
    return command


def new_unit(tag):
    unit = f'aa-writer-fixture-{uuid.uuid4().hex}-{tag}.service'
    UNITS.append(unit)
    return unit


def stop(unit):
    before = snapshot(unit)
    event_path = Path(before['cgroup']['path']) / 'cgroup.events' if before['cgroup']['path'] else None
    event_fd = os.open(event_path, os.O_RDONLY) if event_path and event_path.exists() else None
    samples = []
    command = ['systemctl', '--user', 'stop', unit]
    start = time.monotonic()
    process = subprocess.Popen(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def sample():
        if event_fd is None:
            return
        try:
            value = {'raw': os.pread(event_fd, 1024, 0).decode()}
        except OSError as exc:
            value = {'errno': exc.errno, 'error': str(exc)}
        if not samples or any(samples[-1].get(key) != item for key, item in value.items()):
            samples.append({'elapsed_seconds': round(time.monotonic() - start, 4), **value})
    while process.poll() is None:
        sample()
        if time.monotonic() - start > 8:
            process.kill()
            raise RuntimeError(f'stop exceeded fixture bound for {unit}')
        time.sleep(.002)
    sample()
    if event_fd is not None:
        os.close(event_fd)
    stdout, stderr = process.communicate()
    event = {'command': command, 'returncode': process.returncode, 'stdout': stdout, 'stderr': stderr,
             'elapsed_seconds': round(time.monotonic() - start, 4)}
    EVENTS.append(event)
    if process.returncode:
        raise RuntimeError(json.dumps(event))
    after = snapshot(unit)
    old_cgroup_after = cg_state(before['properties'].get('ControlGroup'))
    observed_zero = any('populated 0\n' in item.get('raw', '') for item in samples)
    return {'before': before, 'stop_command': event, 'after': after,
            'old_cgroup_after': old_cgroup_after, 'retained_cgroup_events_fd_samples': samples,
            'observed_populated_zero': observed_zero,
            'cleanup_receipt_certified': False,
            'proof_limit': 'Manager stop plus known writer observation only; removal/ENODEV is not a populated=0 receipt.'}


def writer(directory):
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    write_json(Path(directory) / 'writer.json', identity(os.getpid()))
    end = time.monotonic() + 20
    with (Path(directory) / 'heartbeat.log').open('a', buffering=1) as stream:
        while time.monotonic() < end:
            stream.write(f'{time.monotonic_ns()} {os.getpid()}\n')
            time.sleep(.04)


def worker(mode, directory, unit):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if mode == 'writer':
        writer(directory)
        return
    if mode == 'controller':
        event = raw(launch_args(unit, directory / 'service'))
        write_json(directory / 'controller.json', {'identity': identity(os.getpid()), 'launch': event})
        time.sleep(20)
        return
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    if mode == 'escaped':
        child = os.fork()
        if child == 0:
            os.setsid()
            grandchild = os.fork()
            if grandchild:
                os._exit(0)
            writer(directory)
            os._exit(0)
        os.waitpid(child, 0)
    elif mode == 'external':
        # The caller supplies an explicitly owned sibling unit. This does not
        # discover, signal, or write to any pre-existing unit.
        event = raw(launch_args(unit, directory / 'external', mode='writer'))
        write_json(directory / 'external-launch.json', event)
    write_json(directory / 'main.json', identity(os.getpid()))
    time.sleep(20)


def settled(receipt):
    after = receipt['after']['properties']
    old = receipt['old_cgroup_after']
    return (after.get('ActiveState') in ('inactive', 'failed') and
            (not old['exists'] or old.get('events', {}).get('populated') == '0'))


def run_experiment(output):
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    results = {'throwaway': True, 'started_unix': time.time(), 'boot_id': BOOT,
               'platform': os.uname()._asdict() if hasattr(os.uname(), '_asdict') else list(os.uname()),
               'fixture_directory': str(output), 'empirical_cases': [], 'modeled_guards': [],
               'owned_units': UNITS, 'events': EVENTS}
    failures = []

    def case(name, payload, passed):
        results['empirical_cases'].append({'name': name, 'passed': bool(passed), **payload})
        print(f'{name}: {"PASS" if passed else "FAIL"}', flush=True)
        if not passed:
            failures.append(name)
        write_json(output / 'evidence.json', results)

    try:
        results['environment'] = {
            'python': sys.version,
            'systemd': require_command(['systemctl', '--user', '--version']),
            'manager': require_command(['systemctl', '--user', 'show', '--property=Version,ControlGroup']),
            'cgroup_v2': Path('/sys/fs/cgroup/cgroup.controllers').exists(),
        }
        # 1: a process group is not descendant containment.
        directory = output / 'process-group'
        proc = subprocess.Popen([sys.executable, str(SELF), '--worker', 'escaped', '--directory', str(directory)],
                                start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        main = ready(directory, 'main.json')
        escaped = ready(directory)
        OWNED_PIDS.extend([main, escaped])
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=3)
        after = identity(escaped['pid'])
        writes = growth(directory / 'heartbeat.log')
        exact_signal(escaped, signal.SIGKILL)
        case('process_group_double_fork_escape', {'main_before': main, 'writer_before': escaped,
             'main_exitcode': proc.returncode, 'writer_after_group_kill': after, 'post_kill_writes': writes},
             proc.returncode == -signal.SIGKILL and after and writes['grew'] and
             escaped['process_group'] != main['process_group'])

        # 2: ExitType=cgroup preserves the populated invocation after main dies.
        directory = output / 'main-death'
        unit = new_unit('main-death')
        require_command(launch_args(unit, directory))
        main = ready(directory, 'main.json')
        escaped = ready(directory)
        before = snapshot(unit)
        require_command(['systemctl', '--user', 'kill', '--kill-whom=main', '--signal=KILL', unit])
        wait_for(lambda: (identity(main['pid']) or {}).get('state') in (None, 'Z'), 'main exit')
        after = snapshot(unit)
        writes = growth(directory / 'heartbeat.log')
        case('cgroup_survives_main_death', {'unit': unit, 'main': main, 'writer': escaped,
             'before': before, 'after_main_death': after, 'post_main_death_writes': writes},
             before['properties']['InvocationID'] == after['properties']['InvocationID'] and
             after['properties']['ActiveState'] == 'active' and after['cgroup']['events']['populated'] == '1'
             and writes['grew'])
        termination = stop(unit)
        stopped_growth = growth(directory / 'heartbeat.log')
        child_after = identity(escaped['pid'])
        case('bounded_term_then_kill_entire_cgroup', {'unit': unit, 'termination': termination,
             'writer_after_stop': child_after, 'post_stop_writes': stopped_growth},
             settled(termination) and termination['stop_command']['elapsed_seconds'] < 4 and
             not stopped_growth['grew'] and (not child_after or child_after['state'] == 'Z'))

        # 3: death of the disposable submitting daemon does not erase ownership.
        directory = output / 'controller-death'
        unit = new_unit('controller-death')
        controller = subprocess.Popen([sys.executable, str(SELF), '--worker', 'controller',
                                       '--directory', str(directory), '--unit', unit],
                                      start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        control = ready(directory, 'controller.json')
        OWNED_PIDS.append(control['identity'])
        escaped = ready(directory / 'service')
        before = snapshot(unit)
        exact_signal(control['identity'], signal.SIGKILL)
        controller.wait(timeout=3)
        after = snapshot(unit)
        writes = growth(directory / 'service' / 'heartbeat.log')
        termination = stop(unit)
        case('controller_death_and_rediscovery', {'unit': unit, 'controller': control,
             'controller_exitcode': controller.returncode, 'before': before,
             'rediscovered': after, 'writes_after_controller_death': writes, 'termination': termination},
             controller.returncode == -signal.SIGKILL and writes['grew'] and
             before['properties']['InvocationID'] == after['properties']['InvocationID'] and
             before['cgroup']['inode'] == after['cgroup']['inode'] and settled(termination))

        # 4: unit names survive explicit restart; invocation identities do not.
        directory = output / 'restart'
        unit = new_unit('restart')
        require_command(launch_args(unit, directory))
        first_writer = ready(directory)
        before = snapshot(unit)
        require_command(['systemctl', '--user', 'restart', unit])
        wait_for(lambda: json.loads((directory / 'writer.json').read_text())['pid'] != first_writer['pid'],
                 'new writer after restart')
        after = snapshot(unit)
        termination = stop(unit)
        changed = before['properties']['InvocationID'] != after['properties']['InvocationID']
        case('explicit_restart_changes_invocation_identity', {'unit': unit, 'before': before,
             'after_restart': after, 'termination': termination},
             changed and before['properties']['Restart'] == 'no' and after['properties']['Restart'] == 'no'
             and settled(termination))
        results['modeled_guards'].append({
            'name': 'stale_receipt_identity_mismatch', 'kind': 'pure protocol assertion over observed restart',
            'outcome': 'BLOCKED_UNCERTAIN_CLEANUP' if changed else 'UNEXPECTED_SAME_IDENTITY',
            'reason': 'A new InvocationID cannot satisfy an old invocation cleanup receipt; no cleanup certification.',
            'performed_destructive_action_from_stale_receipt': False,
        })

        # 5: unrestricted same-UID tools can ask the user manager for another unit.
        directory = output / 'external-unit'
        outer = new_unit('outer')
        sibling = new_unit('owned-sibling')
        require_command(launch_args(outer, directory, mode='external', sibling=sibling))
        ready(directory, 'main.json')
        external = ready(directory / 'external')
        outer_before = snapshot(outer)
        sibling_before = snapshot(sibling)
        termination = stop(outer)
        writes = growth(directory / 'external' / 'heartbeat.log')
        sibling_after = snapshot(sibling)
        cleanup_sibling = stop(sibling)
        escaped = outer_before['properties']['ControlGroup'] != sibling_before['properties']['ControlGroup']
        case('same_uid_external_unit_outlives_empty_outer_unit', {
            'outer_unit': outer, 'sibling_unit': sibling, 'sibling_writer': external,
            'outer_before': outer_before, 'sibling_before': sibling_before,
            'outer_termination': termination, 'sibling_after_outer_stop': sibling_after,
            'sibling_writes_after_outer_stop': writes, 'sibling_cleanup': cleanup_sibling},
            escaped and settled(termination) and writes['grew'] and
            sibling_after['properties']['ActiveState'] == 'active' and settled(cleanup_sibling))
        results['modeled_guards'].append({
            'name': 'observed_writer_outside_owned_scope', 'kind': 'pure protocol assertion over observed escape',
            'outcome': 'BLOCKED_UNCERTAIN_CLEANUP',
            'reason': 'Outer unit emptiness does not certify unrestricted same-UID writers; sibling required separate owned cleanup.',
        })
        results['modeled_guards'].append({
            'name': 'capability_gate_missing', 'kind': 'synthetic input to protocol predicate; not a host failure experiment',
            'input': {'user_manager_available': False, 'cgroup_v2': True},
            'outcome': 'BLOCKED_CAPABILITY_UNAVAILABLE',
            'reason': 'No invocation would be launched; no downgrade to PID/process-group certification.',
        })
    except BaseException as exc:
        results['harness_error'] = repr(exc)
        raise
    finally:
        # Exact UUID unit names, and PID + birth identities, are the only cleanup targets.
        cleanup = []
        for unit in UNITS:
            cleanup.append(raw(['systemctl', '--user', 'stop', unit]))
            cleanup.append(raw(['systemctl', '--user', 'reset-failed', unit]))
        for pid in OWNED_PIDS:
            try:
                exact_signal(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        results['final_cleanup'] = cleanup
        results['final_owned_unit_snapshots'] = {unit: snapshot(unit) for unit in UNITS}
        results['finished_unix'] = time.time()
        results['empirical_pass_count'] = sum(c['passed'] for c in results['empirical_cases'])
        results['empirical_case_count'] = len(results['empirical_cases'])
        results['modeled_guard_count'] = len(results['modeled_guards'])
        write_json(output / 'evidence.json', results)
        print(f'Evidence: {output / "evidence.json"}', flush=True)
    if failures:
        raise SystemExit(f'Failed empirical cases: {failures}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--worker', choices=['escaped', 'writer', 'controller', 'external'])
    parser.add_argument('--directory')
    parser.add_argument('--unit')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.worker:
        worker(args.worker, args.directory, args.unit)
    else:
        run_experiment(args.output or HERE / ('run-' + uuid.uuid4().hex))
