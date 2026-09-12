#!/usr/bin/env python3
"""Disposable authenticated-channel fixture; never a production daemon or PKI."""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import ssl
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DOMAIN = b"agents-assemble/runner-authority/v1\x00"
MAX_INTEGER = 9007199254740991
BINDING = {"writer_id", "deployment", "organization", "runner", "host", "boot",
           "journal", "journal_seq", "run", "occurrence", "generation", "attempt",
           "invocation", "admission", "input_digest", "scope_id", "activation",
           "profile", "manager", "payload_object"}
RECEIPT = BINDING | {"receipt_id", "issuer", "grant_id", "grant_digest", "stop_id",
                     "stop_digest", "outcome", "evidence_ref"}
QUERY = {"deployment", "organization", "runner", "receipt_id"}
ADMIT = {"deployment", "organization", "runner", "admission_id", "writer_id",
         "generation", "grant_id", "grant_digest"}
GRANT_REQUEST = {"deployment", "organization", "runner", "grant_id"}


class ProtocolError(Exception):
    def __init__(self, code, status=400):
        self.code, self.status = code, status
        super().__init__(code)


def _validate(value):
    if isinstance(value, str):
        if not value.isascii() or any(ord(c) < 0x20 or ord(c) > 0x7e for c in value):
            raise ProtocolError("non_ascii_metadata")
    elif type(value) is int:
        if not 0 <= value <= MAX_INTEGER:
            raise ProtocolError("unsupported_number")
    elif type(value) is bool:
        pass
    elif isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ProtocolError("non_string_key")
            _validate(key)
            _validate(item)
    elif isinstance(value, list):
        for item in value:
            _validate(item)
    else:
        raise ProtocolError("unsupported_value")


def canonical(value):
    """Scoped ASCII metadata encoding, deliberately NOT RFC 8785."""
    _validate(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def digest(value):
    return hashlib.sha256(DOMAIN + canonical(value)).hexdigest()


def artifact_digest(data):
    return hashlib.sha256(data).hexdigest()


def decode(raw, fields):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ProtocolError("duplicate_key")
            result[key] = value
        return result
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=pairs,
                           parse_constant=lambda _: (_ for _ in ()).throw(ProtocolError("unsupported_number")))
    except (UnicodeError, ValueError) as exc:
        raise ProtocolError("invalid_json") from exc
    canonical(value)
    if not isinstance(value, dict) or set(value) != fields:
        raise ProtocolError("unknown_or_missing_field")
    for key, item in value.items():
        if key in {"generation", "journal_seq"}:
            if type(item) is not int:
                raise ProtocolError("wrong_field_type")
        elif not isinstance(item, str) or not item:
            raise ProtocolError("wrong_field_type")
    for key in fields & {"input_digest", "grant_digest", "stop_digest", "evidence_ref"}:
        if len(value[key]) != 64 or any(c not in "0123456789abcdef" for c in value[key]):
            raise ProtocolError("invalid_digest")
    if raw != canonical(value):
        raise ProtocolError("noncanonical_wire_encoding")
    return value


def db(path):
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def openssl(*args, cwd=None):
    subprocess.run(["openssl", *map(str, args)], cwd=cwd, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def make_ca(path, name):
    openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
            "-nodes", "-keyout", path / f"{name}.key", "-out", path / f"{name}.crt",
            "-subj", f"/CN={name}", "-days", "2", "-addext", "basicConstraints=critical,CA:TRUE",
            "-addext", "keyUsage=critical,keyCertSign,cRLSign")


def make_cert(path, name, ca="ca", server=False, expired=False, valid_seconds=None):
    openssl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
            "-nodes", "-keyout", path / f"{name}.key", "-out", path / f"{name}.csr",
            "-subj", f"/CN={name}")
    ext = path / f"{name}.ext"
    ext.write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n"
                   + ("extendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n"
                      if server else "extendedKeyUsage=clientAuth\n"))
    if expired or valid_seconds is not None:
        (path / "index").write_text("")
        (path / "serial").write_text("1000\n")
        config = path / "ca.cnf"
        config.write_text(f"[ca]\ndefault_ca=local\n[local]\ndatabase={path}/index\n"
                          f"serial={path}/serial\nnew_certs_dir={path}\ncertificate={path}/{ca}.crt\n"
                          f"private_key={path}/{ca}.key\ndefault_md=sha256\npolicy=policy\n"
                          "[policy]\ncommonName=supplied\n")
        start = "20200101000000Z" if expired else time.strftime("%Y%m%d%H%M%SZ", time.gmtime(time.time() - 10))
        end = "20200102000000Z" if expired else time.strftime("%Y%m%d%H%M%SZ", time.gmtime(time.time() + valid_seconds))
        openssl("ca", "-batch", "-notext", "-config", config, "-in", path / f"{name}.csr",
                "-out", path / f"{name}.crt", "-extfile", ext,
                "-startdate", start, "-enddate", end)
    else:
        openssl("x509", "-req", "-in", path / f"{name}.csr", "-CA", path / f"{ca}.crt",
                "-CAkey", path / f"{ca}.key", "-CAcreateserial", "-out", path / f"{name}.crt",
                "-days", "1", "-extfile", ext)
    os.chmod(path / f"{name}.key", 0o600)


class OriginConnection(http.client.HTTPSConnection):
    def __init__(self, port, context, hostname="localhost"):
        super().__init__("127.0.0.1", port, timeout=5, context=context)
        self.hostname = hostname

    def connect(self):
        raw = socket.create_connection((self.host, self.port), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.hostname)
        except BaseException:
            raw.close()
            raise


class Fixture:
    """Context manager. All runtime keys/state disappear on close.

    Public: request(identity, operation, body, raw=None, connection=None),
    connection(identity), make_receipt(), make_admission(), fetch_grant(),
    snapshot(), fleet_update(identity, **fields), execution(sql, args),
    verify_checkpoint(writer_id), replace_journal(), restore_journal().
    Explicit fixture-admin helpers are never HTTP operations.
    """
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="runner-authority-private-")
        self.root = Path(self.tmp.name)
        os.chmod(self.root, 0o700)
        self.pki = self.root / "pki"
        self.pki.mkdir(mode=0o700)
        self.artifacts = self.root / "artifacts"
        self.artifacts.mkdir(mode=0o700)
        self.fleet_path = self.root / "fleet.sqlite"
        self.execution_path = self.root / "execution.sqlite"
        self.runner_path = self.root / "runner.sqlite"
        self.auth_events = []
        self.after_auth = None
        self.fail_transaction = False
        make_ca(self.pki, "ca")
        make_ca(self.pki, "foreign-ca")
        for name in ["server", "a", "a_rotated", "b", "runner_only", "wrong_tenant", "expired_cert", "unregistered", "wrong_ca"]:
            make_cert(self.pki, name, ca="foreign-ca" if name == "wrong_ca" else "ca",
                      server=name == "server", expired=name == "expired_cert")
        self._initialize()
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass

            def do_POST(self):
                status = 200
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length < 1 or length > 32768:
                        raise ProtocolError("invalid_length")
                    raw = self.rfile.read(length)
                    peer = self.connection.getpeercert(binary_form=True)
                    certificate = self.connection.getpeercert()
                    now = time.time()
                    if now >= ssl.cert_time_to_seconds(certificate["notAfter"]):
                        raise ProtocolError("certificate_expired", 403)
                    if now < ssl.cert_time_to_seconds(certificate["notBefore"]):
                        raise ProtocolError("certificate_not_yet_valid", 403)
                    fingerprint = hashlib.sha256(peer).hexdigest()
                    authority = fixture.authenticate(fingerprint)
                    if fixture.after_auth:
                        fixture.after_auth(authority)
                    result = fixture.handle(self.path, raw, authority)
                except ProtocolError as exc:
                    status, result = exc.status, {"error": exc.code}
                except Exception as exc:
                    status, result = 500, {"error": "internal_error", "type": type(exc).__name__}
                payload = canonical(result)
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                if self.headers.get("X-Fixture-Drop-Ack") == "1":
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                    return
                self.wfile.write(payload)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.load_cert_chain(self.pki / "server.crt", self.pki / "server.key")
        context.load_verify_locations(self.pki / "ca.crt")
        context.verify_mode = ssl.CERT_REQUIRED
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def _initialize(self):
        with db(self.fleet_path) as conn:
            conn.executescript("""
            CREATE TABLE enrollment(fingerprint TEXT PRIMARY KEY, identity TEXT, runner TEXT,
              organization TEXT, deployment TEXT, observer TEXT, roles TEXT, profile TEXT,
              host TEXT, boot TEXT, journal TEXT, highwater INTEGER, status TEXT, expires INTEGER);
            CREATE TABLE profile(profile TEXT PRIMARY KEY, trusted INTEGER, complete INTEGER, note TEXT);
            """)
            conn.executemany("INSERT INTO profile VALUES(?,?,?,?)", [
                ("fixture-trusted-complete", 1, 1, "Explicit controlled fixture assumption; no host isolation proof"),
                ("same-uid-unrestricted", 0, 0, "Tools can read credentials and journal; authenticated observation not trustworthy")])
            for name in ["a", "a_rotated", "b", "runner_only", "wrong_tenant", "expired_cert"]:
                runner = "runner-b" if name == "b" else "runner-a"
                organization = "org-other" if name == "wrong_tenant" else "org-1"
                roles = ["runner"] if name == "runner_only" else ["runner", "observer"]
                conn.execute("INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (self.fingerprint(name), name, runner, organization, "deployment-1",
                     "observer-b" if name == "b" else "observer-a", json.dumps(roles),
                     "fixture-trusted-complete", "host-1", "boot-1", "journal-1", 7, "active", int(time.time()) + 3600))
        with db(self.execution_path) as conn:
            conn.executescript("""
            CREATE TABLE writer(writer_id TEXT PRIMARY KEY, binding TEXT, stop_id TEXT, stop_digest TEXT,
              local_state TEXT, effect_state TEXT, checkpoint_state TEXT, current INTEGER,
              quarantined INTEGER, receipt_id TEXT);
            CREATE TABLE authority(grant_id TEXT PRIMARY KEY, body TEXT, digest TEXT, expires INTEGER, revoked INTEGER);
            CREATE TABLE verdict(operation TEXT, deployment TEXT, organization TEXT, runner TEXT, message_id TEXT,
              payload_digest TEXT, body TEXT, result TEXT, accepted_fingerprint TEXT,
              accepted_at INTEGER, authority_snapshot TEXT,
              PRIMARY KEY(operation,deployment,organization,runner,message_id));
            CREATE TABLE outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, message_id TEXT, body TEXT);
            CREATE TABLE run(run_id TEXT PRIMARY KEY, current_writer TEXT, budget INTEGER, admissions INTEGER);
            CREATE TABLE checkpoint(writer_id TEXT PRIMARY KEY, input_digest TEXT, baseline_ref TEXT, working_ref TEXT);
            CREATE TABLE artifact(ref TEXT PRIMARY KEY, filename TEXT, size INTEGER);
            """)
            self.binding = {"writer_id": "writer-1", "deployment": "deployment-1", "organization": "org-1",
                "runner": "runner-a", "host": "host-1", "boot": "boot-1", "journal": "journal-1",
                "journal_seq": 7, "run": "run-1", "occurrence": "occurrence-1", "generation": 1,
                "attempt": "attempt-1", "invocation": "invocation-1", "admission": "admission-original",
                "input_digest": artifact_digest(b"pinned-input-v1"), "scope_id": "scope-unique-1",
                "activation": "activation-1", "profile": "fixture-trusted-complete", "manager": "fixture-manager",
                "payload_object": "fixture-retained-object-1"}
            stop = {"stop_id": "stop-1", "binding": self.binding, "policy": "no-repopulation"}
            self.stop_digest = digest(stop)
            conn.execute("INSERT INTO writer VALUES(?,?,?,?,?,?,?,?,?,?)", ("writer-1", canonical(self.binding).decode(),
                "stop-1", self.stop_digest, "unknown", "unknown", "unverified", 1, 0, ""))
            grant = {"grant_id": "grant-1", "audience": "execution:deployment-1", "observer": "observer-a",
                     "operations": ["receipt", "admit"], "binding": self.binding,
                     "expires": int(time.time()) + 300, "invocation_limit": 1}
            self.grant_digest = digest(grant)
            conn.execute("INSERT INTO authority VALUES(?,?,?,?,?)", ("grant-1", canonical(grant).decode(), self.grant_digest, grant["expires"], 0))
            conn.execute("INSERT INTO run VALUES(?,?,?,?)", ("run-1", "writer-1", 1, 0))
        with db(self.runner_path) as conn:
            conn.executescript("CREATE TABLE journal(writer_id TEXT PRIMARY KEY, incarnation TEXT, boot TEXT, seq INTEGER, launch_gate TEXT, binding TEXT, receipt TEXT)")
            conn.execute("INSERT INTO journal VALUES(?,?,?,?,?,?,?)", ("writer-1", "journal-1", "boot-1", 7, "closed", canonical(self.binding).decode(), ""))
        self.evidence_ref = self.add_artifact(canonical({"scope_id": "scope-unique-1", "payload_object": "fixture-retained-object-1",
             "activation": "activation-1", "populated": 0, "launch_gate": "closed"}))
        self.baseline_ref = self.add_artifact(b"original baseline bytes\n")
        self.working_ref = self.add_artifact(b"recovered working checkpoint bytes\n")

    def fingerprint(self, identity):
        pem = (self.pki / f"{identity}.crt").read_text()
        return hashlib.sha256(ssl.PEM_cert_to_DER_cert(pem)).hexdigest()

    def authenticate(self, fingerprint):
        # Fleet read completes BEFORE the Execution-local transaction begins.
        with db(self.fleet_path) as conn:
            row = conn.execute("SELECT * FROM enrollment WHERE fingerprint=?", (fingerprint,)).fetchone()
            if row is None:
                raise ProtocolError("unknown_credential", 403)
            authority = dict(row)
            if row["status"] != "active":
                raise ProtocolError("credential_revoked", 403)
            if row["expires"] <= time.time():
                raise ProtocolError("enrollment_expired", 403)
            profile = conn.execute("SELECT * FROM profile WHERE profile=?", (row["profile"],)).fetchone()
            authority["profile_record"] = dict(profile)
            authority["roles"] = json.loads(authority["roles"])
            authority["authorized_at"] = int(time.time())
        self.auth_events.append({"fingerprint": fingerprint, "identity": authority["identity"], "event": "authorized"})
        return authority

    def connection(self, identity="a", hostname="localhost", ca="ca"):
        context = ssl.create_default_context(cafile=self.pki / f"{ca}.crt")
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        if identity:
            context.load_cert_chain(self.pki / f"{identity}.crt", self.pki / f"{identity}.key")
        return OriginConnection(self.port, context, hostname)

    def request(self, identity, operation, body=None, *, raw=None, connection=None, headers=None, hostname="localhost", ca="ca"):
        own = connection is None
        conn = connection or self.connection(identity, hostname=hostname, ca=ca)
        try:
            conn.request("POST", "/" + operation, body=raw if raw is not None else canonical(body),
                         headers={"Content-Type": "application/json", **(headers or {})})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        except (ssl.SSLError, OSError, http.client.HTTPException) as exc:
            return 0, {"transport_error": type(exc).__name__, "detail": str(exc)}
        finally:
            if own:
                conn.close()

    def fetch_grant(self, identity="a"):
        body = {key: self.binding[key] for key in ["deployment", "organization", "runner"]}
        body["grant_id"] = "grant-1"
        return self.request(identity, "grant", body)

    @staticmethod
    def verify_grant(envelope, expected_binding):
        canonical(envelope)
        if set(envelope) != {"grant", "digest"} or digest(envelope["grant"]) != envelope["digest"]:
            raise ProtocolError("grant_digest_mismatch")
        grant = envelope["grant"]
        if set(grant) != {"grant_id", "audience", "observer", "operations", "binding", "expires", "invocation_limit"}:
            raise ProtocolError("grant_schema_mismatch")
        decode(canonical(grant["binding"]), BINDING)
        decode(canonical(expected_binding), BINDING)
        if (type(grant["expires"]) is not int or type(grant["invocation_limit"]) is not int
                or grant["invocation_limit"] != 1 or grant["operations"] != ["receipt", "admit"]
                or any(not isinstance(grant[key], str) or not grant[key] for key in ["grant_id", "audience", "observer"])):
            raise ProtocolError("grant_schema_mismatch")
        if grant["binding"] != expected_binding or grant["audience"] != "execution:" + expected_binding["deployment"]:
            raise ProtocolError("grant_scope_mismatch")
        if grant["expires"] <= time.time():
            raise ProtocolError("grant_expired")
        return grant

    def make_receipt(self, receipt_id="receipt-1", **changes):
        result = {**self.binding, "receipt_id": receipt_id, "issuer": "observer-a", "grant_id": "grant-1",
                  "grant_digest": self.grant_digest, "stop_id": "stop-1", "stop_digest": self.stop_digest,
                  "outcome": "contained_local_processes_stopped", "evidence_ref": self.evidence_ref}
        result.update(changes)
        return result

    def make_admission(self, admission_id="admission-replacement", **changes):
        result = {key: self.binding[key] for key in ["deployment", "organization", "runner", "writer_id", "generation"]}
        result.update(admission_id=admission_id, grant_id="grant-1", grant_digest=self.grant_digest)
        result.update(changes)
        return result

    def query(self, receipt_id="receipt-1"):
        return {**{key: self.binding[key] for key in ["deployment", "organization", "runner"]}, "receipt_id": receipt_id}

    def _scope(self, value, authority, role):
        if role not in authority["roles"]:
            raise ProtocolError("role_denied", 403)
        for field in ["deployment", "organization", "runner"]:
            if value[field] != authority[field]:
                raise ProtocolError(field + "_denied", 403)

    def _grant(self, conn, value, authority, binding, operation):
        row = conn.execute("SELECT * FROM authority WHERE grant_id=?", (value["grant_id"],)).fetchone()
        if row is None or row["digest"] != value["grant_digest"]:
            return "grant_digest_mismatch"
        grant = json.loads(row["body"])
        if digest(grant) != row["digest"]:
            return "grant_body_corrupt"
        if row["revoked"]:
            return "grant_revoked"
        if row["expires"] <= time.time():
            return "grant_expired"
        if grant["binding"] != binding or grant["observer"] != authority["observer"] or operation not in grant["operations"]:
            return "grant_scope_mismatch"
        if grant["audience"] != "execution:" + authority["deployment"]:
            return "grant_audience_mismatch"
        return None

    def _artifact_valid(self, conn, ref):
        row = conn.execute("SELECT * FROM artifact WHERE ref=?", (ref,)).fetchone()
        if row is None:
            return False
        path = self.artifacts / row["filename"]
        return path.is_file() and artifact_digest(path.read_bytes()) == ref and path.stat().st_size == row["size"]

    def _receipt_reason(self, conn, value, authority):
        if value["issuer"] != authority["observer"]:
            return "issuer_substitution"
        row = conn.execute("SELECT * FROM writer WHERE writer_id=?", (value["writer_id"],)).fetchone()
        if row is None:
            return "unknown_writer"
        binding = json.loads(row["binding"])
        if {key: value[key] for key in BINDING} != binding:
            return "writer_binding_mismatch"
        for field in ["host", "boot", "journal", "profile"]:
            if value[field] != authority[field]:
                return "current_" + field + "_mismatch"
        if value["journal_seq"] < authority["highwater"]:
            return "journal_rollback"
        if value["stop_id"] != row["stop_id"] or value["stop_digest"] != row["stop_digest"]:
            return "stop_binding_mismatch"
        reason = self._grant(conn, value, authority, binding, "receipt")
        if reason:
            return reason
        if not self._artifact_valid(conn, value["evidence_ref"]):
            return "evidence_bytes_mismatch"
        evidence = (self.artifacts / value["evidence_ref"]).read_bytes()
        expected = canonical({"scope_id": binding["scope_id"], "payload_object": binding["payload_object"],
                              "activation": binding["activation"], "populated": 0, "launch_gate": "closed"})
        if evidence != expected:
            return "evidence_scope_mismatch"
        if value["outcome"] != "contained_local_processes_stopped":
            return "insufficient_terminal_outcome"
        return None

    def _admission_reason(self, conn, value, authority):
        row = conn.execute("SELECT * FROM writer WHERE writer_id=?", (value["writer_id"],)).fetchone()
        if row is None:
            return "unknown_writer"
        binding = json.loads(row["binding"])
        self._scope(binding, authority, "runner")
        for field in ["host", "boot", "journal", "profile"]:
            if binding[field] != authority[field]:
                return "current_" + field + "_mismatch"
        run = conn.execute("SELECT * FROM run WHERE run_id=?", (binding["run"],)).fetchone()
        if run["current_writer"] != value["writer_id"] or binding["generation"] != value["generation"] or not row["current"]:
            return "stale_current_writer"
        reason = self._grant(conn, value, authority, binding, "admit")
        if reason:
            return reason
        if not authority["profile_record"]["trusted"] or not authority["profile_record"]["complete"]:
            return "ineligible_profile"
        all_writers = conn.execute("SELECT * FROM writer").fetchall()
        for old in all_writers:
            if json.loads(old["binding"])["run"] != binding["run"]:
                continue
            if old["quarantined"]:
                return "evidence_quarantined"
            if old["local_state"] != "stopped":
                return "local_writer_unresolved"
            if old["effect_state"] != "accounted":
                return "external_effect_unknown"
        cp = conn.execute("SELECT * FROM checkpoint WHERE writer_id=?", (row["writer_id"],)).fetchone()
        if row["checkpoint_state"] != "verified" or cp is None or cp["input_digest"] != binding["input_digest"]:
            return "checkpoint_unverified"
        if not self._artifact_valid(conn, cp["baseline_ref"]) or not self._artifact_valid(conn, cp["working_ref"]):
            return "checkpoint_bytes_mismatch"
        if run["budget"] < 1:
            return "budget_exhausted"
        return None

    def handle(self, operation, raw, authority):
        schemas = {"/receipt": RECEIPT, "/query": QUERY, "/admit": ADMIT, "/grant": GRANT_REQUEST}
        if operation not in schemas:
            raise ProtocolError("unknown_operation", 404)
        value = decode(raw, schemas[operation])
        self._scope(value, authority, "observer" if operation in {"/receipt", "/query"} else "runner")
        with db(self.execution_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            if operation == "/grant":
                row = conn.execute("SELECT * FROM authority WHERE grant_id=?", (value["grant_id"],)).fetchone()
                if row is None:
                    raise ProtocolError("unknown_grant", 404)
                grant = json.loads(row["body"])
                self._scope(grant["binding"], authority, "runner")
                if row["revoked"] or row["expires"] <= time.time():
                    raise ProtocolError("grant_inactive", 403)
                return {"grant": grant, "digest": row["digest"]}
            key = ("/receipt" if operation == "/query" else operation,
                   value["deployment"], value["organization"], value["runner"],
                   value.get("receipt_id", value.get("admission_id")))
            row = conn.execute("SELECT * FROM verdict WHERE operation=? AND deployment=? AND organization=? AND runner=? AND message_id=?", key).fetchone()
            if operation == "/query":
                if row is None:
                    raise ProtocolError("unknown_receipt", 404)
                return json.loads(row["result"])
            payload_digest = digest(value)
            if row is not None:
                if payload_digest != row["payload_digest"]:
                    raise ProtocolError("payload_conflict", 409)
                return json.loads(row["result"])
            reason = self._receipt_reason(conn, value, authority) if operation == "/receipt" else self._admission_reason(conn, value, authority)
            result = {"accepted": reason is None, "reason": reason or "accepted", "message_id": key[-1]}
            if reason is None and operation == "/receipt":
                complete = authority["profile_record"]["trusted"] and authority["profile_record"]["complete"]
                state = "stopped" if complete else "authenticated_scope_only"
                conn.execute("UPDATE writer SET local_state=?,receipt_id=? WHERE writer_id=?", (state, value["receipt_id"], value["writer_id"]))
                result["local_state"] = state
            if reason is None and operation == "/admit":
                old = conn.execute("SELECT binding FROM writer WHERE writer_id=?", (value["writer_id"],)).fetchone()
                binding = json.loads(old["binding"])
                new = dict(binding, writer_id="replacement-" + value["admission_id"], generation=binding["generation"] + 1,
                           invocation="invocation-" + value["admission_id"], attempt="attempt-" + value["admission_id"],
                           admission=value["admission_id"], scope_id="scope-" + value["admission_id"], activation="pending", payload_object="pending")
                conn.execute("UPDATE writer SET current=0 WHERE writer_id=?", (value["writer_id"],))
                conn.execute("INSERT INTO writer VALUES(?,?,?,?,?,?,?,?,?,?)", (new["writer_id"], canonical(new).decode(), "pending", "pending", "unknown", "unknown", "unverified", 1, 0, ""))
                conn.execute("UPDATE run SET current_writer=?,budget=budget-1,admissions=admissions+1 WHERE run_id=?", (new["writer_id"], binding["run"]))
                result["replacement_writer"] = new["writer_id"]
            conn.execute("INSERT INTO verdict VALUES(?,?,?,?,?,?,?,?,?,?,?)", (*key, payload_digest, canonical(value).decode(), canonical(result).decode(), authority["fingerprint"],
                         int(time.time()), canonical(authority).decode()))
            if self.fail_transaction:
                raise ProtocolError("injected_before_outbox", 503)
            conn.execute("INSERT INTO outbox(kind,message_id,body) VALUES(?,?,?)", ("receipt.verdict" if operation == "/receipt" else "admission.verdict", key[-1], canonical(result).decode()))
            return result

    def execution(self, sql, args=()):
        with db(self.execution_path) as conn:
            return conn.execute(sql, args).fetchall()

    def fleet_update(self, identity, **changes):
        allowed = {"status", "expires", "host", "boot", "journal", "highwater", "profile", "roles"}
        if not changes or not set(changes) <= allowed:
            raise ValueError("unsupported admin update")
        with db(self.fleet_path) as conn:
            row = conn.execute("SELECT * FROM enrollment WHERE identity=?", (identity,)).fetchone()
            shared = {key: value for key, value in changes.items() if key in {"host", "boot", "journal", "highwater", "profile"}}
            credential = {key: value for key, value in changes.items() if key not in shared}
            if shared:
                conn.execute("UPDATE enrollment SET " + ",".join(key + "=?" for key in shared)
                             + " WHERE deployment=? AND organization=? AND runner=?",
                             (*shared.values(), row["deployment"], row["organization"], row["runner"]))
            if credential:
                conn.execute("UPDATE enrollment SET " + ",".join(key + "=?" for key in credential) + " WHERE identity=?", (*credential.values(), identity))

    def revoke_runner(self, identity="a"):
        with db(self.fleet_path) as conn:
            row = conn.execute("SELECT * FROM enrollment WHERE identity=?", (identity,)).fetchone()
            conn.execute("UPDATE enrollment SET status='revoked' WHERE deployment=? AND organization=? AND runner=?",
                         (row["deployment"], row["organization"], row["runner"]))

    def short_lived_identity(self, valid_seconds=3):
        make_cert(self.pki, "short_lived", valid_seconds=valid_seconds)
        with db(self.fleet_path) as conn:
            row = dict(conn.execute("SELECT * FROM enrollment WHERE identity='a'").fetchone())
            row.update(identity="short_lived", fingerprint=self.fingerprint("short_lived"))
            conn.execute("INSERT INTO enrollment VALUES(" + ",".join("?" for _ in row) + ")", tuple(row.values()))
        return "short_lived"

    def authorize_replacement_probe(self, writer_id):
        """Fixture-admin bounded authority for a negative current-writer probe."""
        with db(self.execution_path) as conn:
            binding = json.loads(conn.execute("SELECT binding FROM writer WHERE writer_id=?", (writer_id,)).fetchone()[0])
            grant = {"grant_id": "grant-current", "audience": "execution:" + binding["deployment"],
                     "observer": "observer-a", "operations": ["receipt", "admit"], "binding": binding,
                     "expires": int(time.time()) + 300, "invocation_limit": 1}
            grant_digest = digest(grant)
            conn.execute("INSERT INTO authority VALUES(?,?,?,?,?)", ("grant-current", canonical(grant).decode(), grant_digest, grant["expires"], 0))
        return "grant-current", grant_digest

    def add_artifact(self, data):
        ref = artifact_digest(data)
        (self.artifacts / ref).write_bytes(data)
        with db(self.execution_path) as conn:
            conn.execute("INSERT OR IGNORE INTO artifact VALUES(?,?,?)", (ref, ref, len(data)))
        return ref

    def verify_checkpoint(self, writer_id="writer-1", *, input_digest=None, baseline_ref=None, working_ref=None):
        with db(self.execution_path) as conn:
            binding = json.loads(conn.execute("SELECT binding FROM writer WHERE writer_id=?", (writer_id,)).fetchone()[0])
            input_digest = input_digest or binding["input_digest"]
            baseline_ref = baseline_ref or self.baseline_ref
            working_ref = working_ref or self.working_ref
            if input_digest != binding["input_digest"] or not self._artifact_valid(conn, baseline_ref) or not self._artifact_valid(conn, working_ref):
                raise ProtocolError("checkpoint_verification_failed")
            # Controlled independent verifier is provisioned expected refs, never workload-selected content.
            if baseline_ref != self.baseline_ref or working_ref != self.working_ref:
                raise ProtocolError("checkpoint_manifest_mismatch")
            conn.execute("INSERT OR REPLACE INTO checkpoint VALUES(?,?,?,?)", (writer_id, input_digest, baseline_ref, working_ref))
            conn.execute("UPDATE writer SET checkpoint_state='verified' WHERE writer_id=?", (writer_id,))

    def persist_runner_receipt(self, receipt):
        with db(self.runner_path) as conn:
            conn.execute("UPDATE journal SET receipt=? WHERE writer_id=?", (canonical(receipt).decode(), receipt["writer_id"]))

    def replace_journal(self, incarnation="journal-2", boot="boot-1"):
        with db(self.runner_path) as conn:
            conn.execute("DELETE FROM journal")
            conn.execute("INSERT INTO journal VALUES(?,?,?,?,?,?,?)", ("new-incarnation", incarnation, boot, 0, "closed", "{}", ""))
        self.fleet_update("a", journal=incarnation, boot=boot, highwater=0)

    def snapshot(self):
        result = {}
        for name, path in [("fleet", self.fleet_path), ("execution", self.execution_path), ("runner", self.runner_path)]:
            with db(path) as conn:
                tables = [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
                result[name] = {table: [dict(row) for row in conn.execute("SELECT * FROM " + table + " ORDER BY rowid")] for table in tables}
        result["artifact_bytes"] = [{"ref": path.name, "actual_sha256": artifact_digest(path.read_bytes()), "size": path.stat().st_size} for path in sorted(self.artifacts.iterdir())]
        return result

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def run_suite(output):
    scenarios = []
    checks = 0

    def check(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            raise AssertionError(message)

    def record(fixture, name, action, expected):
        before = fixture.snapshot()
        result = action()
        after = fixture.snapshot()
        expected(result, before, after)
        scenarios.append({"name": name, "result": result, "before": before, "after": after, "passed": True})
        return result

    def error(code, unchanged=True):
        def expect(result, before, after):
            check(result[1].get("error") == code, f"expected {code}, got {result}")
            if unchanged:
                check(before == after, f"{code} changed durable state")
        return expect

    def rejected(reason):
        def expect(result, before, after):
            check(result[0] == 200 and result[1].get("accepted") is False and result[1].get("reason") == reason, f"expected rejection {reason}, got {result}")
            check(before["execution"]["writer"] == after["execution"]["writer"], f"{reason} changed writers")
            check(before["execution"]["run"] == after["execution"]["run"], f"{reason} changed admission budget")
            check(len(after["execution"]["verdict"]) == len(before["execution"]["verdict"]) + 1, "rejection not durable")
            check(len(after["execution"]["outbox"]) == len(before["execution"]["outbox"]) + 1, "rejection missing outbox")
        return expect

    def accepted(result, before, after):
        check(result[0] == 200 and result[1].get("accepted") is True, f"acceptance failed: {result}")
        check(len(after["execution"]["verdict"]) == len(before["execution"]["verdict"]) + 1, "acceptance not durable")
        check(len(after["execution"]["outbox"]) == len(before["execution"]["outbox"]) + 1, "acceptance missing outbox")

    with Fixture() as f:
        initial = f.snapshot()
        for identity, hostname, ca, label in [(None, "localhost", "ca", "no_client_certificate"),
                ("wrong_ca", "localhost", "ca", "wrong_client_CA"),
                ("expired_cert", "localhost", "ca", "actually_expired_client_certificate"),
                ("a", "wrong.invalid", "ca", "wrong_service_hostname"),
                ("a", "localhost", "foreign-ca", "wrong_service_CA")]:
            def transport(result, before, after):
                check(result[0] == 0 and "transport_error" in result[1], "TLS boundary did not reject")
                check(before == after, "failed TLS mutated state")
            record(f, label, lambda i=identity, h=hostname, c=ca: f.request(i, "receipt", f.make_receipt(), hostname=h, ca=c), transport)
        record(f, "valid_CA_but_unenrolled", lambda: f.request("unregistered", "receipt", f.make_receipt()), error("unknown_credential"))
        record(f, "runner_B_cannot_assert_runner_A", lambda: f.request("b", "receipt", f.make_receipt()), error("runner_denied"))
        record(f, "runner_B_header_impersonation", lambda: f.request("b", "receipt", f.make_receipt(), headers={"X-Principal": "runner-a"}), error("runner_denied"))
        record(f, "wrong_tenant_credential", lambda: f.request("wrong_tenant", "receipt", f.make_receipt()), error("organization_denied"))
        record(f, "wrong_deployment_payload", lambda: f.request("a", "receipt", f.make_receipt(deployment="other")), error("deployment_denied"))
        record(f, "wrong_tenant_payload", lambda: f.request("a", "receipt", f.make_receipt(organization="other")), error("organization_denied"))
        record(f, "runner_role_is_not_observer", lambda: f.request("runner_only", "receipt", f.make_receipt()), error("role_denied"))
        for field, value, reason in [("issuer", "observer-b", "issuer_substitution"), ("scope_id", "substituted", "writer_binding_mismatch"),
                ("generation", 2, "writer_binding_mismatch"), ("grant_digest", "0" * 64, "grant_digest_mismatch"),
                ("stop_digest", "0" * 64, "stop_binding_mismatch"), ("host", "host-forged", "writer_binding_mismatch")]:
            record(f, "changed_" + field, lambda k=field, v=value: f.request("a", "receipt", f.make_receipt("changed-" + k, **{k: v})), rejected(reason))
        for label, raw, code in [("duplicate_keys", b'{"receipt_id":"x","receipt_id":"y"}', "duplicate_key"),
                ("unknown_field", canonical(dict(f.make_receipt(), extra="x")), "unknown_or_missing_field"),
                ("float_number", canonical(f.make_receipt()).replace(b'"generation":1', b'"generation":1.0'), "unsupported_value"),
                ("oversized_integer", canonical(f.make_receipt()).replace(b'"generation":1', b'"generation":9007199254740992'), "unsupported_number"),
                ("unicode_metadata", canonical(f.make_receipt()).replace(b'"observer-a"', b'"observer-\\u00e9"'), "non_ascii_metadata")]:
            record(f, label, lambda r=raw: f.request("a", "receipt", raw=r), error(code))
        envelope = record(f, "authenticated_service_grant_fetch", lambda: f.fetch_grant(), lambda result, before, after:
                         check(result[0] == 200 and f.verify_grant(result[1], f.binding)["grant_id"] == "grant-1" and before == after, "grant fetch/verification failed"))[1]
        tampered = copy.deepcopy(envelope)
        tampered["grant"]["binding"]["generation"] = 2
        try:
            f.verify_grant(tampered, f.binding)
            check(False, "tampered fetched grant verified")
        except ProtocolError as exc:
            check(exc.code == "grant_digest_mismatch", "unexpected grant verification error")
        scenarios.append({"name": "runner_verifies_fetched_grant_bytes", "result": "grant_digest_mismatch", "before": f.snapshot(), "after": f.snapshot(), "passed": True})
        f.fleet_update("a", expires=0)
        record(f, "enrollment_expired", lambda: f.request("a", "receipt", f.make_receipt()), error("enrollment_expired"))
        f.fleet_update("a", expires=int(time.time()) + 3600)
        f.execution("UPDATE authority SET expires=0")
        record(f, "new_receipt_expired_authority", lambda: f.request("a", "receipt", f.make_receipt("expired-authority")), rejected("grant_expired"))
        f.execution("UPDATE authority SET expires=?", (int(time.time()) + 300,))
        f.execution("UPDATE authority SET revoked=1")
        record(f, "new_receipt_revoked_authority", lambda: f.request("a", "receipt", f.make_receipt("revoked-authority")), rejected("grant_revoked"))
        f.execution("UPDATE authority SET revoked=0")
        path = f.artifacts / f.evidence_ref
        evidence_bytes = path.read_bytes()
        path.write_bytes(b"tampered observation")
        record(f, "evidence_reference_requires_exact_bytes", lambda: f.request("a", "receipt", f.make_receipt("tampered-evidence")), rejected("evidence_bytes_mismatch"))
        path.write_bytes(evidence_bytes)
        f.fail_transaction = True
        record(f, "rollback_verdict_writer_and_outbox_together", lambda: f.request("a", "receipt", f.make_receipt("transaction-fault")), error("injected_before_outbox"))
        f.fail_transaction = False
        receipt = f.make_receipt()
        f.persist_runner_receipt(receipt)
        record(f, "lost_ack_after_durable_acceptance", lambda: f.request("a", "receipt", receipt, headers={"X-Fixture-Drop-Ack": "1"}),
            lambda result, before, after: (check(result[0] == 0, "ACK unexpectedly received"),
                check(after["execution"]["writer"][0]["local_state"] == "stopped", "lost ACK lost writer verdict"),
                check(len(after["execution"]["verdict"]) == len(before["execution"]["verdict"]) + 1, "lost ACK lost inbox"),
                check(len(after["execution"]["outbox"]) == len(before["execution"]["outbox"]) + 1, "lost ACK lost outbox")))
        replay = record(f, "lost_ack_replay", lambda: f.request("a", "receipt", receipt), lambda result, before, after:
                        (check(result[1].get("accepted") is True, "replay failed"), check(before == after, "replay caused effects")))
        record(f, "receipt_payload_conflict", lambda: f.request("a", "receipt", dict(receipt, outcome="scope_unknown")), error("payload_conflict"))
        f.execution("UPDATE authority SET expires=0")
        record(f, "historical_replay_after_grant_expiry", lambda: f.request("a", "receipt", receipt), lambda result, before, after:
               (check(result == replay, "historical verdict changed"), check(before == after, "expired historical replay changed state")))
        f.execution("UPDATE authority SET expires=?", (int(time.time()) + 300,))
        keepalive = f.connection("a")
        check(f.request("a", "query", f.query(), connection=keepalive)[0] == 200, "keepalive initial query failed")
        old_socket = keepalive.sock
        f.fleet_update("a", status="revoked")
        record(f, "revocation_rechecked_on_existing_TLS_connection", lambda: f.request("a", "query", f.query(), connection=keepalive), error("credential_revoked"))
        check(keepalive.sock is old_socket, "revocation probe did not reuse TLS connection")
        keepalive.close()
        record(f, "revoked_credential_cannot_replay", lambda: f.request("a", "receipt", receipt), error("credential_revoked"))
        record(f, "active_rotated_key_queries_historical_verdict", lambda: f.request("a_rotated", "query", f.query()), lambda result, before, after:
               (check(result == replay, "rotation lost historical result"), check(before == after, "query mutated state")))
        record(f, "active_rotated_key_replays_identical_receipt", lambda: f.request("a_rotated", "receipt", receipt), lambda result, before, after:
               (check(result == replay, "rotation replay changed historical result"), check(before == after, "rotation replay mutated state")))
        record(f, "other_runner_cannot_query_historical_receipt", lambda: f.request("b", "query", f.query()), error("runner_denied"))
        f.fleet_update("a_rotated", expires=0)
        record(f, "expired_active_key_cannot_query_history", lambda: f.request("a_rotated", "query", f.query()), error("enrollment_expired"))
        f.fleet_update("a_rotated", expires=int(time.time()) + 3600)
        f.fleet_update("a", status="active")
        record(f, "stopped_local_writer_does_not_settle_external_effect", lambda: f.request("a", "admit", f.make_admission("blocked-effect")), rejected("external_effect_unknown"))
        f.execution("UPDATE writer SET effect_state='accounted' WHERE writer_id='writer-1'")
        record(f, "effect_accounted_does_not_verify_checkpoint", lambda: f.request("a", "admit", f.make_admission("blocked-checkpoint")), rejected("checkpoint_unverified"))
        f.verify_checkpoint()
        checkpoint_path = f.artifacts / f.working_ref
        checkpoint_bytes = checkpoint_path.read_bytes()
        checkpoint_path.write_bytes(b"changed checkpoint")
        record(f, "checkpoint_bytes_reverified_at_admission", lambda: f.request("a", "admit", f.make_admission("blocked-checkpoint-bytes")), rejected("checkpoint_bytes_mismatch"))
        checkpoint_path.write_bytes(checkpoint_bytes)
        f.execution("UPDATE writer SET quarantined=1 WHERE writer_id='writer-1'")
        record(f, "compromised_evidence_blocks_future_admission", lambda: f.request("a", "admit", f.make_admission("blocked-quarantine")), rejected("evidence_quarantined"))
        record(f, "quarantine_preserves_historical_verdict", lambda: f.request("a_rotated", "query", f.query()), lambda result, before, after:
               (check(result == replay, "quarantine rewrote historical verdict"), check(before == after, "quarantine query mutated state")))
        f.execution("UPDATE writer SET quarantined=0 WHERE writer_id='writer-1'")
        f.execution("UPDATE run SET budget=0")
        record(f, "fresh_budget_required", lambda: f.request("a", "admit", f.make_admission("blocked-budget")), rejected("budget_exhausted"))
        f.execution("UPDATE run SET budget=1")
        record(f, "rejected_admission_remains_rejected_after_budget_changes", lambda: f.request("a", "admit", f.make_admission("blocked-budget")), lambda result, before, after:
               (check(result[1].get("reason") == "budget_exhausted", "rejection changed after budget update"), check(before == after, "rejected replay mutated state")))
        positive = record(f, "one_exact_complete_fixture_recovery", lambda: f.request("a", "admit", f.make_admission()), accepted)
        check(f.snapshot()["execution"]["run"][0]["admissions"] == 1, "positive recovery admitted more than once")
        record(f, "admission_replay_is_not_new_permission", lambda: f.request("a_rotated", "admit", f.make_admission()), lambda result, before, after:
               (check(result == positive, "admission replay changed"), check(before == after, "admission replay charged budget")))
        record(f, "stale_predecessor_cannot_authorize_current_replacement", lambda: f.request("a", "admit", f.make_admission("stale-predecessor")), rejected("stale_current_writer"))
        record(f, "current_replacement_requires_its_own_authority", lambda: f.request("a", "admit", f.make_admission("current-replacement", writer_id=positive[1]["replacement_writer"], generation=2)), rejected("grant_scope_mismatch"))
        current_grant_id, current_grant_digest = f.authorize_replacement_probe(positive[1]["replacement_writer"])
        record(f, "current_replacement_remains_live_even_with_valid_new_authority", lambda: f.request("a", "admit", f.make_admission("current-replacement-authorized",
            writer_id=positive[1]["replacement_writer"], generation=2, grant_id=current_grant_id, grant_digest=current_grant_digest)), rejected("local_writer_unresolved"))
        final = f.snapshot()

    # Independent fresh fixtures avoid historical acceptance hiding incarnation failures.
    with Fixture() as f:
        f.replace_journal()
        record(f, "new_journal_cannot_attest_old_missing_scope", lambda: f.request("a", "receipt", f.make_receipt("new-journal")), rejected("current_journal_mismatch"))
        record(f, "forged_new_journal_cannot_rebind_old_writer", lambda: f.request("a", "receipt", f.make_receipt("forged-journal", journal="journal-2", journal_seq=0)), rejected("writer_binding_mismatch"))
        record(f, "other_active_key_cannot_attest_prior_incarnation", lambda: f.request("a_rotated", "receipt", f.make_receipt("old-incarnation-rotated")), rejected("current_journal_mismatch"))
    with Fixture() as f:
        f.replace_journal(incarnation="journal-1", boot="boot-2")
        record(f, "new_boot_does_not_prove_old_writer_stopped", lambda: f.request("a", "receipt", f.make_receipt("new-boot")), rejected("current_boot_mismatch"))
    with Fixture() as f:
        backup = f.root / "rollback.sqlite"
        shutil.copy2(f.runner_path, backup)
        with db(f.runner_path) as conn:
            conn.execute("UPDATE journal SET seq=8")
        f.fleet_update("a", highwater=8)
        shutil.copy2(backup, f.runner_path)
        record(f, "actual_journal_database_rollback", lambda: f.request("a", "receipt", f.make_receipt("rollback")), rejected("journal_rollback"))
    with Fixture() as f:
        receipt = f.make_receipt()
        record(f, "accepted_before_journal_loss", lambda: f.request("a", "receipt", receipt), accepted)
        f.replace_journal()
        record(f, "current_identity_queries_old_accepted_receipt_after_journal_loss", lambda: f.request("a", "query", f.query()), lambda result, before, after:
               (check(result[1].get("accepted") is True, "history lost after journal replacement"), check(before == after, "historical query mutated state")))
        record(f, "exact_historical_replay_after_journal_loss", lambda: f.request("a", "receipt", receipt), lambda result, before, after:
               (check(result[1].get("accepted") is True, "historical replay lost after journal replacement"), check(before == after, "historical replay mutated state")))
        f.execution("UPDATE writer SET effect_state='accounted'")
        f.verify_checkpoint()
        record(f, "new_journal_cannot_admit_using_old_incarnation_authority", lambda: f.request("a", "admit", f.make_admission("new-journal-admit")), rejected("current_journal_mismatch"))
        record(f, "wrong_tenant_cannot_admit_another_tenants_writer", lambda: f.request("wrong_tenant", "admit", f.make_admission("cross-tenant-admit", organization="org-other")), error("organization_denied"))
        f.revoke_runner()
        record(f, "runner_wide_revocation_rejects_original_key", lambda: f.request("a", "query", f.query()), error("credential_revoked"))
        record(f, "runner_wide_revocation_rejects_rotated_key", lambda: f.request("a_rotated", "query", f.query()), error("credential_revoked"))
    with Fixture() as f:
        # A same-UID subprocess reads toy keys and acts as the observer over real mTLS.
        f.fleet_update("a", profile="same-uid-unrestricted")
        binding = dict(f.binding, profile="same-uid-unrestricted")
        f.binding = binding
        f.execution("UPDATE writer SET binding=?", (canonical(binding).decode(),))
        grant = json.loads(f.execution("SELECT body FROM authority")[0][0])
        grant["binding"] = binding
        f.grant_digest = digest(grant)
        f.execution("UPDATE authority SET body=?,digest=?", (canonical(grant).decode(), f.grant_digest))
        receipt = f.make_receipt("same-uid-impersonation")
        rawfile = f.root / "tool-receipt.json"
        rawfile.write_bytes(canonical(receipt))
        attack_script = """import http.client,json,ssl,sys,pathlib,sqlite3
p=pathlib.Path(sys.argv[1]); key=(p/'pki/a.key').read_bytes()
c=ssl.create_default_context(cafile=p/'pki/ca.crt'); c.load_cert_chain(p/'pki/a.crt',p/'pki/a.key')
db=sqlite3.connect(p/'runner.sqlite'); db.execute(\"UPDATE journal SET launch_gate='tool-tampered'\"); db.commit()
h=http.client.HTTPSConnection('localhost',int(sys.argv[2]),context=c)
h.request('POST','/receipt',(p/'tool-receipt.json').read_bytes()); r=h.getresponse()
print(json.dumps({'status':r.status,'result':json.loads(r.read()),'read_private_key':bool(key),'same_uid':__import__('os').getuid()}))
"""
        def impersonate():
            result = subprocess.run(["python3", "-c", attack_script, str(f.root), str(f.port)], text=True, check=True, capture_output=True)
            return json.loads(result.stdout)
        record(f, "same_UID_tool_reads_key_tampers_journal_and_impersonates_observer", impersonate, lambda result, before, after:
               (check(result["read_private_key"] and result["status"] == 200 and result["result"]["accepted"], "same UID impersonation not exercised"),
                check(result["result"]["local_state"] == "authenticated_scope_only", "same UID profile settled writer"),
                check(after["runner"]["journal"][0]["launch_gate"] == "tool-tampered", "same UID did not alter journal")))
        f.execution("UPDATE writer SET effect_state='accounted'")
        f.verify_checkpoint()
        record(f, "authenticated_same_UID_profile_is_ineligible_for_recovery", lambda: f.request("a", "admit", f.make_admission("same-uid-admit")), rejected("ineligible_profile"))
    with Fixture() as f:
        def revoke_after_authorization(authority):
            f.after_auth = None
            f.fleet_update(authority["identity"], status="revoked")
        f.after_auth = revoke_after_authorization
        record(f, "already_authorized_request_may_commit_after_Fleet_revocation", lambda: f.request("a", "receipt", f.make_receipt()), accepted)
        record(f, "next_operation_observes_revocation", lambda: f.request("a", "query", f.query()), error("credential_revoked"))

    with Fixture() as f:
        identity = f.short_lived_identity()
        connection = f.connection(identity)
        request = {**{key: f.binding[key] for key in ["deployment", "organization", "runner"]}, "grant_id": "grant-1"}
        check(f.request(identity, "grant", request, connection=connection)[0] == 200, "short-lived initial handshake failed")
        old_socket = connection.sock
        # Client-side peer is the service; inspect the short-lived client certificate for this wait.
        certificate = ssl._ssl._test_decode_cert(str(f.pki / "short_lived.crt"))
        expiry = ssl.cert_time_to_seconds(certificate["notAfter"])
        time.sleep(max(0, expiry - time.time() + 0.05))
        record(f, "actual_certificate_expiration_rechecked_on_existing_TLS_connection", lambda: f.request(identity, "grant", request, connection=connection), error("certificate_expired"))
        check(connection.sock is old_socket, "certificate expiry probe did not reuse TLS connection")
        connection.close()

    evidence = {"schema": "runner-authority-evidence-v1", "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_sha256": artifact_digest(Path(__file__).read_bytes()),
        "result": "PASS", "scenarios": scenarios, "scenario_count": len(scenarios), "check_count": checks,
        "initial_state": initial, "final_state": final, "runtime": {"python": __import__("sys").version,
        "openssl": ssl.OPENSSL_VERSION, "sqlite": sqlite3.sqlite_version},
        "limits": ["Disposable loopback mTLS fixture; no production PKI, enrollment API, outbound tunnel or PostgreSQL implementation.",
            "Fleet authorization snapshot and Execution transaction are separate linearization points; an already authorized operation can commit after a revocation request.",
            "SQLite tests Execution-local atomicity only and do not replace ADR 0003 PostgreSQL evidence.",
            "Trusted complete observer and independent checkpoint verifier are explicit controlled fixture assumptions; no kernel supervision or complete host isolation is proved.",
            "A same-UID tool can read the toy observer key and tamper with its journal. Authentication does not establish truthful observation; that profile remains ineligible.",
            "Host, boot and journal are server-bound claims, not hardware/boot attestation. Same-incarnation rollback below observed highwater is detected; unseen rollback is not generally detectable.",
            "External effects are controlled local states; no provider cancellation or reconciliation is proved.",
            "Historical immutable verdicts depend on durable service records; no portable signed receipt or offline-verifiable evidence is produced.",
            "All keys and certificates were temporary and deleted; evidence contains fingerprints, scoped metadata, digests and sanitized database records only."]}
    Path(output).write_text(json.dumps(evidence, indent=2) + "\n")
    return evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(Path(__file__).with_name("evidence.json")))
    args = parser.parse_args()
    report = run_suite(args.output)
    print(json.dumps({"result": report["result"], "scenario_count": report["scenario_count"], "check_count": report["check_count"], "output": str(Path(args.output).resolve())}))
