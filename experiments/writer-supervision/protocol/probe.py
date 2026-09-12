#!/usr/bin/env python3
"""THROWAWAY #9 protocol model. SQLite durability is real; OS/trust/checkpoint evidence is modeled."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import copy
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time

PROFILE = "trusted-fixture-complete-scope-v1"
SERVICE = "execution-fixture"
RUNNER = "enrolled-runner-fixture"
ARTIFACT = b"immutable reconstruction context\n"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def connect(path):
    db = sqlite3.connect(path, isolation_level=None, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    return db


@contextmanager
def transaction(db):
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        db.execute("ROLLBACK")
        raise
    else:
        db.execute("COMMIT")


def barrier(directory, phase, enabled):
    if enabled != phase:
        return
    marker = Path(directory) / "barrier.json"
    with marker.open("w") as stream:
        json.dump({"phase": phase, "pid": os.getpid()}, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.kill(os.getpid(), signal.SIGSTOP)


def binding(generation=1):
    token = str(generation)
    return {
        "deployment": "deployment-A", "organization": "org-A",
        "enrollment": "enrollment-A", "runner": "runner-A", "journal_incarnation": "journal-A",
        "run": "run-A", "occurrence": "occurrence-A", "attempt": "attempt-" + token,
        "invocation": "invocation-" + token, "assignment": "assignment-" + token,
        "generation": generation, "admission": "admission-" + token,
        "input_digest": digest({"input": "pinned-A"}), "operation_digest": digest({"operation": "repair-A"}),
        "writer_obligation": "writer-" + token, "scope_id": "never-reused-scope-" + token,
        "profile": PROFILE, "host_id": "host-A", "boot_id": "boot-A",
        "supervisor_authority": "fixture-supervisor-A", "supervisor_instance": "manager-A",
        "supervisor_launch_id": "launch-" + token, "scope_object_id": "object-" + token,
        "native_session": "session-" + token, "native_turn": "turn-" + token,
    }


def occurrence_key(target):
    return canonical([target[key] for key in ("deployment", "organization", "run", "occurrence")])


def manifest(target):
    return {"repository": "registered-repository-A", "original_baseline": "baseline-commit-A",
            "checkpoint_commit": "recovered-commit-B", "checkpoint_tree": "recovered-tree-B",
            "input_digest": target["input_digest"], "source_binding_digest": digest(target),
            "artifact_sha256": hashlib.sha256(ARTIFACT).hexdigest(),
            "environment_ref": "environment-A", "outstanding_effects": ["effect-A"]}


class Journal:
    def __init__(self, path):
        self.db = connect(path)
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS objects(kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id));
          CREATE TABLE IF NOT EXISTS inbox(operation TEXT, id TEXT, payload_digest TEXT, verdict TEXT,
                                         PRIMARY KEY(operation,id));
        """)

    def get(self, kind, key):
        row = self.db.execute("SELECT body FROM objects WHERE kind=? AND id=?", (kind, key)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, kind, key, value):
        self.db.execute("INSERT INTO objects VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
                        (kind, key, canonical(value)))

    def all(self, kind):
        return {r[0]: json.loads(r[1]) for r in self.db.execute("SELECT id,body FROM objects WHERE kind=? ORDER BY id", (kind,))}

    def replay(self, operation, key, payload):
        row = self.db.execute("SELECT payload_digest,verdict FROM inbox WHERE operation=? AND id=?", (operation, key)).fetchone()
        if row is None:
            return None
        return json.loads(row[1]) if row[0] == digest(payload) else {"accepted": False, "reason": "identity_payload_conflict"}

    def record(self, operation, key, payload, verdict):
        self.db.execute("INSERT INTO inbox VALUES(?,?,?,?)", (operation, key, digest(payload), canonical(verdict)))
        return verdict

    def snapshot(self):
        return {"objects": [dict(r) | {"body": json.loads(r["body"])} for r in self.db.execute("SELECT * FROM objects ORDER BY kind,id")],
                "inbox": [dict(r) | {"verdict": json.loads(r["verdict"])} for r in self.db.execute("SELECT * FROM inbox ORDER BY operation,id")]}


class Service(Journal):
    def seed(self, target):
        with transaction(self.db):
            self.put("registry", RUNNER, {"trusted": True, "profiles": [PROFILE], "enrollment": target["enrollment"],
                                         "runner": target["runner"], "journal_incarnation": target["journal_incarnation"]})
            self.put("writer", target["writer_obligation"], {"binding": target, "issuer": RUNNER, "state": "active"})
            self.put("run", target["run"], {"generation": 1, "charged": 1, "limit": 3})
            self.put("occurrence", occurrence_key(target), {"generation": target["generation"], "current_writer": target["writer_obligation"]})
            self.put("effect", "effect-A", {"writer": target["writer_obligation"], "state": "unknown"})
            self.put("policy", target["writer_obligation"], {"manifest": manifest(target), "recovery_classes": ["verified_reconstruction"]})
            self.put("scope", target["scope_id"], {"writer": target["writer_obligation"]})

    def request_stop(self, target, request_id="stop-1"):
        value = {"id": request_id, "issuer": SERVICE, "operation": "stop_writer", "target": target,
                 "target_digest": digest(target), "reason": "recovery", "grace_ms": 100, "force_ms": 100}
        with transaction(self.db):
            old = self.get("request", request_id)
            if old is not None and old != value:
                raise ValueError("stop request identity conflict")
            self.put("request", request_id, value)
        return value

    def receive(self, receipt, principal=RUNNER):
        # Principal is trusted test transport metadata, deliberately distinct from payload issuer.
        # Partitioning the inbox by authenticated principal prevents unauthenticated pre-play poisoning.
        operation = "stop_receipt:" + principal
        with transaction(self.db):
            prior = self.replay(operation, receipt["id"], receipt)
            if prior is not None:
                return prior
            reason = self.receipt_problem(receipt, principal)
            verdict = {"accepted": reason is None, "reason": reason or "local_writer_accounted",
                       "writer": receipt["target"]["writer_obligation"]}
            if reason is None:
                writer = self.get("writer", receipt["target"]["writer_obligation"])
                writer["state"] = "stopped"
                writer["receipt_id"] = receipt["id"]
                self.put("writer", receipt["target"]["writer_obligation"], writer)
            return self.record(operation, receipt["id"], receipt, verdict)

    def receipt_problem(self, receipt, principal):
        target = receipt["target"]
        writer = self.get("writer", target["writer_obligation"])
        registry = self.get("registry", principal)
        if not writer or principal != receipt["issuer"] or principal != writer["issuer"] or not registry or not registry["trusted"]:
            return "untrusted_issuer"
        if target != writer["binding"] or receipt["target_digest"] != digest(target):
            return "target_identity_mismatch"
        if any(registry[key] != target[key] for key in ("enrollment", "runner", "journal_incarnation")):
            return "issuer_binding_mismatch"
        if target["profile"] not in registry["profiles"]:
            return "unsupported_capability_profile"
        request = self.get("request", receipt["request_id"])
        if not request or receipt["request_digest"] != digest(request) or request["target"] != target:
            return "request_scope_mismatch"
        evidence = receipt["evidence"]
        if evidence["binding_digest"] != digest(target) or not evidence["stop_gate"]:
            return "observation_binding_or_gate_missing"
        if evidence["scope_identity"] != {key: target[key] for key in Supervisor.IDENTITY_KEYS}:
            return "observation_instance_mismatch"
        if receipt["outcome"] not in ("scope_stopped", "never_started"):
            return "writer_scope_unresolved"
        if not evidence["scope_complete"] or not evidence["no_restart"] or evidence["writers"] != 0:
            return "incomplete_terminal_scope"
        if receipt["outcome"] == "never_started" and evidence["launch_stage"] != "admitted":
            return "launch_uncertainty"
        return None

    def verify_checkpoint(self, candidate, artifact):
        # Controlled verifier fixture: exact allowed manifest and actual artifact bytes, no real Git/provider.
        old = self.get("writer", "writer-1")["binding"]
        allowed = self.get("policy", "writer-1")["manifest"]
        if candidate != allowed or candidate["source_binding_digest"] != digest(old):
            return False
        if hashlib.sha256(artifact).hexdigest() != candidate["artifact_sha256"]:
            return False
        with transaction(self.db):
            self.put("checkpoint", digest(candidate), {"manifest": candidate, "verifier": "controlled-artifact-fixture"})
        return True

    def admit(self, command, now=100):
        with transaction(self.db):
            prior = self.replay("recovery_admission", command["id"], command)
            if prior is not None:
                return prior
            target = command["target"]
            old = self.get("writer", command["predecessor"])
            state = self.get("run", target["run"])
            policy = self.get("policy", command["predecessor"])
            checkpoint = self.get("checkpoint", command["manifest_digest"])
            registry = self.get("registry", RUNNER)
            occurrence = self.get("occurrence", occurrence_key(old["binding"])) if old else None
            related_writers = {key: writer for key, writer in self.all("writer").items()
                               if old and occurrence_key(writer["binding"]) == occurrence_key(old["binding"])}
            reason = None
            if old is None or old["state"] != "stopped":
                reason = "old_writer_unresolved"
            elif occurrence_key(target) != occurrence_key(old["binding"]):
                reason = "recovery_input_scope_mismatch"
            elif not occurrence or occurrence["current_writer"] != command["predecessor"] or occurrence["generation"] != old["binding"]["generation"]:
                reason = "stale_predecessor"
            elif any(writer["state"] != "stopped" for writer in related_writers.values()):
                reason = "additional_writer_unresolved"
            elif any(e["state"] != "accounted" for e in self.all("effect").values() if e["writer"] in related_writers):
                reason = "external_effect_unresolved"
            elif not registry or not registry["trusted"] or target["profile"] not in registry["profiles"] or any(registry[key] != target[key] for key in ("enrollment", "runner", "journal_incarnation")):
                reason = "replacement_runner_ineligible"
            elif not policy or not checkpoint or command["manifest_digest"] != digest(command["manifest"]) or checkpoint["manifest"] != command["manifest"] or policy["manifest"] != command["manifest"]:
                reason = "exact_checkpoint_not_verified"
            elif command["recovery_class"] not in policy["recovery_classes"]:
                reason = "unsupported_recovery_class"
            elif target["input_digest"] != old["binding"]["input_digest"] or target["operation_digest"] != old["binding"]["operation_digest"]:
                reason = "recovery_input_scope_mismatch"
            elif command["grant_expiry"] <= now:
                reason = "grant_expired"
            elif target["generation"] != occurrence["generation"] + 1:
                reason = "generation_mismatch"
            elif state["charged"] >= state["limit"]:
                reason = "allowance_exhausted"
            elif self.get("writer", target["writer_obligation"]) or self.get("scope", target["scope_id"]) or any(w["binding"]["invocation"] == target["invocation"] or w["binding"]["attempt"] == target["attempt"] or w["binding"]["admission"] == target["admission"] for w in self.all("writer").values()):
                reason = "reused_invocation_or_scope"
            verdict = {"accepted": reason is None, "reason": reason or "fresh_bounded_admission", "invocation": target["invocation"]}
            if reason is None:
                state["charged"] += 1
                state["generation"] = max(state["generation"], target["generation"])
                self.put("run", target["run"], state)
                self.put("occurrence", occurrence_key(target), {"generation": target["generation"], "current_writer": target["writer_obligation"]})
                self.put("writer", target["writer_obligation"], {"binding": target, "issuer": RUNNER, "state": "active"})
                self.put("scope", target["scope_id"], {"writer": target["writer_obligation"]})
            return self.record("recovery_admission", command["id"], command, verdict)


class Supervisor(Journal):
    IDENTITY_KEYS = ("scope_id", "host_id", "boot_id", "supervisor_authority", "supervisor_instance", "supervisor_launch_id", "scope_object_id")

    def seed(self, target):
        with transaction(self.db):
            self.put("scope", target["scope_id"], {"binding_digest": digest(target), "scope_identity": {k: target[k] for k in self.IDENTITY_KEYS},
                     "scope_complete": True, "no_restart": False, "writers": 2, "can_stop": True})

    def stop(self, target):
        with transaction(self.db):
            scope = self.get("scope", target["scope_id"])
            if scope and scope["binding_digest"] == digest(target) and scope["scope_identity"] == {k: target[k] for k in self.IDENTITY_KEYS} and scope["can_stop"]:
                scope["writers"] = 0
                scope["no_restart"] = True
                self.put("scope", target["scope_id"], scope)
            return scope


class Daemon(Journal):
    def seed(self, target, stage="started"):
        with transaction(self.db):
            self.put("metadata", "journal", {"incarnation": target["journal_incarnation"]})
            self.put("invocation", target["invocation"], {"binding": target, "launch_stage": stage, "stop_gate": False})

    def request(self, request, principal=SERVICE, death=None, directory=None):
        operation = "stop_request:" + principal
        with transaction(self.db):
            prior = self.replay(operation, request["id"], request)
            if prior is not None:
                return prior
            target = request["target"]
            invocation = self.get("invocation", target["invocation"])
            metadata = self.get("metadata", "journal")
            reason = None
            if principal != SERVICE or request["issuer"] != principal:
                reason = "untrusted_stop_issuer"
            elif not invocation or invocation["binding"] != target or request["target_digest"] != digest(target):
                reason = "target_identity_mismatch"
            elif not metadata or metadata["incarnation"] != target["journal_incarnation"]:
                reason = "journal_incarnation_mismatch"
            if reason is None:
                invocation["stop_gate"] = True
                self.put("invocation", target["invocation"], invocation)
                self.put("request", request["id"], request)
            verdict = self.record(operation, request["id"], request, {"accepted": reason is None, "reason": reason or "stop_gate_committed"})
            barrier(directory, "before_stop_commit", death)
        barrier(directory, "after_stop_commit", death)
        return verdict

    def launch(self, target):
        with transaction(self.db):
            invocation = self.get("invocation", target["invocation"])
            metadata = self.get("metadata", "journal")
            if not metadata or metadata["incarnation"] != target["journal_incarnation"]:
                return False
            if not invocation or invocation["binding"] != target or invocation["stop_gate"] or invocation["launch_stage"] != "admitted":
                return False
            invocation["launch_stage"] = "launch_intent"
            self.put("invocation", target["invocation"], invocation)
            return True

    def observe(self, request, supervisor, receipt_id="receipt-1", death=None, directory=None):
        # A receipt ID selects its first immutable observation; concurrent callers cannot overwrite it.
        with transaction(self.db):
            prior = self.get("receipt", receipt_id)
            if prior:
                if prior["request_id"] != request["id"] or prior["request_digest"] != digest(request) or prior["target"] != request["target"]:
                    raise ValueError("receipt identity bound to another stop request")
                return prior
            target = request["target"]
            invocation = self.get("invocation", target["invocation"])
            scope = supervisor.get("scope", target["scope_id"])
            metadata = self.get("metadata", "journal")
            if not metadata or metadata["incarnation"] != target["journal_incarnation"]:
                raise ValueError("journal incarnation cannot observe old scope")
            if invocation is None or self.get("request", request["id"]) != request:
                raise ValueError("no accepted exact local stop request")
            exact = scope is not None and scope["binding_digest"] == digest(target) and scope["scope_identity"] == {k: target[k] for k in Supervisor.IDENTITY_KEYS}
            evidence = copy.deepcopy(scope) if scope else {"binding_digest": "missing", "scope_identity": {}, "scope_complete": False, "no_restart": False, "writers": None}
            evidence.update({"stop_gate": invocation["stop_gate"], "launch_stage": invocation["launch_stage"]})
            if not exact:
                outcome = "scope_unknown"
            elif scope["writers"] != 0:
                outcome = "writers_remaining"
            elif not scope["scope_complete"] or not scope["no_restart"]:
                outcome = "known_processes_exited"
            else:
                outcome = "never_started" if invocation["launch_stage"] == "admitted" else "scope_stopped"
            receipt = {"id": receipt_id, "issuer": RUNNER, "request_id": request["id"], "request_digest": digest(request),
                       "target": target, "target_digest": digest(target), "outcome": outcome, "evidence": evidence,
                       "remote_effect_claim": "none", "evidence_origin": "controlled-supervisor-fixture"}
            self.put("receipt", receipt_id, receipt)
            self.put("outbox", receipt_id, {"acknowledged": False})
        barrier(directory, "after_receipt_commit", death)
        return receipt

    def deliver(self, receipt, service, death=None, directory=None):
        verdict = service.receive(receipt)
        barrier(directory, "after_service_accept_before_ack", death)
        with transaction(self.db):
            self.put("outbox", receipt["id"], {"acknowledged": True, "verdict": verdict})
        return verdict


class Fixture:
    def __init__(self, directory, seed=True):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.service = Service(self.directory / "service.sqlite")
        self.daemon = Daemon(self.directory / "daemon.sqlite")
        self.supervisor = Supervisor(self.directory / "supervisor.sqlite")
        self.target = binding()
        if seed:
            self.service.seed(self.target)
            self.daemon.seed(self.target)
            self.supervisor.seed(self.target)
        self.request = self.service.request_stop(self.target)

    def stop(self):
        assert self.daemon.request(self.request)["accepted"]
        self.supervisor.stop(self.target)
        return self.daemon.observe(self.request, self.supervisor)

    def ready(self):
        receipt = self.stop()
        assert self.service.receive(receipt)["accepted"]
        self.service.put("effect", "effect-A", {"writer": "writer-1", "state": "accounted"})
        assert self.service.verify_checkpoint(manifest(self.target), ARTIFACT)
        return receipt

    def recovery(self, command_id="recover-2"):
        value = manifest(self.target)
        return {"id": command_id, "predecessor": "writer-1", "target": binding(2), "manifest": value,
                "manifest_digest": digest(value), "recovery_class": "verified_reconstruction", "grant_expiry": 200}

    def snapshot(self):
        return {"service": self.service.snapshot(), "daemon": self.daemon.snapshot(), "supervisor_fixture": self.supervisor.snapshot()}

    def close(self):
        for journal in (self.service, self.daemon, self.supervisor):
            journal.db.close()


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def crash_worker(directory, phase):
    fixture = Fixture(directory, seed=False)
    fixture.daemon.request(fixture.request, death=phase, directory=directory)
    fixture.supervisor.stop(fixture.target)
    barrier(directory, "after_supervisor_stop_before_receipt", phase)
    receipt = fixture.daemon.observe(fixture.request, fixture.supervisor, death=phase, directory=directory)
    fixture.daemon.deliver(receipt, fixture.service, death=phase, directory=directory)
    raise AssertionError("worker missed requested death barrier")


def kill_at_barrier(directory, phase):
    marker = Path(directory) / "barrier.json"
    marker.unlink(missing_ok=True)
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "worker", "--directory", str(directory), "--phase", phase],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    started = time.monotonic()
    try:
        while not marker.exists() and process.poll() is None and time.monotonic() - started < 10:
            time.sleep(0.02)
        check(marker.exists(), "worker failed to reach death barrier")
        observed = json.loads(marker.read_text())
        check(observed == {"phase": phase, "pid": process.pid}, "barrier child mismatch")
        process.kill()
        stdout, stderr = process.communicate(timeout=5)
        check(process.returncode == -signal.SIGKILL, "expected actual SIGKILL")
        check(not stdout and not stderr, "unexpected child output")
        return {"phase": phase, "returncode": process.returncode, "barrier": "observed before SIGKILL"}
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def run_suite(output):
    cases = []
    with tempfile.TemporaryDirectory(prefix="writer-stop-protocol-") as root:
        def scenario(name, action):
            fixture = Fixture(Path(root) / str(len(cases)))
            try:
                details = action(fixture) or {}
                cases.append({"name": name, "passed": True, "details": details, "snapshot": fixture.snapshot()})
            finally:
                fixture.close()

        def positive(f):
            receipt = f.ready()
            value = f.recovery()
            check(f.service.admit(value)["accepted"], "ready recovery rejected")
            check(f.service.get("run", "run-A") == {"generation": 2, "charged": 2, "limit": 3}, "one fresh bounded charge")
            check(f.service.get("writer", "writer-2")["state"] == "active", "replacement missing")
            return {"receipt_id": receipt["id"], "manifest_digest": value["manifest_digest"]}
        scenario("complete_scope_exact_checkpoint_accounted_effect_admits_fresh_once", positive)

        def request_replay(f):
            first = f.daemon.request(f.request)
            check(f.daemon.request(f.request) == first, "request replay changed verdict")
            changed = copy.deepcopy(f.request); changed["target"]["generation"] = 2
            check(f.daemon.request(changed)["reason"] == "identity_payload_conflict", "changed request accepted")
        scenario("stop_request_exact_replay_and_payload_conflict", request_replay)

        def no_late_launch(f):
            local = f.daemon.get("invocation", "invocation-1"); local["launch_stage"] = "admitted"
            f.daemon.put("invocation", "invocation-1", local)
            check(f.daemon.request(f.request)["accepted"], "stop request failed")
            check(not f.daemon.launch(f.target), "launch occurred after stop gate")
        scenario("committed_stop_gate_prevents_first_launch", no_late_launch)

        def receipt_replay(f):
            receipt = f.ready(); first = f.service.receive(receipt)
            check(f.service.admit(f.recovery())["accepted"], "replacement missing")
            check(f.service.receive(receipt) == first, "accepted receipt changed across generation")
            check(f.service.get("writer", "writer-2")["state"] == "active", "old replay stopped replacement")
            changed = copy.deepcopy(receipt); changed["target"] = binding(2)
            check(f.service.receive(changed)["reason"] == "identity_payload_conflict", "receipt mutation accepted")
        scenario("accepted_receipt_replay_after_replacement_is_immutable", receipt_replay)

        def historical(f):
            receipt = f.stop()
            # Seed a separately current assignment to adversarially test per-writer storage only.
            newer = binding(2)
            f.service.put("writer", "writer-2", {"binding": newer, "issuer": RUNNER, "state": "active"})
            f.service.put("run", "run-A", {"generation": 2, "charged": 2, "limit": 3})
            check(f.service.receive(receipt)["accepted"], "old obligation could not be reconciled")
            check(f.service.get("writer", "writer-1")["state"] == "stopped", "old writer not accounted")
            check(f.service.get("writer", "writer-2")["state"] == "active", "old receipt affected replacement")
            return {"note": "Replacement is deliberately seeded for isolation testing; this is not a valid takeover path."}
        scenario("late_first_receipt_settles_only_exact_historical_obligation", historical)

        def old_request(f):
            f.daemon.seed(binding(2))
            check(f.daemon.request(f.request)["accepted"], "old cleanup request rejected")
            check(not f.daemon.get("invocation", "invocation-2")["stop_gate"], "old request gated replacement")
        scenario("old_stop_request_cannot_gate_replacement", old_request)

        for key in binding():
            def wrong_target(f, key=key):
                receipt = f.stop(); receipt["target"][key] = "wrong" if key != "generation" else 9
                receipt["target_digest"] = digest(receipt["target"])
                check(not f.service.receive(receipt)["accepted"], "wrong target accepted: " + key)
                check(f.service.get("writer", "writer-1")["state"] == "active", "wrong target changed old writer")
            scenario("receipt_target_mismatch_" + key, wrong_target)

        def request_identity(f):
            receipt = f.stop(); receipt["request_digest"] = "wrong"
            check(f.service.receive(receipt)["reason"] == "request_scope_mismatch", "wrong request digest accepted")
        scenario("receipt_must_name_exact_stop_request", request_identity)

        def principal_mismatch(f):
            receipt = f.stop()
            check(f.service.receive(receipt, principal="untrusted-transport-principal")["reason"] == "untrusted_issuer", "untrusted transport accepted")
            check(f.service.receive(receipt)["accepted"], "untrusted pre-play poisoned valid principal inbox")
        scenario("transport_principal_is_distinct_from_claimed_issuer", principal_mismatch)

        def missing_trust(f):
            receipt = f.stop(); registry = f.service.get("registry", RUNNER); registry["trusted"] = False
            f.service.put("registry", RUNNER, registry)
            rejected = f.service.receive(receipt)
            check(rejected["reason"] == "untrusted_issuer", "untrusted issuer accepted")
            registry["trusted"] = True; f.service.put("registry", RUNNER, registry)
            check(f.service.receive(receipt) == rejected, "rejected replay became accepted after state change")
            check(f.service.get("writer", "writer-1")["state"] == "active", "untrusted receipt settled writer")
        scenario("untrusted_receipt_rejection_stays_rejected_on_replay", missing_trust)

        def missing_profile(f):
            receipt = f.stop(); registry = f.service.get("registry", RUNNER); registry["profiles"] = []
            f.service.put("registry", RUNNER, registry)
            check(f.service.receive(receipt)["reason"] == "unsupported_capability_profile", "unsupported capability accepted")
        scenario("unapproved_observer_capability_cannot_attest", missing_profile)

        for attribute, replacement in [("scope_complete", False), ("can_stop", False)]:
            def incomplete(f, attribute=attribute, replacement=replacement):
                scope = f.supervisor.get("scope", f.target["scope_id"]); scope[attribute] = replacement
                f.supervisor.put("scope", f.target["scope_id"], scope)
                receipt = f.stop()
                check(not f.service.receive(receipt)["accepted"], "incomplete scope accepted")
                check(not f.service.admit(f.recovery())["accepted"], "incomplete scope allowed takeover")
                return {"outcome": receipt["outcome"]}
            scenario("scope_blocked_" + attribute, incomplete)

        def auto_restart(f):
            receipt = f.stop(); receipt["evidence"]["no_restart"] = False
            check(f.service.receive(receipt)["reason"] == "incomplete_terminal_scope", "temporary emptiness accepted")
        scenario("empty_scope_with_restart_route_is_not_terminal", auto_restart)

        def missing_gate(f):
            receipt = f.stop(); receipt["evidence"]["stop_gate"] = False
            check(f.service.receive(receipt)["reason"] == "observation_binding_or_gate_missing", "ungated terminal claim accepted")
        scenario("terminal_scope_without_durable_stop_gate_is_rejected", missing_gate)

        for key in Supervisor.IDENTITY_KEYS:
            def changed_scope(f, key=key):
                f.daemon.request(f.request)
                scope = f.supervisor.get("scope", f.target["scope_id"])
                scope["scope_identity"][key] = "replacement-instance"
                scope["writers"] = 0; scope["no_restart"] = True
                f.supervisor.put("scope", f.target["scope_id"], scope)
                receipt = f.daemon.observe(f.request, f.supervisor)
                check(receipt["outcome"] == "scope_unknown", "instance substitution was trusted")
                check(not f.service.receive(receipt)["accepted"], "substituted scope settled old writer")
            scenario("empty_replacement_scope_identity_mismatch_" + key, changed_scope)

        def missing_scope(f):
            f.daemon.request(f.request)
            f.supervisor.db.execute("DELETE FROM objects WHERE kind='scope'")
            receipt = f.daemon.observe(f.request, f.supervisor)
            check(receipt["outcome"] == "scope_unknown", "missing scope treated as empty")
            check(not f.service.receive(receipt)["accepted"], "missing scope settled writer")
        scenario("missing_scope_is_unknown_without_tombstone_proof", missing_scope)

        def lost_journal(f):
            f.daemon.db.execute("DELETE FROM objects")
            f.daemon.put("metadata", "journal", {"incarnation": "journal-B"})
            check(not f.daemon.request(f.request)["accepted"], "empty replacement journal accepted old stop")
            check(f.service.get("writer", "writer-1")["state"] == "active", "journal loss erased obligation")
        scenario("journal_loss_keeps_old_writer_unresolved", lost_journal)

        def changed_journal(f):
            f.daemon.put("metadata", "journal", {"incarnation": "journal-B"})
            check(f.daemon.request(f.request)["reason"] == "journal_incarnation_mismatch", "journal mismatch accepted")
        scenario("journal_incarnation_mismatch_rejected_before_stop", changed_journal)

        def changed_after_ack(f):
            f.daemon.request(f.request)
            f.supervisor.stop(f.target)
            f.daemon.put("metadata", "journal", {"incarnation": "journal-B"})
            try:
                f.daemon.observe(f.request, f.supervisor)
            except ValueError as exc:
                check("journal incarnation" in str(exc), "wrong rejection")
            else:
                raise AssertionError("new journal observed old scope")
            check(f.service.get("writer", "writer-1")["state"] == "active", "journal change settled old writer")
        scenario("journal_change_after_stop_ack_cannot_create_old_receipt", changed_after_ack)

        def journal_cannot_launch(f):
            local = f.daemon.get("invocation", "invocation-1"); local["launch_stage"] = "admitted"
            f.daemon.put("invocation", "invocation-1", local)
            f.daemon.put("metadata", "journal", {"incarnation": "journal-B"})
            check(not f.daemon.launch(f.target), "new journal launched old admitted invocation")
        scenario("changed_journal_cannot_launch_old_admission", journal_cannot_launch)

        def never_started(f):
            local = f.daemon.get("invocation", "invocation-1"); local["launch_stage"] = "admitted"
            f.daemon.put("invocation", "invocation-1", local)
            receipt = f.stop()
            check(receipt["outcome"] == "never_started", "unstarted gated invocation not distinguished")
            check(f.service.receive(receipt)["accepted"], "unstarted terminal evidence rejected")
        scenario("durable_prelaunch_gate_and_complete_scope_support_never_started", never_started)

        def uncertain_never_started(f):
            local = f.daemon.get("invocation", "invocation-1"); local["launch_stage"] = "launch_intent"
            f.daemon.put("invocation", "invocation-1", local)
            receipt = f.stop(); receipt["outcome"] = "never_started"
            check(f.service.receive(receipt)["reason"] == "launch_uncertainty", "uncertain native start described as never started")
        scenario("launch_intent_cannot_be_relabelled_never_started", uncertain_never_started)

        def remote_unknown(f):
            receipt = f.stop(); check(f.service.receive(receipt)["accepted"], "local receipt failed")
            check(f.service.get("effect", "effect-A")["state"] == "unknown", "stop cleared remote effect")
            f.service.verify_checkpoint(manifest(f.target), ARTIFACT)
            check(f.service.admit(f.recovery())["reason"] == "external_effect_unresolved", "unknown effect allowed takeover")
        scenario("local_stop_does_not_settle_unknown_remote_effect", remote_unknown)

        def only_checkpoint(f):
            f.service.verify_checkpoint(manifest(f.target), ARTIFACT)
            check(f.service.admit(f.recovery())["reason"] == "old_writer_unresolved", "checkpoint bypassed writer gate")
        scenario("verified_checkpoint_alone_cannot_authorize_takeover", only_checkpoint)

        def no_checkpoint(f):
            receipt = f.stop(); f.service.receive(receipt)
            f.service.put("effect", "effect-A", {"writer": "writer-1", "state": "accounted"})
            command = f.recovery(); command["verified"] = True
            check(f.service.admit(command)["reason"] == "exact_checkpoint_not_verified", "boolean accepted as checkpoint")
        scenario("verified_boolean_does_not_replace_exact_verifier_record", no_checkpoint)

        for key in manifest(binding()):
            def changed_manifest(f, key=key):
                f.ready(); command = f.recovery(); command["manifest"][key] = "different"
                command["manifest_digest"] = digest(command["manifest"])
                check(f.service.admit(command)["reason"] == "exact_checkpoint_not_verified", "wrong exact checkpoint accepted: " + key)
            scenario("checkpoint_mismatch_" + key, changed_manifest)

        def artifact_tamper(f):
            check(not f.service.verify_checkpoint(manifest(f.target), ARTIFACT + b"tamper"), "tampered artifact verified")
        scenario("verifier_checks_actual_fixture_artifact_bytes", artifact_tamper)

        def admission_replay(f):
            f.ready(); command = f.recovery(); first = f.service.admit(command)
            check(first["accepted"], "initial fresh admission failed")
            check(f.service.admit(command, now=1000) == first, "accepted admission replay expired")
            check(f.service.get("run", "run-A")["charged"] == 2, "replay charged again")
            changed = copy.deepcopy(command); changed["grant_expiry"] = 9000
            check(f.service.admit(changed)["reason"] == "identity_payload_conflict", "mutable grant replay accepted")
        scenario("fresh_admission_replay_charges_once_and_is_immutable", admission_replay)

        for kind in ("expired", "budget", "class", "input", "scope_reuse", "attempt_reuse"):
            def admission_block(f, kind=kind):
                f.ready(); command = f.recovery()
                expected = None
                if kind == "expired":
                    command["grant_expiry"] = 100; expected = "grant_expired"
                elif kind == "budget":
                    value = f.service.get("run", "run-A"); value["limit"] = value["charged"]; f.service.put("run", "run-A", value); expected = "allowance_exhausted"
                elif kind == "class":
                    command["recovery_class"] = "unapproved"; expected = "unsupported_recovery_class"
                elif kind == "input":
                    command["target"]["input_digest"] = "changed"; expected = "recovery_input_scope_mismatch"
                elif kind == "scope_reuse":
                    command["target"]["scope_id"] = f.target["scope_id"]; expected = "reused_invocation_or_scope"
                elif kind == "attempt_reuse":
                    command["target"]["attempt"] = f.target["attempt"]; expected = "reused_invocation_or_scope"
                check(f.service.admit(command)["reason"] == expected, "admission gate did not reject " + kind)
                check(f.service.get("run", "run-A")["charged"] == 1, "rejected admission charged")
            scenario("fresh_admission_blocks_" + kind, admission_block)

        def rejected_admission_replay(f):
            command = f.recovery(); first = f.service.admit(command)
            check(first["reason"] == "old_writer_unresolved", "expected initial block")
            f.ready()
            check(f.service.admit(command) == first, "rejected admission became accepted")
            fresh = f.recovery("recover-new-command")
            check(f.service.admit(fresh)["accepted"], "new explicitly evaluated request was blocked")
        scenario("rejected_admission_replay_is_permanent_new_request_required", rejected_admission_replay)

        def stale_recovery(f):
            f.ready()
            check(f.service.admit(f.recovery())["accepted"], "first reachable replacement failed")
            command = f.recovery("recover-stale-3"); command["target"] = binding(3)
            check(f.service.admit(command)["reason"] == "stale_predecessor", "stale checkpoint bypassed active replacement")
            check(f.service.get("writer", "writer-2")["state"] == "active", "current writer changed")
            check(f.service.get("writer", "writer-3") is None, "overlapping third writer admitted")
            check(f.service.get("run", "run-A")["charged"] == 2, "stale request consumed admission")
        scenario("reachable_stale_predecessor_cannot_bypass_active_replacement", stale_recovery)

        for kind in ("writer", "effect"):
            def additional_obligation(f, kind=kind):
                f.ready()
                extra = binding(90)
                f.service.put("writer", extra["writer_obligation"], {"binding": extra, "issuer": RUNNER,
                              "state": "active" if kind == "writer" else "stopped"})
                if kind == "effect":
                    f.service.put("effect", "effect-extra", {"writer": extra["writer_obligation"], "state": "unknown"})
                reason = "additional_writer_unresolved" if kind == "writer" else "external_effect_unresolved"
                check(f.service.admit(f.recovery())["reason"] == reason, "additional occurrence obligation bypassed")
                check(f.service.get("run", "run-A")["charged"] == 1, "blocked extra obligation charged")
            scenario("additional_same_occurrence_" + kind + "_blocks_admission", additional_obligation)

        def parallel_occurrence(f):
            f.ready()
            extra = binding(90); extra["occurrence"] = "parallel-occurrence-B"
            f.service.put("writer", extra["writer_obligation"], {"binding": extra, "issuer": RUNNER, "state": "active"})
            f.service.put("occurrence", occurrence_key(extra), {"generation": 90, "current_writer": extra["writer_obligation"]})
            f.service.put("effect", "effect-parallel", {"writer": extra["writer_obligation"], "state": "unknown"})
            check(f.service.admit(f.recovery())["accepted"], "unrelated parallel occurrence blocked")
            check(f.service.get("writer", extra["writer_obligation"])["state"] == "active", "parallel writer changed")
            check(f.service.get("effect", "effect-parallel")["state"] == "unknown", "parallel effect changed")
            return {"assumption": "Separate occurrences are declared nonconflicting; shared-resource conflicts need additional scope policy."}
        scenario("nonconflicting_parallel_occurrence_keeps_its_own_writer_and_effect", parallel_occurrence)

        for key in ("profile", "enrollment", "runner", "journal_incarnation"):
            def bad_replacement(f, key=key):
                f.ready(); command = f.recovery(); command["target"][key] = "unapproved"
                check(f.service.admit(command)["reason"] == "replacement_runner_ineligible", "unapproved replacement scope accepted")
                check(f.service.get("run", "run-A")["charged"] == 1, "ineligible replacement charged")
            scenario("replacement_eligibility_mismatch_" + key, bad_replacement)

        def untrusted_replacement(f):
            f.ready(); registry = f.service.get("registry", RUNNER); registry["trusted"] = False
            f.service.put("registry", RUNNER, registry)
            check(f.service.admit(f.recovery())["reason"] == "replacement_runner_ineligible", "untrusted replacement admitted")
        scenario("replacement_requires_current_trusted_registry_entry", untrusted_replacement)

        def concurrent_receipt(f):
            f.daemon.request(f.request)
            observation = f.supervisor.get("scope", f.target["scope_id"])
            sync = threading.Barrier(2)
            def observer(writers):
                local = Daemon(f.directory / "daemon.sqlite")
                class FixedObservation:
                    def get(self, kind, key):
                        value = copy.deepcopy(observation)
                        value["writers"] = writers; value["no_restart"] = writers == 0
                        return value
                try:
                    sync.wait(timeout=5)
                    return local.observe(f.request, FixedObservation(), receipt_id="concurrent-receipt")
                finally:
                    local.db.close()
            with ThreadPoolExecutor(max_workers=2) as workers:
                first = workers.submit(observer, 0); second = workers.submit(observer, 2)
                results = [first.result(timeout=10), second.result(timeout=10)]
            persisted = f.daemon.get("receipt", "concurrent-receipt")
            check(results[0] == results[1] == persisted, "concurrent observer overwrote immutable receipt")
            check(len(f.daemon.all("receipt")) == 1, "concurrent observer created duplicate receipts")
            return {"persisted_first_outcome": persisted["outcome"], "concurrent_callers": 2}
        scenario("concurrent_observers_return_first_immutable_receipt", concurrent_receipt)

        def different_request_same_receipt(f):
            receipt = f.stop()
            newer_request = f.service.request_stop(f.target, request_id="stop-second")
            f.daemon.request(newer_request)
            try:
                f.daemon.observe(newer_request, f.supervisor, receipt_id=receipt["id"])
            except ValueError as exc:
                check("receipt identity" in str(exc), "wrong receipt conflict rejection")
            else:
                raise AssertionError("same receipt identity adopted a different request")
            check(f.daemon.get("receipt", receipt["id"]) == receipt, "receipt conflict overwrote history")
        scenario("receipt_identity_cannot_be_rebound_to_another_stop_request", different_request_same_receipt)

        for phase in ("before_stop_commit", "after_stop_commit", "after_supervisor_stop_before_receipt", "after_receipt_commit", "after_service_accept_before_ack"):
            def crash(f, phase=phase):
                crash_evidence = kill_at_barrier(f.directory, phase)
                local = f.daemon.get("invocation", "invocation-1")
                pending_receipt = f.daemon.get("receipt", "receipt-1")
                check(local["stop_gate"] == (phase != "before_stop_commit"), "incorrect durable stop gate")
                check((pending_receipt is not None) == (phase in ("after_receipt_commit", "after_service_accept_before_ack")), "incorrect durable receipt boundary")
                check(f.service.get("writer", "writer-1")["state"] == ("stopped" if phase == "after_service_accept_before_ack" else "active"), "incorrect service acceptance boundary")
                before = f.snapshot()
                restarted = Daemon(f.directory / "daemon.sqlite")
                try:
                    check(restarted.request(f.request)["accepted"], "restart request reconciliation failed")
                    check(not restarted.launch(f.target), "restart caused another launch")
                    f.supervisor.stop(f.target)
                    receipt = restarted.observe(f.request, f.supervisor)
                    if pending_receipt:
                        check(receipt == pending_receipt, "restart changed durable receipt")
                    verdict = restarted.deliver(receipt, f.service)
                    check(verdict["accepted"], "replayed receipt did not settle exact writer")
                    check(restarted.get("outbox", "receipt-1")["acknowledged"], "outbox remained pending")
                    check(f.service.get("effect", "effect-A")["state"] == "unknown", "restart cleanup cleared effect")
                    check(f.service.get("run", "run-A")["charged"] == 1, "restart cleanup admitted work")
                finally:
                    restarted.db.close()
                return {"actual_process_death": crash_evidence, "snapshot_after_death_before_reconciliation": before}
            scenario("actual_SIGKILL_" + phase, crash)

    payload = {"fixture": "throwaway-stop-receipt-and-admission-v1", "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               "python_version": sys.version, "sqlite_version": sqlite3.sqlite_version,
               "real_evidence": ["SQLite WAL synchronous FULL commits", "five barrier-observed SIGKILL child deaths", "separate local service and daemon receipt commits", "artifact byte hashing"],
               "modeled_not_certified": ["OS supervisor/process containment", "authenticated enrolled issuer and profile registry", "Git/checkpoint verifier policy", "Execution production PostgreSQL composition", "external provider effects"],
               "scenario_count": len(cases), "passed": sum(c["passed"] for c in cases), "cases": cases}
    Path(output).write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"scenario_count": len(cases), "passed": payload["passed"], "source_sha256": payload["source_sha256"], "output": str(output)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("suite", "worker"))
    parser.add_argument("--output", default=str(Path(__file__).with_name("evidence.json")))
    parser.add_argument("--directory")
    parser.add_argument("--phase")
    args = parser.parse_args()
    if args.mode == "worker":
        crash_worker(args.directory, args.phase)
    else:
        run_suite(args.output)


if __name__ == "__main__":
    main()
