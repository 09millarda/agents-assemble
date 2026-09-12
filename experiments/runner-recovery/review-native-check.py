#!/usr/bin/env python3
"""Independent archive and retained-workspace check; no harness/model invocation."""
import ast
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NATIVE = ROOT / 'native'
OUT = NATIVE / 'results'
checks = []


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args, cwd=None):
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True)


def git(cwd, *args):
    result = run(['git', *args], cwd)
    if result.returncode:
        raise AssertionError('git command failed: ' + ' '.join(args))
    return result.stdout.strip()


results = json.loads((OUT / 'results.json').read_text())
manifest = json.loads((OUT / 'recovery-manifest.json').read_text())
check('native recorded completed initial turn', results['initialTurn']['status'] == 'completed')
check('native recorded completed recovery turn', results['recoveryTurn']['status'] == 'completed')
check('native recorded different thread identities', results['differentNativeThread'] is True)
check('existing native ChatGPT account reported', results['account']['type'] == 'chatgpt')
check('archive manifest exact recorded hash', digest(OUT / 'recovery-manifest.json') == results['artifactSha256'])
check('archive bundle exact manifest hash', digest(OUT / 'checkpoint.bundle') == manifest['gitBundleSha256'])
check('baseline and checkpoint distinct', manifest['originalFailingBaselineCommit'] != manifest['workingCheckpointCommit'])

# Extract only a Python string literal; do not execute the probe module.
syntax = ast.parse((NATIVE / 'probe.py').read_text())
recovery_literals = [node.value for node in ast.walk(syntax)
                     if isinstance(node, ast.Constant) and isinstance(node.value, str)
                     and 'class RecoveryTest(unittest.TestCase):' in node.value]
check('exact original recovery-test literal identified', len(recovery_literals) == 1)
expected_recovery_test = recovery_literals[0]

with tempfile.TemporaryDirectory(prefix='aa-independent-native-') as temp:
    clone = Path(temp) / 'clone'
    result = run(['git', 'clone', '--quiet', str(OUT / 'checkpoint.bundle'), str(clone)])
    check('consumer cloned archived self-contained bundle', result.returncode == 0)
    check('consumer has no Git object alternates', not (clone / '.git/objects/info/alternates').exists())
    git(clone, 'checkout', '--quiet', '--detach', manifest['originalFailingBaselineCommit'])
    check('baseline arithmetic contains the original defect', (clone / 'arithmetic.py').read_text() == 'def add(a, b):\n    return a - b\n')
    failed = run(['python3', '-B', '-m', 'unittest', 'test_arithmetic.py'], clone)
    check('baseline really fails both signed addition cases', failed.returncode != 0 and 'failures=2' in failed.stderr)
    git(clone, 'checkout', '--quiet', '--detach', manifest['workingCheckpointCommit'])
    for name, expected in manifest['fileSha256'].items():
        check('archived checkpoint content hash: ' + name, digest(clone / name) == expected)
    check('baseline is an ancestor of recovered checkpoint', run(['git', 'merge-base', '--is-ancestor', manifest['originalFailingBaselineCommit'], manifest['workingCheckpointCommit']], clone).returncode == 0)
    passed = run(['python3', '-B', '-m', 'unittest', 'test_arithmetic.py'], clone)
    check('archived checkpoint passes original three tests', passed.returncode == 0 and 'Ran 3 tests' in passed.stderr)
    result = run(['git', 'apply', str(OUT / 'recovery-change.diff')], clone)
    check('archived recovery diff applies to exact checkpoint', result.returncode == 0)
    (clone / 'test_recovery.py').write_text(expected_recovery_test)
    passed = run(['python3', '-B', '-m', 'unittest', 'test_arithmetic.py', 'test_recovery.py'], clone)
    check('independent archive reconstruction passes seven original tests', passed.returncode == 0 and 'Ran 7 tests' in passed.stderr)
    check('recovery diff changes only arithmetic.py', git(clone, 'diff', '--name-only') == 'arithmetic.py')
    check('original tests preserved in archive reconstruction', digest(clone / 'test_arithmetic.py') == manifest['fileSha256']['test_arithmetic.py'])

live = Path(results['workDirectory']) / 'recovered'
live_audit = {'available': live.exists()}
if live.exists():
    check('retained live recovery tests exactly equal original fixture literal', (live / 'test_recovery.py').read_text() == expected_recovery_test)
    check('retained live original tests match pinned manifest hash', digest(live / 'test_arithmetic.py') == manifest['fileSha256']['test_arithmetic.py'])
    check('retained live manifest matches original recorded hash', digest(live / 'recovery-manifest.json') == results['artifactSha256'])
    check('retained live tracked change set only arithmetic.py', git(live, 'diff', '--name-only') == 'arithmetic.py')
    check('retained live untracked set only declared manifest and tests', set(git(live, 'ls-files', '--others', '--exclude-standard').splitlines()) == {'recovery-manifest.json', 'test_recovery.py'})
    live_audit['recoveryTestSha256'] = digest(live / 'test_recovery.py')

report = {'status': 'passed', 'assertions': len(checks), 'checks': checks, 'retainedWorkspaceAudit': live_audit,
          'scope': 'Independent archive reconstruction and post-run fixture-integrity audit; no new native inference, no cross-machine or service-admission claim.'}
(ROOT / 'review-native-check-results.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'assertions': report['assertions'], 'retainedWorkspaceAudit': live_audit}))
