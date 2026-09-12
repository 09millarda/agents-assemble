#!/usr/bin/env python3
"""Disposable, opt-in native-account app-server conformance probe.

Never reads auth files. Raw RPC responses exist only in process memory. Persisted
traces retain lifecycle metadata, never prompts, model reasoning, account PII,
command output, native thread IDs or credentials. No external Git remote is used.
"""
import argparse, hashlib, json, os, platform, queue, re, shutil, signal, subprocess, sys, tempfile, threading, time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def sha(value):
    return hashlib.sha256(value).hexdigest()


def run(argv, cwd=None, check=True):
    completed = subprocess.run(argv, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and completed.returncode:
        raise RuntimeError(f'Local fixture command failed: {argv[0:2]}, exit {completed.returncode}')
    return completed


def git(repo, *args):
    return run(['git', '-C', str(repo), *args]).stdout.strip()


def clean_error(message):
    text = str(message).replace(str(Path.home()), '<user-home>')
    text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '<email>', text)
    text = re.sub(r'\b(?:sk-|eyJ)[A-Za-z0-9_.-]+', '<credential>', text)
    return text[:400]


class Client:
    def __init__(self, trace, cwd, launch=None):
        self.events = []
        self.trace = trace
        self.queue = queue.Queue()
        self.serial = 0
        self.threads = {}
        self.turns = {}
        self.stderr_bytes = 0
        self.raw_methods = Counter()
        # Explicit allow-list. HOME/PATH preserve normal installed native login.
        # No provider API key or host/session/auth-token environment is passed.
        allowed = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR',
                   'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
                   'SSL_CERT_FILE', 'SSL_CERT_DIR']
        child_env = {key: os.environ[key] for key in allowed if key in os.environ}
        child_env['PYTHONDONTWRITEBYTECODE'] = '1'
        self.env_names = sorted(child_env)
        self.proc = subprocess.Popen(
            (launch(child_env) if launch else ['codex', 'app-server', '--stdio']), cwd=cwd, env=child_env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, start_new_session=True)
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._stderr, daemon=True).start()
        self.response('initialize', {'clientInfo': {'name': 'agents_assemble_probe', 'title': 'Agents Assemble disposable probe', 'version': '0.1.0'}, 'capabilities': {'experimentalApi': True}})
        self.send({'method': 'initialized', 'params': {}})

    def _read(self):
        for line in self.proc.stdout:
            try:
                self.queue.put(json.loads(line))
            except json.JSONDecodeError:
                self.events.append({'event': 'unparsed_stdout', 'bytes': len(line)})
        self.queue.put({'_eof': True})

    def _stderr(self):
        for line in self.proc.stderr:
            self.stderr_bytes += len(line)

    def alias(self, value, mapping, prefix):
        if value not in mapping:
            mapping[value] = f'{prefix}-{len(mapping)+1}'
        return mapping[value]

    def send(self, data):
        self.proc.stdin.write(json.dumps(data)+'\n')
        self.proc.stdin.flush()

    def next(self, deadline):
        remaining = deadline-time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Native RPC/turn deadline exceeded')
        try:
            data = self.queue.get(timeout=remaining)
        except queue.Empty:
            raise TimeoutError('Native RPC/turn deadline exceeded')
        if data.get('_eof'):
            raise RuntimeError('Native app-server stream ended')
        if 'method' in data:
            method = data['method']
            self.raw_methods[method] += 1
            if 'id' in data:
                # No automatic approval/auth/tool delegation. Fail closed.
                self.events.append({'event': 'server_request_rejected', 'method': method})
                self.send({'id': data['id'], 'error': {'code': -32601, 'message': 'This bounded client does not support interactive requests'}})
            else:
                self.capture(method, data.get('params', {}))
        return data

    def capture(self, method, params):
        keep = {'thread/started', 'thread/status/changed', 'turn/started', 'turn/completed', 'item/started', 'item/completed', 'error', 'account/updated'}
        if method not in keep:
            return
        record = {'event': method}
        if params.get('threadId'):
            record['thread'] = self.alias(params['threadId'], self.threads, 'thread')
        if params.get('turnId'):
            record['turn'] = self.alias(params['turnId'], self.turns, 'turn')
        if method == 'thread/started':
            record['thread'] = self.alias(params['thread']['id'], self.threads, 'thread')
        if method == 'thread/status/changed':
            record['status'] = params.get('status')
        if method in ['turn/started', 'turn/completed']:
            turn = params['turn']
            record.update(turn=self.alias(turn['id'], self.turns, 'turn'), status=turn['status'])
            if turn.get('error'):
                record['error'] = clean_error(turn['error'].get('message', 'unspecified native error'))
        if method in ['item/started', 'item/completed']:
            item = params['item']
            record['itemType'] = item['type']
            for key in ['status', 'exitCode']:
                if key in item:
                    record[key] = item[key]
        if method == 'error':
            record['message'] = clean_error(params.get('error', {}).get('message', 'unspecified native error'))
        if method == 'account/updated':
            record['authMode'] = params.get('authMode')
        self.events.append(record)

    def response(self, method, params, timeout=60):
        self.serial += 1
        request_id = self.serial
        self.events.append({'event': 'request', 'method': method, 'request': request_id})
        self.send({'id': request_id, 'method': method, 'params': params})
        deadline = time.monotonic()+timeout
        while True:
            data = self.next(deadline)
            if data.get('id') == request_id and 'method' not in data:
                if 'error' in data:
                    error = data['error']
                    self.events.append({'event': 'rpc_error', 'method': method, 'code': error.get('code'), 'message': clean_error(error.get('message'))})
                    raise RuntimeError(f"{method}: {clean_error(error.get('message'))}")
                self.events.append({'event': 'response', 'method': method, 'request': request_id})
                return data['result']

    def account(self):
        response = self.response('account/read', {'refreshToken': False})
        account = response.get('account') or {}
        # Never persist or print account email, plan, ID, or other account data.
        return {'type': account.get('type'), 'requiresOpenaiAuth': response.get('requiresOpenaiAuth')}

    def start(self, cwd):
        requested = {'sandbox': 'workspace-write', 'approvalPolicy': 'never', 'ephemeral': True,
                     'cwd': str(cwd), 'runtimeWorkspaceRoots': [str(cwd)], 'selectedCapabilityRoots': [],
                     'config': {'sandbox_workspace_write.network_access': False,
                                'sandbox_workspace_write.exclude_slash_tmp': True,
                                'sandbox_workspace_write.exclude_tmpdir_env_var': True}}
        response = self.response('thread/start', requested)
        sandbox = response.get('sandbox', {})
        record = {'requested': {'sandbox': 'workspace-write', 'networkAccess': False, 'approvalPolicy': 'never', 'ephemeral': True, 'model': 'omitted', 'effort': 'omitted'},
                  'effective': {key: response.get(key) for key in ['model', 'modelProvider', 'reasoningEffort', 'approvalPolicy', 'sandbox', 'activePermissionProfile']},
                  'threadEphemeral': response['thread']['ephemeral'],
                  'nativeThreadAlias': self.alias(response['thread']['id'], self.threads, 'thread')}
        # Strip paths even from the permission summary.
        if 'writableRoots' in sandbox:
            record['effective']['sandbox'] = {**sandbox, 'writableRoots': ['<workspace>' if str(path)==str(cwd) else '<other-root>' for path in sandbox['writableRoots']]}
        self.events.append({'event': 'thread_settings', **record})
        if (sandbox.get('type') != 'workspaceWrite'
                or sandbox.get('networkAccess') is not False
                or sandbox.get('excludeTmpdirEnvVar') is not True
                or sandbox.get('excludeSlashTmp') is not True
                or any(str(path) != str(cwd) for path in sandbox.get('writableRoots', []))
                or response.get('approvalPolicy') != 'never'):
            raise RuntimeError('Effective native permissions are broader than requested; no write turn invoked')
        return response['thread']['id'], record

    def turn(self, thread_id, prompt, timeout=300):
        response = self.response('turn/start', {'threadId': thread_id, 'input': [{'type': 'text', 'text': prompt}]})
        turn_id = response['turn']['id']
        deadline = time.monotonic()+timeout
        while True:
            data = self.next(deadline)
            if data.get('method') == 'turn/completed' and data.get('params',{}).get('turn',{}).get('id') == turn_id:
                turn = data['params']['turn']
                return {'status': turn['status'], 'error': clean_error(turn['error'].get('message')) if turn.get('error') else None}

    def close(self):
        # End only the new process group owned by this probe. This is local process
        # evidence, not a universal stopped-writer or downstream-effect guarantee.
        forced = False
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=8)
        except (subprocess.TimeoutExpired, BrokenPipeError):
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait(timeout=5)
                forced = True
        self.events.append({'event': 'probe_owned_process_exit', 'returnCode': self.proc.returncode, 'forcedKill': forced,
                            'stderrBytesDiscarded': self.stderr_bytes, 'notificationCounts': dict(self.raw_methods)})
        self.trace.write_text('\n'.join(json.dumps(event, sort_keys=True) for event in self.events)+'\n')
