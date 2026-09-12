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
    def __init__(self, trace, cwd):
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
            ['codex', 'app-server', '--stdio'], cwd=cwd, env=child_env,
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


def test(repo, filename='test_arithmetic.py'):
    result = run(['python3', '-B', '-m', 'unittest', filename], repo, check=False)
    return {'exitCode': result.returncode, 'output': result.stdout.replace(str(repo), '<workspace>')}


def create_fixture(work):
    repo = work / 'original'
    repo.mkdir()
    git(repo, 'init', '-q')
    git(repo, 'config', 'user.name', 'Disposable Probe')
    git(repo, 'config', 'user.email', 'probe@example.invalid')
    (repo/'arithmetic.py').write_text('def add(a, b):\n    return a - b\n')
    (repo/'test_arithmetic.py').write_text('''import unittest
from arithmetic import add

class ArithmeticTest(unittest.TestCase):
    def test_positive(self):
        self.assertEqual(add(2, 3), 5)
    def test_negative(self):
        self.assertEqual(add(-2, -3), -5)
    def test_zero(self):
        self.assertEqual(add(7, 0), 7)
''')
    git(repo, 'add', 'arithmetic.py', 'test_arithmetic.py')
    git(repo, 'commit', '-qm', 'fixture: original failing baseline')
    git(repo, 'tag', 'original-failing-baseline')
    return repo


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--account-only', action='store_true')
    parser.add_argument('--output', default=str(ROOT/'results'))
    options = parser.parse_args()
    output = Path(options.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='aa-native-recovery-'))
    results = {'date': time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()), 'version': run(['codex','--version']).stdout.strip(),
               'platform': platform.system()+' '+platform.machine(), 'interface': 'app-server stdio JSON-RPC',
               'identity': 'same existing OS user; provider API key and host session environment excluded',
               'workDirectory': str(work), 'status': 'started'}
    client = None
    try:
        repo = create_fixture(work)
        results['baselineCommit'] = git(repo,'rev-parse','HEAD')
        results['baselineTest'] = test(repo)
        assert results['baselineTest']['exitCode'] != 0
        client = Client(output/'initial-events.jsonl', repo)
        results['passedEnvironmentNames'] = client.env_names
        results['account'] = client.account()
        if results['account']['type'] != 'chatgpt':
            raise RuntimeError('Native ChatGPT managed-account mode unavailable; no compatibility turn invoked')
        thread, results['initialSettings'] = client.start(repo)
        if options.account_only:
            results['status'] = 'account_and_settings_only'
            return
        prompt = ('This is an authorized disposable local arithmetic test. Use only local shell/file tools within this workspace. '
                  'Do not inspect credentials, environment variables, other folders, plugins or external services. Do not use web/network, spawn agents, commit, or push. '
                  'Run python3 -B -m unittest test_arithmetic.py to observe the baseline failure. Fix only arithmetic.py so add(a,b) implements addition. '
                  'Preserve all tests. Run that same test command and finish with one sentence describing the fix and test result.')
        results['initialTurn'] = client.turn(thread,prompt)
        assert results['initialTurn']['status'] == 'completed', results['initialTurn']
        client.close(); client = None
        results['fixedTest'] = test(repo)
        assert results['fixedTest']['exitCode'] == 0
        assert git(repo, 'diff', '--name-only') == 'arithmetic.py'
        git(repo,'add','arithmetic.py')
        git(repo,'commit','-qm','fixture: verified working checkpoint')
        git(repo,'tag','verified-working-checkpoint')
        results['checkpointCommit'] = git(repo,'rev-parse','HEAD')
        assert results['checkpointCommit'] != results['baselineCommit']
        bundle = work/'checkpoint.bundle'
        git(repo,'bundle','create',str(bundle),'refs/tags/original-failing-baseline','refs/tags/verified-working-checkpoint')
        results['bundleVerify'] = git(repo,'bundle','verify',str(bundle))
        manifest = {'schema': 'native-recovery-fixture/v1', 'repositoryIdentity': 'disposable-arithmetic-fixture',
                    'originalFailingBaselineCommit': results['baselineCommit'], 'workingCheckpointCommit': results['checkpointCommit'],
                    'gitBundleSha256': sha(bundle.read_bytes()),
                    'fileSha256': {name: sha((repo/name).read_bytes()) for name in ['arithmetic.py','test_arithmetic.py']},
                    'acceptedDecision': 'add(a,b) means arithmetic addition; original defect fixed and all three original tests pass.',
                    'recoveryClass': 'fresh-session-from-verified-git-and-artifacts', 'invocationGrant': 'fixture-new-bounded-grant-2',
                    'nextWork': 'Add sum_many(values) in arithmetic.py using the recovered add implementation. Accept any iterable, return 0 when empty. Preserve existing add behavior and original tests. Run both unittest files.'}
        artifact = work/'recovery-manifest.json'
        artifact.write_text(json.dumps(manifest,indent=2)+'\n')
        results['artifactSha256'] = sha(artifact.read_bytes())
        recovered = work/'recovered'
        run(['git','clone','-q',str(bundle),str(recovered)])
        git(recovered,'checkout','-q','--detach',results['checkpointCommit'])
        assert git(recovered,'rev-parse','HEAD') == manifest['workingCheckpointCommit']
        git(recovered,'cat-file','-e',manifest['originalFailingBaselineCommit']+'^{commit}')
        assert git(recovered,'status','--porcelain') == ''
        for name, expected in manifest['fileSha256'].items():
            assert sha((recovered/name).read_bytes()) == expected
        assert sha(bundle.read_bytes()) == manifest['gitBundleSha256']
        shutil.copyfile(artifact,recovered/'recovery-manifest.json')
        assert sha((recovered/'recovery-manifest.json').read_bytes()) == results['artifactSha256']
        (recovered/'test_recovery.py').write_text('''import unittest
from arithmetic import add, sum_many

class RecoveryTest(unittest.TestCase):
    def test_preserves_recovered_add(self):
        self.assertEqual(add(2, 3), 5)
    def test_many(self):
        self.assertEqual(sum_many([1, 2, 3]), 6)
    def test_empty(self):
        self.assertEqual(sum_many([]), 0)
    def test_generator(self):
        self.assertEqual(sum_many(x for x in [-2, 5, 7]), 10)
''')
        results['testFileHashesBeforeRecovery'] = {name: sha((recovered/name).read_bytes()) for name in ['test_arithmetic.py', 'test_recovery.py']}
        results['recoveryBaselineTest'] = test(recovered,'test_recovery.py')
        assert results['recoveryBaselineTest']['exitCode'] != 0
        results['verification'] = {'pinnedCommitMatches': True, 'originalBaselineReachable': True, 'bundleHashMatches':True, 'artifactHashMatches':True, 'fileContentHashesMatch':True, 'noNativeTranscriptCopied':True}
        client = Client(output/'recovery-events.jsonl',recovered)
        assert client.account()['type'] == 'chatgpt'
        fresh,results['recoverySettings'] = client.start(recovered)
        results['differentNativeThread'] = fresh != thread
        assert results['differentNativeThread']
        prompt = ('You are a fresh native session recovering authorized disposable local work, with no previous conversation supplied. '
                  'Use only local shell/file tools in this workspace. Do not inspect credentials, environment variables, other folders, plugins or external services. '
                  'Do not use web/network, spawn agents, commit or push. Read recovery-manifest.json and verify git rev-parse HEAD equals its workingCheckpointCommit. '
                  'The supplied manifest SHA256 is '+results['artifactSha256']+'. Verify it with sha256sum. '
                  'Check baseline/checkpoint are different. Read the recovered code and tests, implement exactly nextWork, changing only arithmetic.py and preserving every supplied test and artifact. '
                  'Run python3 -B -m unittest test_arithmetic.py test_recovery.py. End with one sentence describing the recovery and test result.')
        results['recoveryTurn'] = client.turn(fresh,prompt)
        assert results['recoveryTurn']['status'] == 'completed', results['recoveryTurn']
        client.close(); client = None
        completed = run(['python3','-B','-m','unittest','test_arithmetic.py','test_recovery.py'],recovered,check=False)
        results['recoveryTest'] = {'exitCode':completed.returncode, 'output':completed.stdout.replace(str(recovered),'<workspace>')}
        assert completed.returncode == 0
        results['testFileHashesAfterRecovery'] = {name: sha((recovered/name).read_bytes()) for name in ['test_arithmetic.py', 'test_recovery.py']}
        assert results['testFileHashesBeforeRecovery'] == results['testFileHashesAfterRecovery']
        assert git(recovered, 'ls-files', '--others', '--exclude-standard').splitlines() == ['recovery-manifest.json', 'test_recovery.py']
        assert git(recovered,'diff','--name-only') == 'arithmetic.py'
        assert sha((recovered/'recovery-manifest.json').read_bytes()) == results['artifactSha256']
        shutil.copyfile(bundle,output/'checkpoint.bundle')
        shutil.copyfile(artifact,output/'recovery-manifest.json')
        (output/'initial-fix.diff').write_text(git(repo,'diff',results['baselineCommit'],results['checkpointCommit'])+'\n')
        (output/'recovery-change.diff').write_text(git(recovered,'diff')+'\n')
        results['status'] = 'passed'
        results['nativeResume'] = 'not attempted; ephemeral sessions intentionally exclude transcript persistence/export'
    except Exception as error:
        results['status'] = 'blocked'
        results['error'] = clean_error(str(error))
    finally:
        if client:
            client.close()
        (output/'results.json').write_text(json.dumps(results,indent=2)+'\n')
        print(json.dumps({'status':results['status'],'account':results.get('account'),'version':results['version'], 'output':str(output), 'error':results.get('error')},indent=2))
    if results['status'] == 'blocked':
        sys.exit(1)

if __name__ == '__main__':
    main()
