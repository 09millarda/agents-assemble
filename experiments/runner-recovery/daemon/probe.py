#!/usr/bin/env python3
"""Disposable runner protocol experiment. Standard library + Git, Linux only.

SQLite is a service fixture, not the selected production substrate. HTTP is real
loopback without TLS/auth; the subprocess is a safe counter/Git fixture, not Codex.
"""
import argparse
import contextlib
import fcntl
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import select
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid


HERE = Path(__file__).resolve().parent
SCOPE = ('tenant', 'runner', 'run', 'occurrence', 'attempt', 'generation', 'command')
INVOCATION_SCOPE = ('tenant', 'runner', 'run', 'occurrence', 'attempt')


def canonical(value):
    # Exact toy schema uses strings/integers only except local expiry timestamps.
    # This is NOT a production cross-language canonical serializer/signature.
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def command_key(command):
    return canonical([command[k] for k in SCOPE])


def invocation_key(command):
    return canonical([command[k] for k in INVOCATION_SCOPE])


def command_digest(command):
    return digest({k: v for k, v in command.items() if k != 'payload_digest'})


def event(stage, **values):
    print(canonical(dict(stage=stage, at=time.time(), **values)), flush=True)


def connect(path):
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA foreign_keys=ON')
    return db


@contextlib.contextmanager
def transaction(db):
    db.execute('BEGIN IMMEDIATE')
    try:
        yield
    except BaseException:
        db.execute('ROLLBACK')
        raise
    else:
        db.execute('COMMIT')


def init_journal(path, incarnation=None):
    db = connect(path)
    db.executescript('''
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY, invocation TEXT UNIQUE NOT NULL, digest TEXT NOT NULL,
        body TEXT NOT NULL, state TEXT NOT NULL, checkpoint TEXT, result TEXT,
        process_id INTEGER, process_instance TEXT, pause TEXT);
      CREATE TABLE IF NOT EXISTS audit (
        n INTEGER PRIMARY KEY, event TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rejected (
        id TEXT PRIMARY KEY, body_digest TEXT NOT NULL, reason TEXT NOT NULL);
    ''')
    with transaction(db):
        db.execute('INSERT OR IGNORE INTO meta VALUES (?,?)',
                   ('incarnation', incarnation or str(uuid.uuid4())))
    return db


def snapshot(path):
    if not Path(path).exists():
        return {'missing': True}
    db = connect(path)
    result = {}
    for table in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
        result[table[0]] = [dict(r) for r in db.execute('SELECT * FROM ' + table[0]).fetchall()]
    result['integrity_check'] = db.execute('PRAGMA integrity_check').fetchone()[0]
    db.close()
    return result


def git(repo, *args, check=True):
    p = subprocess.run(['git', '-C', str(repo), *args], text=True, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE)
    if check and p.returncode:
        raise RuntimeError(f'git {args}: {p.stderr}')
    return p.stdout.strip() if check else p


def atomic_write(path, content):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with open(temporary, 'w') as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def fsync_tree(directory):
    for path in Path(directory).rglob('*'):
        if path.is_file():
            with open(path, 'rb') as f:
                os.fsync(f.fileno())
    for path in [*Path(directory).rglob('*'), Path(directory)]:
        if path.is_dir():
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)


def init_repo(path):
    path.mkdir()
    git(path, 'init', '-q')
    git(path, 'config', 'user.name', 'Runner Recovery Fixture')
    git(path, 'config', 'user.email', 'fixture@invalid.example')
    git(path, 'config', 'runner.repoIdentity', 'fixture:customer/repo')
    (path / 'safe.txt').write_text('status=FAIL\noriginal failing baseline\n')
    git(path, 'add', 'safe.txt')
    git(path, 'commit', '-qm', 'original failing baseline')
    fsync_tree(path)
    return git(path, 'rev-parse', 'HEAD')


def checkpoint(repo, command):
    commit = git(repo, 'rev-parse', 'HEAD')
    content = subprocess.check_output(['git', '-C', str(repo), 'show', f'{commit}:safe.txt'])
    return dict(repo_identity=git(repo, 'config', 'runner.repoIdentity'),
                baseline=command['payload']['baseline'], checkpoint=commit,
                pinned_input=digest(command['payload']['pinned_input']),
                artifacts={'safe.txt': hashlib.sha256(content).hexdigest()})


def verify_checkpoint(repo, record, expected, destination=None):
    if record['repo_identity'] != expected['repo_identity']:
        raise ValueError('wrong_repository_manifest')
    if git(repo, 'config', 'runner.repoIdentity') != expected['repo_identity']:
        raise ValueError('wrong_repository_source')
    if record['baseline'] != expected['baseline']:
        raise ValueError('wrong_baseline')
    if record['pinned_input'] != digest(expected['pinned_input']):
        raise ValueError('wrong_pinned_input')
    if set(record['artifacts']) != {'safe.txt'}:
        raise ValueError('wrong_artifact_scope')
    for name in ('baseline', 'checkpoint'):
        result = git(repo, 'cat-file', '-t', record[name], check=False)
        if result.returncode or result.stdout.strip() != 'commit':
            raise ValueError('missing_' + name + '_commit')
    if not git(repo, 'for-each-ref', '--format=%(refname)', '--contains=' + record['checkpoint']):
        raise ValueError('unreachable_checkpoint')
    if git(repo, 'merge-base', '--is-ancestor', record['baseline'], record['checkpoint'], check=False).returncode:
        raise ValueError('checkpoint_not_descendant_of_baseline')
    for path, sha in record['artifacts'].items():
        body = subprocess.check_output(['git', '-C', str(repo), 'show', record['checkpoint'] + ':' + path])
        if hashlib.sha256(body).hexdigest() != sha:
            raise ValueError('artifact_digest_mismatch')
    if destination is not None:
        subprocess.run(['git', 'clone', '-q', '--no-local', str(repo), str(destination)], check=True)
        git(destination, 'checkout', '-q', '--detach', record['checkpoint'])
        for path, sha in record['artifacts'].items():
            if hashlib.sha256((destination / path).read_bytes()).hexdigest() != sha:
                raise ValueError('fresh_checkout_digest_mismatch')
        if git(destination, 'status', '--porcelain'):
            raise ValueError('dirty_fresh_checkout')
    return {'verified': True, 'baseline': record['baseline'], 'checkpoint': record['checkpoint'],
            'artifact_shas': record['artifacts'], 'manifest_digest': digest(record),
            'expected_payload_digest': digest(expected),
            'fresh_checkout': str(destination) if destination else None}


class Service:
    def __init__(self, path, command, incarnation):
        self.path = path
        db = connect(path)
        db.executescript('''
          CREATE TABLE state (id INTEGER PRIMARY KEY, generation INTEGER,
            incarnation TEXT, cancelled INTEGER, consumed INTEGER, budget INTEGER,
            current_attempt TEXT, stopped INTEGER);
          CREATE TABLE grants (id TEXT PRIMARY KEY, invocation TEXT UNIQUE,
            digest TEXT, body TEXT);
          CREATE TABLE receipts (id TEXT PRIMARY KEY, body TEXT);
          CREATE TABLE results (id TEXT PRIMARY KEY, digest TEXT, verdict TEXT, body TEXT);
          CREATE TABLE observations (n INTEGER PRIMARY KEY, kind TEXT, body TEXT);
          CREATE TABLE process_bindings (invocation TEXT PRIMARY KEY, command TEXT, instance TEXT, pid INTEGER);
          CREATE TABLE admission_verdicts (id TEXT PRIMARY KEY, digest TEXT, verdict TEXT);
        ''')
        with transaction(db):
            db.execute('INSERT INTO state VALUES(1, ?, ?, 0, 1, 2, ?, 0)',
                       (command['generation'], incarnation, command['attempt']))
            db.execute('INSERT INTO grants VALUES(?,?,?,?)', (command_key(command), invocation_key(command),
                       command['payload_digest'], canonical(command)))
        db.close()
        self.command = command
        self.drop_result_once = False
        self.drop_receipt_once = False
        self.disabled = False
        self.lock = threading.Lock()
        service = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.reply(200, service.command)

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                with service.lock:
                    if service.disabled:
                        self.connection.shutdown(2)
                        self.connection.close()
                        return
                    result = service.handle(self.path, payload)
                    drop = (self.path == '/result' and service.drop_result_once) or (
                        self.path == '/receipt' and service.drop_receipt_once)
                    if drop:
                        service.drop_result_once = False
                        service.drop_receipt_once = False
                        self.connection.shutdown(2)
                        self.connection.close()
                        return
                self.reply(200, result)

            def reply(self, code, obj):
                body = canonical(obj).encode()
                self.send_response(code)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.http = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}'

    def close(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()

    def handle(self, path, value):
        db = connect(self.path)
        try:
            with transaction(db):
                state = dict(db.execute('SELECT * FROM state').fetchone())
                db.execute('INSERT INTO observations(kind,body) VALUES (?,?)', (path, canonical(value)))
                if path == '/reconnect':
                    return dict(accepted=value['incarnation'] == state['incarnation'],
                                generation=state['generation'], cancelled=bool(state['cancelled']),
                                reason='ready' if value['incarnation'] == state['incarnation'] else 'journal_lost_or_replaced')
                if path == '/status':
                    return state
                if path == '/process_started':
                    command = value['command']
                    grant = db.execute('SELECT * FROM grants WHERE id=?', (command_key(command),)).fetchone()
                    if not grant or grant['digest'] != command_digest(command):
                        return {'accepted': False}
                    prior = db.execute('SELECT * FROM process_bindings WHERE invocation=?',
                                       (invocation_key(command),)).fetchone()
                    if prior:
                        return {'accepted': prior['instance'] == value['process_instance'] and prior['pid'] == value['pid']}
                    db.execute('INSERT INTO process_bindings VALUES(?,?,?,?)', (invocation_key(command),
                               command_key(command), value['process_instance'], value['pid']))
                    return {'accepted': True}
                if path == '/receipt':
                    if value['incarnation'] != state['incarnation']:
                        return {'accepted': False, 'reason': 'wrong_incarnation'}
                    grant = db.execute('SELECT * FROM grants WHERE id=?', (value['id'],)).fetchone()
                    if not grant or grant['digest'] != value['digest']:
                        return {'accepted': False, 'reason': 'unknown_or_conflicting_grant'}
                    prior = db.execute('SELECT body FROM receipts WHERE id=?', (value['id'],)).fetchone()
                    if prior:
                        return {'accepted': prior['body'] == canonical(value), 'duplicate': True}
                    db.execute('INSERT INTO receipts VALUES(?,?)', (value['id'], canonical(value)))
                    return {'accepted': True, 'meaning': 'daemon_receipt_only'}
                if path == '/result':
                    result_id = value['result_id']
                    sha = digest(value)
                    prior = db.execute('SELECT * FROM results WHERE id=?', (result_id,)).fetchone()
                    if prior:
                        return {'verdict': prior['verdict'] if prior['digest'] == sha else 'result_payload_conflict',
                                'duplicate': True}
                    command = value['command']
                    grant = db.execute('SELECT * FROM grants WHERE id=?', (command_key(command),)).fetchone()
                    if not grant or grant['digest'] != command_digest(command):
                        verdict = 'unknown_or_conflicting_grant'
                    elif command['generation'] != state['generation'] or command['attempt'] != state['current_attempt']:
                        verdict = 'stale_generation_or_attempt'
                    elif state['cancelled']:
                        verdict = 'cancelled_observation_only'
                    elif time.time() >= command['grant']['expires_at']:
                        verdict = 'expired_grant_observation_only'
                    else:
                        verdict = 'accepted'
                    db.execute('INSERT INTO results VALUES(?,?,?,?)',
                               (result_id, sha, verdict, canonical(value)))
                    return {'verdict': verdict, 'duplicate': False}
                if path == '/stop_ack':
                    binding = db.execute('SELECT * FROM process_bindings WHERE invocation=?',
                                         (invocation_key(value['command']),)).fetchone()
                    accepted = (value['generation'] == state['generation'] and
                                value['attempt'] == state['current_attempt'] and
                                value['generation'] == value['command']['generation'] and
                                value['attempt'] == value['command']['attempt'] and
                                value['incarnation'] == state['incarnation'] and
                                binding is not None and binding['command'] == command_key(value['command']) and
                                binding['instance'] == value['proof']['process_instance'] and
                                binding['pid'] == value['proof']['pid'] and
                                value['proof']['terminated'] is True and
                                value['proof']['method'] == 'linux_pidfd_exit' and
                                bool(value['proof']['process_instance']))
                    if accepted:
                        db.execute('UPDATE state SET stopped=1 WHERE id=1')
                    return {'accepted': accepted, 'scope': 'single_fixture_process_only',
                            'external_effects_accounted': False}
                raise ValueError('unknown request')
        finally:
            db.close()

    def change(self, **values):
        db = connect(self.path)
        with transaction(db):
            for key, value in values.items():
                assert key in ('generation', 'cancelled', 'incarnation', 'current_attempt', 'stopped')
                db.execute('UPDATE state SET ' + key + '=? WHERE id=1', (value,))
        db.close()

    def admit_recovery(self, command, verification):
        db = connect(self.path)
        try:
            with transaction(db):
                state = dict(db.execute('SELECT * FROM state').fetchone())
                request_key, request_digest = command_key(command), command_digest(command)
                prior_verdict = db.execute('SELECT * FROM admission_verdicts WHERE id=?', (request_key,)).fetchone()
                if prior_verdict:
                    if prior_verdict['digest'] != request_digest:
                        return {'accepted': False, 'reason': 'admission_payload_conflict'}
                    return dict(json.loads(prior_verdict['verdict']), duplicate=True)
                def verdict(value):
                    db.execute('INSERT INTO admission_verdicts VALUES(?,?,?)',
                               (request_key, request_digest, canonical(value)))
                    return value
                if command['payload_digest'] != request_digest:
                    return verdict({'accepted': False, 'reason': 'invalid_payload_digest'})
                prior = db.execute('SELECT * FROM grants WHERE id=?', (command_key(command),)).fetchone()
                if prior:
                    return verdict({'accepted': prior['digest'] == command['payload_digest'], 'duplicate': True})
                if command['grant']['class'] != 'verified_reconstruction':
                    return verdict({'accepted': False, 'reason': 'wrong_recovery_class'})
                if not verification or not verification.get('verified'):
                    return verdict({'accepted': False, 'reason': 'checkpoint_not_verified'})
                expected_payload = {k: v for k, v in command['payload'].items() if k != 'reconstruction'}
                if (verification['manifest_digest'] != digest(command['payload']['reconstruction']) or
                        verification['expected_payload_digest'] != digest(expected_payload)):
                    return verdict({'accepted': False, 'reason': 'verification_scope_mismatch'})
                if command['attempt'] == state['current_attempt']:
                    return verdict({'accepted': False, 'reason': 'fresh_attempt_required'})
                if db.execute('SELECT 1 FROM grants WHERE invocation=?', (invocation_key(command),)).fetchone():
                    return verdict({'accepted': False, 'reason': 'invocation_already_admitted'})
                if state['cancelled'] or not state['stopped']:
                    return verdict({'accepted': False, 'reason': 'cancelled_or_writer_not_proven_stopped'})
                if state['consumed'] >= state['budget']:
                    return verdict({'accepted': False, 'reason': 'budget_exhausted'})
                if command['generation'] <= state['generation']:
                    return verdict({'accepted': False, 'reason': 'fresh_generation_required'})
                if time.time() >= command['grant']['expires_at']:
                    return verdict({'accepted': False, 'reason': 'grant_expired'})
                db.execute('INSERT INTO grants VALUES(?,?,?,?)', (command_key(command), invocation_key(command),
                           command['payload_digest'], canonical(command)))
                db.execute('UPDATE state SET generation=?,current_attempt=?,consumed=consumed+1,stopped=0 WHERE id=1',
                           (command['generation'], command['attempt']))
                return verdict({'accepted': True, 'consumed': state['consumed'] + 1})
        finally:
            db.close()


def post(url, route, body):
    request = urllib.request.Request(url + route, data=canonical(body).encode(),
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


def native_fixture(args):
    db = connect(Path(args.case) / 'counter.sqlite')
    db.execute('CREATE TABLE IF NOT EXISTS launches(id INTEGER PRIMARY KEY, process_instance TEXT, pid INTEGER)')
    with transaction(db):
        db.execute('INSERT INTO launches(process_instance,pid) VALUES(?,?)', (args.instance, os.getpid()))
    db.close()
    atomic_write(Path(args.case) / 'invoked.json', canonical({'pid': os.getpid(), 'instance': args.instance}))
    time.sleep(args.delay)
    repo = Path(args.case) / 'repo'
    atomic_write(repo / 'safe.txt', 'status=RECOVERED\nsafe local fixture checkpoint\n')
    git(repo, 'add', 'safe.txt')
    git(repo, 'commit', '-qm', 'safe fixture recovered working checkpoint')
    fsync_tree(repo)
    atomic_write(Path(args.case) / 'child_complete.json', canonical({'pid': os.getpid(), 'instance': args.instance}))


def worker(args):
    case = Path(args.case)
    lock_file = open(case / 'daemon.lock', 'a+')
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        event('runner_already_running')
        return
    db = init_journal(case / 'journal.sqlite')
    incarnation = db.execute("SELECT value FROM meta WHERE key='incarnation'").fetchone()[0]
    summary = [dict(r) for r in db.execute('SELECT id,state,process_id,process_instance FROM commands')]
    reconnect = post(args.url, '/reconnect', {'incarnation': incarnation, 'summary': summary})
    event('reconnect', **reconnect, summary=summary)
    if not reconnect['accepted']:
        return
    command = json.load(urllib.request.urlopen(args.url + '/command', timeout=5))
    key, inv, sha = command_key(command), invocation_key(command), command_digest(command)
    event('before_receipt')
    with transaction(db):
        row = db.execute('SELECT * FROM commands WHERE id=?', (key,)).fetchone()
        by_inv = db.execute('SELECT * FROM commands WHERE invocation=?', (inv,)).fetchone()
        rejected = db.execute('SELECT * FROM rejected WHERE id=?', (key,)).fetchone()
        rejection = None
        if rejected:
            rejection = rejected['reason'] if rejected['body_digest'] == digest(command) else 'command_payload_conflict'
        elif sha != command['payload_digest']:
            rejection = 'invalid_payload_digest'
        elif row and row['digest'] != sha:
            rejection = 'command_payload_conflict'
        elif by_inv and by_inv['id'] != key:
            rejection = 'invocation_already_bound_to_other_command'
        if rejection:
            db.execute('INSERT INTO audit(event,body) VALUES(?,?)', (rejection, canonical(command)))
            if not row and not rejected:
                db.execute('INSERT INTO rejected VALUES(?,?,?)', (key, digest(command), rejection))
        elif not row:
            db.execute('INSERT INTO commands(id,invocation,digest,body,state) VALUES(?,?,?,?,?)',
                       (key, inv, sha, canonical(command), 'received'))
    if rejection:
        event('rejected', reason=rejection)
        return
    event('receipt_durable')
    try:
        ack = post(args.url, '/receipt', {'id': key, 'incarnation': incarnation, 'digest': sha})
    except (OSError, http.client.HTTPException, urllib.error.URLError) as ex:
        event('transport_disconnected', operation='receipt', error=type(ex).__name__)
        return
    event('receipt_acknowledged', acknowledgment=ack)
    if not ack['accepted']:
        with transaction(db):
            db.execute('UPDATE commands SET state=?,pause=? WHERE id=?',
                       ('paused', 'service_receipt_rejected:' + ack.get('reason', 'rejected'), key))
        event('paused', reason='service_receipt_rejected', acknowledgment=ack)
        return
    row = db.execute('SELECT * FROM commands WHERE id=?', (key,)).fetchone()
    if row['state'] in ('received',):
        status = post(args.url, '/status', {})
        reason = ('grant_expired' if time.time() >= command['grant']['expires_at'] else
                  'cancelled' if status['cancelled'] else
                  'stale_generation' if status['generation'] != command['generation'] else
                  'stale_attempt' if status['current_attempt'] != command['attempt'] else None)
        if reason:
            with transaction(db):
                db.execute('UPDATE commands SET state=?,pause=? WHERE id=?', ('paused', reason, key))
            event('paused', reason=reason)
            return
        instance = str(uuid.uuid4())
        with transaction(db):
            db.execute('UPDATE commands SET state=?,process_instance=? WHERE id=?', ('dispatch_unknown', instance, key))
        event('launch_intent_durable')
        process = subprocess.Popen([sys.executable, str(HERE / 'probe.py'), 'child', '--case', str(case),
                                    '--instance', instance, '--delay', str(args.delay)],
                                   start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        event('after_spawn', child_pid=process.pid, process_instance=instance)
        with transaction(db):
            db.execute('UPDATE commands SET process_id=? WHERE id=?', (process.pid, key))
        post(args.url, '/process_started', {'command': command, 'process_instance': instance, 'pid': process.pid})
        while not (case / 'invoked.json').exists():
            if process.poll() is not None:
                event('paused', reason='child_exited_without_invocation_marker')
                return
            time.sleep(.002)
        event('invocation_observed', child_pid=process.pid, process_instance=instance)
        process.wait()
        if process.returncode:
            event('paused', reason='child_failed')
            return
        event('child_finished_before_checkpoint')
        record = checkpoint(case / 'repo', command)
        fsync_tree(case / 'repo')
        with transaction(db):
            db.execute('UPDATE commands SET state=?,checkpoint=? WHERE id=?', ('checkpointed', canonical(record), key))
        event('checkpoint_durable', checkpoint=record)
    row = db.execute('SELECT * FROM commands WHERE id=?', (key,)).fetchone()
    if row['state'] == 'dispatch_unknown':
        event('paused', reason='dispatch_outcome_unknown_no_relaunch', child_pid=row['process_id'],
              process_instance=row['process_instance'])
        return
    if row['state'] == 'paused':
        event('paused', reason=row['pause'])
        return
    if row['state'] == 'checkpointed':
        result = {'result_id': digest({'command_id': key, 'kind': 'completion-v1'}),
                  'command': command, 'checkpoint': json.loads(row['checkpoint'])}
        with transaction(db):
            db.execute('UPDATE commands SET state=?,result=? WHERE id=?', ('result_ready', canonical(result), key))
        event('result_durable', result_id=result['result_id'])
    row = db.execute('SELECT * FROM commands WHERE id=?', (key,)).fetchone()
    event('before_service_result_acceptance')
    try:
        verdict = post(args.url, '/result', json.loads(row['result']))
    except (OSError, http.client.HTTPException, urllib.error.URLError) as ex:
        event('transport_disconnected', operation='result', error=type(ex).__name__)
        return
    event('after_service_result_acceptance', verdict=verdict)
    with transaction(db):
        db.execute('UPDATE commands SET state=? WHERE id=?',
                   ('result_accepted' if verdict['verdict'] == 'accepted' else 'result_rejected', key))
    event('result_ack_durable', verdict=verdict)


def run_worker(case, service, kill_at=None, delay=.05, barrier_callback=None):
    process = subprocess.Popen([sys.executable, str(HERE / 'probe.py'), 'worker', '--case', str(case),
                                '--url', service.url, '--delay', str(delay)],
                               text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=1)
    events = []
    while True:
        line = process.stdout.readline()
        if not line:
            break
        item = json.loads(line)
        events.append(item)
        stopped_pid, stopped_status = os.waitpid(process.pid, os.WUNTRACED)
        assert stopped_pid == process.pid and os.WIFSTOPPED(stopped_status)
        if barrier_callback:
            barrier_callback(item)
        if item['stage'] == kill_at:
            # Worker stops itself after every observable barrier until CONT.
            # This closes the race where a later durable write could precede SIGKILL.
            os.kill(process.pid, signal.SIGKILL)
            break
        os.kill(process.pid, signal.SIGCONT)
    process.wait(timeout=15)
    stderr = process.stderr.read()
    if process.returncode not in (0, -signal.SIGKILL):
        raise RuntimeError(f'worker failure {process.returncode}: {stderr}')
    return {'pid': process.pid, 'exit_code': process.returncode, 'events': events, 'stderr': stderr}


def launches(case):
    path = Path(case) / 'counter.sqlite'
    if not path.exists():
        return 0
    db = connect(path)
    try:
        return db.execute('SELECT COUNT(*) FROM launches').fetchone()[0]
    finally:
        db.close()


def wait_child(case, timeout=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if (Path(case) / 'child_complete.json').exists():
            return True
        time.sleep(.01)
    return False


def make_case(work, name, expires=120):
    case = work / name
    case.mkdir()
    baseline = init_repo(case / 'repo')
    incarnation = str(uuid.uuid4())
    init_journal(case / 'journal.sqlite', incarnation).close()
    command = {'tenant': 'tenant-A', 'runner': 'runner-A', 'run': 'run-A', 'occurrence': 'node:work:0',
               'attempt': 'attempt-1', 'generation': 1, 'command': 'command-1',
               'payload': {'baseline': baseline, 'repo_identity': 'fixture:customer/repo',
                           'pinned_input': {'spec_revision': 'fixture-spec-v1', 'policy': 'local-files-only'},
                           'operation': 'safe-local-counter-and-git'},
               'grant': {'id': 'grant-1', 'class': 'initial', 'expires_at': time.time() + expires}}
    command['payload_digest'] = command_digest(command)
    service = Service(case / 'service.sqlite', command, incarnation)
    return case, service, command, incarnation


def states(case):
    return {'journal': snapshot(case / 'journal.sqlite'), 'service': snapshot(case / 'service.sqlite'),
            'counter': snapshot(case / 'counter.sqlite'),
            'git': {'head': git(case / 'repo', 'rev-parse', 'HEAD'),
                    'status': git(case / 'repo', 'status', '--porcelain')}}


def clone_value(value):
    return json.loads(json.dumps(value))


def run_suite(work):
    results = []
    stages = ['before_receipt', 'receipt_durable', 'receipt_acknowledged', 'launch_intent_durable',
              'after_spawn', 'invocation_observed', 'child_finished_before_checkpoint', 'checkpoint_durable',
              'result_durable', 'before_service_result_acceptance', 'after_service_result_acceptance', 'result_ack_durable']
    for stage in stages:
        case, service, command, incarnation = make_case(work, 'kill_' + stage)
        first = run_worker(case, service, kill_at=stage)
        before = states(case)
        if any(e['stage'] == 'after_spawn' for e in first['events']):
            assert wait_child(case), 'orphan safe subprocess did not complete'
        second = run_worker(case, service)
        count = launches(case)
        uncertain = stage in ('launch_intent_durable', 'after_spawn', 'invocation_observed', 'child_finished_before_checkpoint')
        assert count == (0 if stage == 'launch_intent_durable' else 1), (stage, count)
        if uncertain:
            assert any(e.get('reason') == 'dispatch_outcome_unknown_no_relaunch' for e in second['events'])
            assert not states(case)['service']['results']
        else:
            assert states(case)['service']['results'][0]['verdict'] == 'accepted'
        results.append({'name': 'sigkill_' + stage, 'first': first, 'before_reconnect': before,
                        'reconnect': second, 'final': states(case), 'launches': count,
                        'outcome': 'explicit_recovery_pause' if uncertain else 'completed_once'})
        service.close()

    for kind in ('receipt', 'result'):
        case, service, command, incarnation = make_case(work, 'disconnect_' + kind)
        setattr(service, 'drop_' + kind + '_once', True)
        first = run_worker(case, service)
        before = states(case)
        assert any(e['stage'] == 'transport_disconnected' for e in first['events'])
        second = run_worker(case, service)
        assert launches(case) == 1
        assert len(states(case)['service']['results']) == 1
        results.append({'name': 'loopback_disconnect_after_' + kind + '_commit', 'first': first,
                        'before_reconnect': before, 'reconnect': second, 'final': states(case), 'launches': 1})
        service.close()

    for kind, stage in (('receipt', 'receipt_durable'), ('result', 'before_service_result_acceptance')):
        case, service, command, incarnation = make_case(work, 'disconnect_before_' + kind)
        def disconnect_at_stage(item):
            if item['stage'] == stage:
                service.disabled = True
        first = run_worker(case, service, barrier_callback=disconnect_at_stage)
        before = states(case)
        assert any(e['stage'] == 'transport_disconnected' for e in first['events'])
        assert not before['service']['results']
        service.disabled = False
        second = run_worker(case, service)
        assert launches(case) == 1
        assert len(states(case)['service']['results']) == 1
        results.append({'name': 'loopback_disconnect_before_' + kind + '_service_commit', 'first': first,
                        'before_reconnect': before, 'reconnect': second, 'final': states(case), 'launches': 1})
        service.close()

    for already_accepted in (False, True):
        case, service, command, incarnation = make_case(work, 'result_expiry_' + str(already_accepted), expires=1.5)
        first = run_worker(case, service, kill_at=None if already_accepted else 'result_durable')
        time.sleep(max(0, command['grant']['expires_at'] - time.time()) + .02)
        second = run_worker(case, service)
        verdict = next(e['verdict'] for e in second['events'] if e['stage'] == 'after_service_result_acceptance')
        assert verdict['verdict'] == ('accepted' if already_accepted else 'expired_grant_observation_only')
        assert verdict['duplicate'] is already_accepted
        assert launches(case) == 1
        results.append({'name': 'expired_result_' + ('replays_prior_acceptance' if already_accepted else 'records_rejection'),
                        'first': first, 'reconnect': second, 'final': states(case), 'launches': 1})
        service.close()

    case, service, command, incarnation = make_case(work, 'duplicates')
    simultaneous = []
    original = run_worker(case, service, barrier_callback=lambda e:
                          simultaneous.append(run_worker(case, service)) if e['stage'] == 'receipt_durable' else None)
    assert simultaneous[0]['events'][0]['stage'] == 'runner_already_running'
    duplicate = run_worker(case, service)
    changed = clone_value(command)
    changed['payload']['operation'] = 'different-safe-operation'
    changed['payload_digest'] = command_digest(changed)
    service.command = changed
    conflict = run_worker(case, service)
    different = clone_value(command)
    different['command'] = 'command-2-same-attempt'
    different['payload_digest'] = command_digest(different)
    service.command = different
    same_attempt = run_worker(case, service)
    invalid = clone_value(command)
    invalid['command'] = 'invalid-command'
    invalid['payload_digest'] = '0' * 64
    service.command = invalid
    invalid_first = run_worker(case, service)
    invalid_replay = run_worker(case, service)
    invalid['payload_digest'] = command_digest(invalid)
    invalid_corrected = run_worker(case, service)
    assert launches(case) == 1
    assert any(e.get('reason') == 'command_payload_conflict' for e in conflict['events'])
    assert any(e.get('reason') == 'invocation_already_bound_to_other_command' for e in same_attempt['events'])
    assert any(e.get('reason') == 'invalid_payload_digest' for e in invalid_replay['events'])
    assert any(e.get('reason') == 'command_payload_conflict' for e in invalid_corrected['events'])
    db = connect(case / 'journal.sqlite')
    result = json.loads(db.execute('SELECT result FROM commands').fetchone()[0])
    db.close()
    service.change(generation=2, current_attempt='replacement-2', cancelled=1)
    accepted_replay_after_replacement = post(service.url, '/result', result)
    assert accepted_replay_after_replacement == {'verdict': 'accepted', 'duplicate': True}
    result['checkpoint']['artifacts']['safe.txt'] = '0' * 64
    result_conflict = post(service.url, '/result', result)
    assert result_conflict['verdict'] == 'result_payload_conflict'
    results.append({'name': 'duplicate_conflicting_and_same_attempt_commands', 'original': original,
                    'simultaneous_daemon': simultaneous,
                    'duplicate': duplicate, 'conflict': conflict, 'same_attempt_new_command': same_attempt,
                    'invalid_first': invalid_first, 'invalid_replay': invalid_replay, 'invalid_corrected': invalid_corrected,
                    'accepted_replay_after_replacement': accepted_replay_after_replacement,
                    'conflicting_result': result_conflict, 'final': states(case), 'launches': 1})
    service.close()

    for reason in ('expired', 'cancelled'):
        case, service, command, incarnation = make_case(work, 'before_launch_' + reason, expires=-1 if reason == 'expired' else 120)
        if reason == 'cancelled':
            service.change(cancelled=1)
        run = run_worker(case, service)
        assert launches(case) == 0
        results.append({'name': reason + '_grant_prevents_launch', 'run': run, 'final': states(case), 'launches': 0})
        service.close()

    case, service, command, incarnation = make_case(work, 'unadmitted_attempt')
    unadmitted = clone_value(command)
    unadmitted.update(attempt='never-admitted-attempt', command='never-admitted-command')
    unadmitted['payload_digest'] = command_digest(unadmitted)
    service.command = unadmitted
    first = run_worker(case, service)
    duplicate = run_worker(case, service)
    assert launches(case) == 0
    assert any(e.get('reason') == 'service_receipt_rejected' for e in first['events'])
    assert not states(case)['service']['receipts']
    assert states(case)['service']['state'][0]['consumed'] == 1
    results.append({'name': 'unadmitted_attempt_rejected_before_launch', 'first': first, 'duplicate': duplicate,
                    'launches': 0, 'final': states(case)})
    service.close()

    case, service, command, incarnation = make_case(work, 'lost_journal')
    first = run_worker(case, service, kill_at='receipt_acknowledged')
    before = states(case)
    for path in case.glob('journal.sqlite*'):
        path.unlink()
    replacement = run_worker(case, service)
    assert launches(case) == 0
    assert replacement['events'][0]['reason'] == 'journal_lost_or_replaced'
    results.append({'name': 'journal_loss_replacement_pauses', 'first': first, 'before_loss': before,
                    'replacement': replacement, 'final': states(case), 'launches': 0})
    service.close()

    case, service, command, incarnation = make_case(work, 'expiry_not_process_stop', expires=.8)
    first = run_worker(case, service, kill_at='invocation_observed', delay=1.2)
    child = next(e for e in first['events'] if e['stage'] == 'invocation_observed')
    time.sleep(max(0, command['grant']['expires_at'] - time.time()) + .02)
    os.kill(child['child_pid'], 0)
    alive_at_expiry = True
    assert wait_child(case)
    service.change(generation=2, current_attempt='replacement-2')
    # The old result is retained as historical observation but never advances replacement.
    old_result = {'result_id': 'old-observed-completion', 'command': command,
                  'checkpoint': checkpoint(case / 'repo', command)}
    stale_result = post(service.url, '/result', old_result)
    stale_stop = post(service.url, '/stop_ack', {'generation': 1, 'attempt': 'attempt-1',
                       'incarnation': incarnation, 'command': command,
                       'proof': {'terminated': True, 'method': 'linux_pidfd_exit',
                       'process_instance': child['process_instance'], 'pid': child['child_pid']}})
    assert stale_result['verdict'] == 'stale_generation_or_attempt'
    assert stale_stop['accepted'] is False
    assert states(case)['service']['state'][0]['stopped'] == 0
    results.append({'name': 'expiry_not_physical_stop_stale_result_and_stop_ack', 'run': first,
                    'alive_at_expiry': alive_at_expiry, 'safe_write_completed_after_expiry': True,
                    'stale_result': stale_result, 'stale_stop_ack': stale_stop, 'final': states(case)})
    service.close()

    case, service, command, incarnation = make_case(work, 'cancel_stop')
    first = run_worker(case, service, kill_at='invocation_observed', delay=20)
    child = next(e for e in first['events'] if e['stage'] == 'invocation_observed')
    process_fd = os.pidfd_open(child['child_pid'])
    service.change(cancelled=1)
    os.kill(child['child_pid'], 0)
    os.killpg(child['child_pid'], signal.SIGTERM)
    readable, _, _ = select.select([process_fd], [], [], 5)
    assert readable, 'process termination was not proven'
    os.close(process_fd)
    proof = {'terminated': True, 'method': 'linux_pidfd_exit', 'process_instance': child['process_instance'],
             'pid': child['child_pid'], 'scope': 'one safe child process; no effect absence claim'}
    current_stop = post(service.url, '/stop_ack', {'generation': 1, 'attempt': 'attempt-1',
                          'incarnation': incarnation, 'command': command, 'proof': proof})
    forged_proof = dict(proof, process_instance='unrelated-process-instance')
    forged_stop = post(service.url, '/stop_ack', {'generation': 1, 'attempt': 'attempt-1',
                          'incarnation': incarnation, 'command': command, 'proof': forged_proof})
    assert current_stop['accepted']
    assert not forged_stop['accepted']
    assert not (case / 'child_complete.json').exists()
    results.append({'name': 'cancel_observe_alive_then_pidfd_confirmed_stop', 'run': first,
                    'alive_after_cancel': True, 'stop_proof': proof, 'stop_ack': current_stop,
                    'forged_stop_ack': forged_stop, 'final': states(case)})
    service.close()

    case, service, command, incarnation = make_case(work, 'git_reconstruction')
    first = run_worker(case, service, kill_at='checkpoint_durable')
    record = next(e['checkpoint'] for e in first['events'] if e['stage'] == 'checkpoint_durable')
    expected = command['payload']
    repo = case / 'repo'
    assert record['baseline'] != record['checkpoint']
    assert git(repo, 'show', record['baseline'] + ':safe.txt').startswith('status=FAIL')
    assert git(repo, 'show', record['checkpoint'] + ':safe.txt').startswith('status=RECOVERED')
    (repo / 'safe.txt').write_text('uncommitted tamper must not enter reconstruction\n')
    verified = verify_checkpoint(repo, record, expected, case / 'fresh-checkout')
    rejects = {}
    for name, mutation in {
        'artifact_tamper': lambda r: r['artifacts'].update({'safe.txt': '0' * 64}),
        'wrong_repo': lambda r: r.update(repo_identity='fixture:other/repo'),
        'wrong_baseline': lambda r: r.update(baseline=record['checkpoint']),
        'wrong_pinned_input': lambda r: r.update(pinned_input='0' * 64),
        'wrong_artifact_scope': lambda r: r['artifacts'].update({'secret.txt': '0' * 64}),
    }.items():
        altered = clone_value(record)
        mutation(altered)
        try:
            verify_checkpoint(repo, altered, expected)
        except ValueError as error:
            rejects[name] = str(error)
        else:
            raise AssertionError('unexpected verification: ' + name)
    missing = case / 'missing-object'
    subprocess.run(['git', 'clone', '-q', '--no-hardlinks', str(repo), str(missing)], check=True)
    git(missing, 'config', 'runner.repoIdentity', expected['repo_identity'])
    (missing / '.git' / 'objects' / record['checkpoint'][:2] / record['checkpoint'][2:]).unlink()
    try:
        verify_checkpoint(missing, record, expected)
    except ValueError as error:
        rejects['missing_object'] = str(error)
    else:
        raise AssertionError('missing object accepted')
    unreachable = case / 'unreachable'
    subprocess.run(['git', 'clone', '-q', '--no-hardlinks', str(repo), str(unreachable)], check=True)
    git(unreachable, 'config', 'runner.repoIdentity', expected['repo_identity'])
    for ref in git(unreachable, 'for-each-ref', '--format=%(refname)').splitlines():
        git(unreachable, 'update-ref', ref, record['baseline'])
    try:
        verify_checkpoint(unreachable, record, expected)
    except ValueError as error:
        rejects['unreachable_object'] = str(error)
    else:
        raise AssertionError('unreachable object accepted')
    service.change(stopped=1)  # Child was waited/reaped successfully before checkpoint event.
    recovery = clone_value(command)
    recovery.update(attempt='attempt-2', generation=2, command='reconstruct-2')
    recovery['payload']['reconstruction'] = record
    recovery['grant'] = {'id': 'grant-2', 'class': 'initial', 'expires_at': time.time() + 120}
    recovery['payload_digest'] = command_digest(recovery)
    wrong_class = service.admit_recovery(recovery, verified)
    recovery['grant']['class'] = 'verified_reconstruction'
    recovery['payload_digest'] = command_digest(recovery)
    corrected_same_id = service.admit_recovery(recovery, verified)
    assert corrected_same_id['reason'] == 'admission_payload_conflict'
    recovery['command'] = 'reconstruction-without-verification'
    recovery['payload_digest'] = command_digest(recovery)
    unverified = service.admit_recovery(recovery, None)
    unverified_replay_with_proof = service.admit_recovery(recovery, verified)
    assert unverified_replay_with_proof['reason'] == 'checkpoint_not_verified'
    mismatched = clone_value(recovery)
    mismatched['command'] = 'mismatched-verified-manifest'
    mismatched['payload']['reconstruction']['artifacts']['safe.txt'] = '0' * 64
    mismatched['payload_digest'] = command_digest(mismatched)
    mismatched_verdict = service.admit_recovery(mismatched, verified)
    assert mismatched_verdict['reason'] == 'verification_scope_mismatch'
    reused = clone_value(recovery)
    reused['command'] = 'reused-attempt'
    reused['attempt'] = 'attempt-1'
    reused['payload_digest'] = command_digest(reused)
    reused_verdict = service.admit_recovery(reused, verified)
    assert wrong_class['reason'] == 'wrong_recovery_class'
    assert unverified['reason'] == 'checkpoint_not_verified'
    assert reused_verdict['reason'] == 'fresh_attempt_required'
    recovery['command'] = 'reconstruct-accepted'
    recovery['payload_digest'] = command_digest(recovery)
    admitted = service.admit_recovery(recovery, verified)
    replay = service.admit_recovery(recovery, verified)
    assert admitted['accepted'] and replay['duplicate']
    assert states(case)['service']['state'][0]['consumed'] == 2
    service.change(stopped=1)
    exhausted = clone_value(recovery)
    exhausted.update(attempt='attempt-3', generation=3, command='reconstruct-3')
    exhausted['payload_digest'] = command_digest(exhausted)
    budget = service.admit_recovery(exhausted, verified)
    assert budget['reason'] == 'budget_exhausted'
    results.append({'name': 'verified_git_checkpoint_and_fresh_recovery_admission', 'run': first,
                    'checkpoint': record, 'verification': verified, 'rejected_checkpoints': rejects,
                    'original_baseline_content': git(repo, 'show', record['baseline'] + ':safe.txt'),
                    'recovered_checkpoint_content': (case / 'fresh-checkout' / 'safe.txt').read_text(),
                    'recovery_grants': {'wrong_class': wrong_class, 'unverified': unverified,
                        'corrected_same_id': corrected_same_id, 'unverified_replay_with_proof': unverified_replay_with_proof,
                        'mismatched_manifest': mismatched_verdict,
                        'same_attempt': reused_verdict, 'accepted': admitted, 'replayed': replay, 'exhausted': budget},
                    'final': states(case)})
    service.close()
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('suite', 'worker', 'child'))
    parser.add_argument('--case')
    parser.add_argument('--url')
    parser.add_argument('--instance')
    parser.add_argument('--delay', type=float, default=.05)
    parser.add_argument('--output', default=str(HERE / 'evidence.json'))
    parser.add_argument('--workdir')
    args = parser.parse_args()
    if args.mode == 'child':
        native_fixture(args)
    elif args.mode == 'worker':
        # Stable parent-visible crash barriers; SIGSTOP follows every event,
        # parent sends CONT or KILL only after waitpid observes stopped state.
        global event
        plain_event = event
        def event(stage, **values):
            plain_event(stage, **values)
            os.kill(os.getpid(), signal.SIGSTOP)
        worker(args)
    else:
        work = Path(args.workdir) if args.workdir else Path(tempfile.mkdtemp(prefix='runner-daemon-probe-'))
        work.mkdir(parents=True, exist_ok=True)
        results = run_suite(work)
        report = {'passed': True, 'case_count': len(results), 'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'environment': {'python': sys.version, 'git': subprocess.check_output(['git', '--version'], text=True).strip(),
                                  'platform': sys.platform, 'sqlite': sqlite3.sqlite_version},
                  'workdir': str(work), 'cases': results}
        Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
        print(canonical({'passed': True, 'case_count': len(results), 'output': args.output, 'workdir': str(work)}))


if __name__ == '__main__':
    main()
