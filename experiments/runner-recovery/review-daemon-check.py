#!/usr/bin/env python3
"""Independent adversarial scope/replay checks; fixture inputs, no real inference."""
import copy
import hashlib
import importlib.util
import json
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'daemon/probe.py'
spec = importlib.util.spec_from_file_location('reviewed_daemon', SOURCE)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
checks, observations = [], {}


def check(label, condition):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def final_digest(command):
    command['payload_digest'] = p.command_digest(command)
    return command


with tempfile.TemporaryDirectory(prefix='aa-independent-daemon-') as temp:
    work = Path(temp)
    case, service, command, incarnation = p.make_case(work, 'result-replay', expires=1)
    try:
        original = {'result_id': 'review-result-1', 'command': command, 'checkpoint': {'fixture': 'trusted-result'}}
        first = service.handle('/result', original)
        check('original result admitted before deadline', first['verdict'] == 'accepted')
        time.sleep(max(0, command['grant']['expires_at'] - time.time()) + 0.02)
        expired_replay = service.handle('/result', original)
        check('accepted exact result replay survives expiry', expired_replay['verdict'] == 'accepted' and expired_replay['duplicate'])
        service.change(generation=2, current_attempt='review-replacement')
        replaced_replay = service.handle('/result', original)
        check('accepted exact result replay survives replacement generation', replaced_replay['verdict'] == 'accepted' and replaced_replay['duplicate'])
        fresh_id = copy.deepcopy(original)
        fresh_id['result_id'] = 'review-result-2'
        stale = service.handle('/result', fresh_id)
        check('new result identity cannot advance replacement from stale grant', stale['verdict'] == 'stale_generation_or_attempt')
        changed = copy.deepcopy(original)
        changed['checkpoint'] = {'fixture': 'changed-result'}
        conflict = service.handle('/result', changed)
        check('accepted result identity cannot change payload after replacement', conflict['verdict'] == 'result_payload_conflict')
        check('result replay did not change replacement state', p.snapshot(case/'service.sqlite')['state'][0]['generation'] == 2)
        observations['resultReplay'] = {'first': first, 'expired': expired_replay, 'replaced': replaced_replay, 'newStaleIdentity': stale, 'changedPayload': conflict}
    finally:
        service.close()

    case, service, command, incarnation = p.make_case(work, 'admission-scope')
    try:
        repo = case/'repo'
        (repo/'safe.txt').write_text('status=RECOVERED\nindependent verified fixture checkpoint\n')
        p.git(repo, 'add', 'safe.txt')
        p.git(repo, 'commit', '-qm', 'independent recovery checkpoint')
        record = p.checkpoint(repo, command)
        verified = p.verify_checkpoint(repo, record, command['payload'], case/'consumer-clone')
        check('recovery consumer clone has no Git object alternates', not (case/'consumer-clone/.git/objects/info/alternates').exists())
        service.change(stopped=1)  # Trusted no-child-started fixture precondition, not stop provenance evidence.
        recovery = copy.deepcopy(command)
        recovery.update(attempt='review-attempt-2', generation=2, command='review-wrong-class')
        recovery['payload']['reconstruction'] = record
        recovery['grant'] = {'id': 'review-grant-2', 'class': 'initial', 'expires_at': time.time()+120}
        final_digest(recovery)
        wrong_class = service.admit_recovery(recovery, verified)
        check('wrong recovery class rejected', not wrong_class['accepted'] and wrong_class['reason'] == 'wrong_recovery_class')
        recovery['grant']['class'] = 'verified_reconstruction'
        final_digest(recovery)
        repaired_identity = service.admit_recovery(recovery, verified)
        check('rejected admission identity cannot be repaired in place', not repaired_identity['accepted'] and repaired_identity['reason'] == 'admission_payload_conflict')
        recovery['command'] = 'review-no-verification'
        final_digest(recovery)
        absent = service.admit_recovery(recovery, None)
        later_verified = service.admit_recovery(recovery, verified)
        check('verification absence rejected', not absent['accepted'] and absent['reason'] == 'checkpoint_not_verified')
        check('later evidence cannot change prior admission verdict under same identity', not later_verified['accepted'] and later_verified['reason'] == 'checkpoint_not_verified' and later_verified['duplicate'])
        mismatch = copy.deepcopy(recovery)
        mismatch['command'] = 'review-mismatched-checkpoint'
        mismatch['payload']['reconstruction']['checkpoint'] = command['payload']['baseline']
        final_digest(mismatch)
        bad_checkpoint = service.admit_recovery(mismatch, verified)
        check('valid verification cannot authorize different checkpoint', not bad_checkpoint['accepted'] and bad_checkpoint['reason'] == 'verification_scope_mismatch')
        mismatch = copy.deepcopy(recovery)
        mismatch['command'] = 'review-mismatched-input'
        mismatch['payload']['pinned_input']['spec_revision'] = 'unreviewed-v2'
        final_digest(mismatch)
        bad_input = service.admit_recovery(mismatch, verified)
        check('valid verification cannot authorize different input scope', not bad_input['accepted'] and bad_input['reason'] == 'verification_scope_mismatch')
        mismatch = copy.deepcopy(recovery)
        mismatch['command'] = 'review-inconsistent-payload-digest'
        mismatch['payload_digest'] = '0'*64
        bad_digest = service.admit_recovery(mismatch, verified)
        check('self-inconsistent admission digest is rejected', not bad_digest['accepted'])
        check('all rejected admission attempts consumed no allowance', p.snapshot(case/'service.sqlite')['state'][0]['consumed'] == 1)
        recovery['command'] = 'review-valid-new-admission'
        final_digest(recovery)
        admitted = service.admit_recovery(recovery, verified)
        duplicate = service.admit_recovery(recovery, verified)
        check('fresh valid recovery admitted', admitted['accepted'])
        check('exact recovery replay returns committed admission', duplicate['accepted'] and duplicate['duplicate'])
        check('recovery replay charges once', p.snapshot(case/'service.sqlite')['state'][0]['consumed'] == 2)
        observations['recoveryAdmission'] = {'wrongClass': wrong_class, 'sameIdentityRepair': repaired_identity, 'verificationAbsent': absent, 'laterVerification': later_verified, 'differentCheckpoint': bad_checkpoint, 'differentInput': bad_input, 'badDigest': bad_digest, 'valid': admitted, 'duplicate': duplicate}
    finally:
        service.close()

    case, service, command, incarnation = p.make_case(work, 'stop-scope')
    try:
        # Identity/correlation test only: no actual process is signalled and this
        # synthetic trusted report establishes no pidfd or provenance guarantee.
        registration = service.handle('/process_started', {'command': command, 'process_instance': 'review-instance-1', 'pid': 424242})
        check('fixture process binding registered', registration['accepted'])
        ack = {'generation': command['generation'], 'attempt': command['attempt'], 'incarnation': incarnation, 'command': command,
               'proof': {'terminated': True, 'method': 'linux_pidfd_exit', 'process_instance': 'review-instance-1', 'pid': 424242}}
        wrong_instance = copy.deepcopy(ack)
        wrong_instance['proof']['process_instance'] = 'unregistered-instance'
        rejected_instance = service.handle('/stop_ack', wrong_instance)
        check('current generation rejects wrong process instance', not rejected_instance['accepted'])
        wrong_pid = copy.deepcopy(ack)
        wrong_pid['proof']['pid'] = 424243
        rejected_pid = service.handle('/stop_ack', wrong_pid)
        check('current generation rejects wrong process PID', not rejected_pid['accepted'])
        accepted = service.handle('/stop_ack', ack)
        check('matching trusted stop report accepted only in fixture scope', accepted['accepted'] and accepted['external_effects_accounted'] is False)
        service.change(generation=2, current_attempt='review-replacement', stopped=0)
        stale = service.handle('/stop_ack', ack)
        check('old assignment stop report rejects after replacement', not stale['accepted'])
        forged = copy.deepcopy(ack)
        forged.update(generation=2, attempt='review-replacement')
        forged_verdict = service.handle('/stop_ack', forged)
        check('current-looking envelope cannot relabel old command/process binding', not forged_verdict['accepted'])
        check('stale and relabeled stop did not mark replacement stopped', p.snapshot(case/'service.sqlite')['state'][0]['stopped'] == 0)
        observations['stopScope'] = {'wrongInstance': rejected_instance, 'wrongPid': rejected_pid, 'trustedMatching': accepted, 'stale': stale, 'currentLookingOldBinding': forged_verdict}
    finally:
        service.close()

report = {'status': 'passed', 'assertions': len(checks), 'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'checks': checks, 'observations': observations,
          'scope': 'Independent fixture scope/replay tests plus real Git consumer clone. Synthetic result, admission, and process reports are trusted inputs; no inference, native stop, transport authentication, or actual provider provenance is established.'}
(ROOT/'review-daemon-check-results.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'status': report['status'], 'assertions': report['assertions'], 'source_sha256': report['source_sha256']}))
