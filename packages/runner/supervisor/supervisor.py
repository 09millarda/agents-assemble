#!/usr/bin/python3
"""Protected Linux scoped observer. Native workload coverage always remains incomplete."""
import argparse
import array
import ctypes
import hashlib
import http.client
import json
import os
import pathlib
import re
import select
import socket
import ssl
import stat
import struct
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

VERSION = "aa-supervisor/1"
CONFIG = "/etc/agents-assemble/supervisor.json"
MAX_FRAME = 1024 * 1024
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$")
FORBIDDEN_ENV = re.compile(r"^(AA_|CODEX_|OPENAI_|ANTHROPIC_|AWS_|AZURE_|GOOGLE_|GITHUB_|GH_|NODE_OPTIONS$|LD_|DYLD_|BASH_ENV$|ENV$|PATH$|HOME$|SHELL$|PYTHONPATH$|RUBYOPT$)")


def canonical(value):
    # The wire profile uses ECMAScript UTF-16 key ordering and safe integers only.
    def normalize(item):
        if item is None or isinstance(item, (str, bool)):
            return item
        if isinstance(item, int) and abs(item) <= 9007199254740991:
            return item
        if isinstance(item, list):
            return [normalize(child) for child in item]
        if isinstance(item, dict) and all(isinstance(key, str) for key in item):
            return {key: normalize(item[key]) for key in sorted(item, key=lambda name: name.encode("utf-16-be", errors="surrogatepass"))}
        raise ValueError("unsupported_canonical_value")
    return json.dumps(normalize(value), separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def check_root():
    if os.geteuid() != 0:
        raise ValueError("protected_controller_requires_root")


def protected_path(path, directory=False):
    """Reject mutable ancestors and symlink substitution before privileged reads."""
    path = pathlib.Path(path)
    if not path.is_absolute():
        raise ValueError("protected_path_must_be_absolute")
    for part in [*reversed(path.parents), path]:
        info = os.lstat(part)
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError("unprotected_path")
    info = os.lstat(path)
    if directory and not stat.S_ISDIR(info.st_mode):
        raise ValueError("protected_directory_required")
    return path


def read_protected(path, maximum=MAX_FRAME):
    protected_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_size > maximum:
            raise ValueError("unprotected_or_oversized_file")
        data = os.read(fd, maximum + 1)
        if len(data) > maximum:
            raise ValueError("protected_file_too_large")
        return json.loads(data)
    finally:
        os.close(fd)


def durable(path, value, immutable=False):
    path = pathlib.Path(path)
    protected_path(path.parent, directory=True)
    data = canonical(value)
    if immutable and path.exists():
        if canonical(read_protected(path)) != data:
            raise ValueError("immutable_receipt_conflict")
        return
    temporary = path.parent / (path.name + "." + str(uuid.uuid4()) + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise ValueError("protected_write_incomplete")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def config(path=CONFIG):
    value = read_protected(path)
    expected = {"version", "nativeUid", "nativeGid", "nativeHome", "codexBinary", "workRoot", "controlRoot", "runnerDirectory", "helperDirectory", "path"}
    if set(value) != expected or value["version"] != VERSION or not isinstance(value["nativeUid"], int) or value["nativeUid"] <= 0 or value["nativeGid"] <= 0:
        raise ValueError("invalid_supervisor_config")
    for name in ["workRoot", "controlRoot", "runnerDirectory", "helperDirectory"]:
        protected_path(value[name], directory=True)
    if not os.path.isabs(value["codexBinary"]) or not os.path.isabs(value["nativeHome"]):
        raise ValueError("absolute_native_paths_required")
    return value


def paths(settings, invocation):
    if not ID.fullmatch(invocation) or ":" in invocation:
        raise ValueError("invalid_invocation_identity")
    root = pathlib.Path(settings["controlRoot"])
    return root / "requests" / (invocation + ".json"), root / "scopes" / invocation, root / "sockets" / (invocation + ".sock")


def peer(sock):
    return struct.unpack("3i", sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))


def send(sock, value, descriptors=()):
    data = canonical(value)
    if len(data) > MAX_FRAME:
        raise ValueError("supervisor_frame_too_large")
    ancillary = [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", descriptors))] if descriptors else []
    sock.sendmsg([data], ancillary)


def receive(sock, expected_fds=0):
    data, ancillary, flags, _ = sock.recvmsg(MAX_FRAME + 1, socket.CMSG_SPACE(16 * 4))
    fds = []
    for level, kind, payload in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            values = array.array("i")
            values.frombytes(payload[: len(payload) - len(payload) % values.itemsize])
            fds.extend(values)
    try:
        if len(data) > MAX_FRAME or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or len(fds) != expected_fds:
            raise ValueError("invalid_supervisor_frame")
        value = json.loads(data)
        if value.get("version") != VERSION:
            raise ValueError("unsupported_supervisor_protocol")
        if "error" in value:
            raise ValueError(str(value["error"]))
        return value, fds
    except Exception:
        for fd in fds:
            os.close(fd)
        raise


def manager(invocation):
    unit = "agents-assemble-keeper@" + invocation + ".service"
    output = subprocess.check_output(["/usr/bin/systemctl", "show", unit, "--property=InvocationID,MainPID,ControlGroup,Restart,Delegate,KillMode"], timeout=10, env={"PATH": "/usr/bin:/bin", "LANG": "C"}).decode()
    value = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
    if value.get("Restart") != "no" or value.get("Delegate") != "yes" or value.get("KillMode") != "control-group" or not re.fullmatch("[a-f0-9]{32}", value.get("InvocationID", "")):
        raise ValueError("unqualified_manager_profile")
    return {"unit": unit, "activationId": value["InvocationID"], "pid": int(value["MainPID"]), "cgroup": value["ControlGroup"]}


def authorize_launch(settings, command):
    """The keeper obtains fresh exact authority independently of the requesting process."""
    runner = read_protected(pathlib.Path(settings["runnerDirectory"]) / "config.json")
    for name in ["privateKeyFile", "certificateFile", "caFile"]:
        protected_path(runner[name])
        info = os.lstat(runner[name])
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ValueError("unprotected_runner_credential")
    parsed = urlsplit(runner["serviceUrl"])
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("invalid_control_plane_url")
    tls = ssl.create_default_context(cafile=runner["caFile"])
    tls.minimum_version = ssl.TLSVersion.TLSv1_3
    tls.load_cert_chain(runner["certificateFile"], runner["privateKeyFile"])
    operation = command["commandId"] + ".protected-launch"
    body = {"version": "aa-runner/1", "commandId": command["commandId"], "scope": command["scope"], "payloadDigest": command["payloadDigest"]}
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, context=tls, timeout=10)
    start = time.monotonic()
    try:
        connection.request("POST", "/api/v1/runner/authorize-launch", canonical(body), {"Content-Type": "application/json", "Idempotency-Key": operation})
        response = connection.getresponse()
        data = response.read(MAX_FRAME + 1)
        if response.status != 200 or len(data) > MAX_FRAME:
            raise ValueError("protected_launch_authority_unavailable")
        result = json.loads(data)
    finally:
        connection.close()
    for key in ["commandId", "scope", "payloadDigest"]:
        if result.get(key) != body[key]:
            raise ValueError("protected_launch_authority_mismatch")
    if result.get("authorized") is not True:
        raise ValueError("protected_launch_not_authorized")
    import datetime
    server_time = datetime.datetime.fromisoformat(result["serverTime"].replace("Z", "+00:00")).timestamp()
    expiry = datetime.datetime.fromisoformat(result["expiresAt"].replace("Z", "+00:00")).timestamp()
    command_expiry = datetime.datetime.fromisoformat(command["expiresAt"].replace("Z", "+00:00")).timestamp()
    latency = time.monotonic() - start
    remaining = expiry - server_time - latency
    if remaining <= 0 or remaining > 5 or expiry > command_expiry or command_expiry - server_time > 604800:
        raise ValueError("protected_launch_authority_expired")
    return time.monotonic() + remaining, time.monotonic() + command_expiry - server_time - latency


def native_environment(settings, request, variables):
    declared = request["command"]["payload"]["environment"]
    permitted = set(declared["variables"]) | {binding["name"] for binding in declared["secretBindings"]}
    if set(variables) != permitted or any(FORBIDDEN_ENV.match(name) for name in variables):
        raise ValueError("protected_environment_binding_mismatch")
    if any(variables.get(name) != value for name, value in declared["variables"].items()):
        raise ValueError("protected_environment_value_mismatch")
    return {"PATH": settings["path"], "HOME": settings["nativeHome"], "USER": str(settings["nativeUid"]), "LANG": "C.UTF-8", **variables}


class Keeper:
    def __init__(self, settings, invocation):
        check_root()
        self.settings = settings
        self.invocation = invocation
        request_path, self.root, self.socket_path = paths(settings, invocation)
        self.request = read_protected(request_path)
        if set(self.request) != {"version", "command", "environmentNames"} or self.request["version"] != VERSION:
            raise ValueError("invalid_protected_launch_request")
        command = self.request["command"]
        names = self.request["environmentNames"]
        declared = command["payload"]["environment"]
        if not isinstance(names, list) or len(set(names)) != len(names) or set(names) != set(declared["variables"]) | {binding["name"] for binding in declared["secretBindings"]}:
            raise ValueError("protected_environment_names_mismatch")
        if command["kind"] != "start" or command["scope"]["invocationId"] != invocation or digest(command["payload"]) != command["payloadDigest"]:
            raise ValueError("protected_binding_mismatch")
        self.root.mkdir(mode=0o700, exist_ok=False)
        self.manager = manager(invocation)
        cgroup = next((line.split("::", 1)[1] for line in pathlib.Path("/proc/self/cgroup").read_text().splitlines() if line.startswith("0::")), None)
        if self.manager["pid"] != os.getpid() or cgroup != self.manager["cgroup"]:
            raise ValueError("keeper_activation_mismatch")
        self.payload = pathlib.Path("/sys/fs/cgroup" + cgroup) / "payload"
        self.payload.mkdir(mode=0o700, exist_ok=False)
        self.events_fd = os.open(self.payload / "cgroup.events", os.O_RDONLY | os.O_CLOEXEC)
        self.kill_fd = os.open(self.payload / "cgroup.kill", os.O_WRONLY | os.O_CLOEXEC)
        info = os.fstat(self.events_fd)
        self.binding = {"scope": command["scope"], "commandId": command["commandId"], "payloadDigest": command["payloadDigest"], "manager": self.manager, "bootId": pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "object": {"device": info.st_dev, "inode": info.st_ino}, "incarnation": str(uuid.uuid4()), "profile": "authenticated_scope_only"}
        self.state = {"version": VERSION, "binding": self.binding, "bindingDigest": digest(self.binding), "sequence": 1, "launchState": "never_started", "gateClosed": False}
        self.native = None
        self.deadline = None
        durable(self.root / "state.json", self.state)

    def continuity(self):
        if canonical(read_protected(self.root / "state.json")) != canonical(self.state) or manager(self.invocation) != self.manager:
            raise ValueError("scope_unknown_custody_or_journal_discontinuity")

    def transition(self, **fields):
        self.continuity()
        self.state = {**self.state, **fields, "sequence": self.state["sequence"] + 1}
        durable(self.root / "state.json", self.state)

    def stop(self, reason):
        if not self.state["gateClosed"]:
            self.transition(gateClosed=True, stopReason=reason)
        os.lseek(self.kill_fd, 0, os.SEEK_SET)
        os.write(self.kill_fd, b"1")

    def dispatch(self, connection):
        if peer(connection)[1] != 0:
            raise ValueError("untrusted_observer_peer")
        value, _ = receive(connection)
        if value.get("bindingDigest") != self.state["bindingDigest"]:
            raise ValueError("protected_binding_mismatch")
        self.continuity()
        operation = value.get("operation")
        if operation == "launch":
            if self.state["gateClosed"] or self.state["launchState"] != "never_started":
                raise ValueError("native_launch_already_used_or_closed")
            fresh_until, self.deadline = authorize_launch(self.settings, self.request["command"])
            environment = native_environment(self.settings, self.request, value.get("environment", {}))
            self.transition(launchState="outcome_unknown")
            procs_fd = os.open(self.payload / "cgroup.procs", os.O_WRONLY | os.O_CLOEXEC)
            def prepare():
                os.write(procs_fd, str(os.getpid()).encode())
                os.close(procs_fd)
                os.setgroups([])
                os.setgid(self.settings["nativeGid"])
                os.setuid(self.settings["nativeUid"])
                if ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) != 0:
                    os._exit(126)
                os.umask(0o077)
                os.chdir(pathlib.Path(self.settings["workRoot"]) / self.invocation / "worktree")
            try:
                if time.monotonic() >= fresh_until:
                    raise ValueError("protected_launch_authority_expired")
                self.native = subprocess.Popen([self.settings["codexBinary"], "app-server", "--stdio"], env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, preexec_fn=prepare, pass_fds=(procs_fd,))
            finally:
                os.close(procs_fd)
            self.transition(launchState="launched", nativePid=self.native.pid)
            send(connection, {"version": VERSION, "status": "launched", "bindingDigest": self.state["bindingDigest"]}, (self.native.stdin.fileno(), self.native.stdout.fileno()))
            self.native.stdin.close()
            self.native.stdout.close()
        elif operation == "stop":
            self.stop("explicit_stop")
            send(connection, {"version": VERSION, "status": "gate_closed", "state": self.state})
        elif operation == "observe":
            if not self.state["gateClosed"]:
                raise ValueError("scope_unknown_launch_gate_open")
            send(connection, {"version": VERSION, "status": "retained_scope", "state": self.state}, (self.events_fd,))
        elif operation == "status":
            send(connection, {"version": VERSION, "status": "retained_scope", "state": self.state})
        else:
            raise ValueError("unsupported_supervisor_operation")

    def run(self):
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        listener.bind(str(self.socket_path))
        os.chmod(self.socket_path, 0o600)
        listener.listen(8)
        listener.settimeout(1)
        while True:
            if self.deadline is not None and time.monotonic() >= self.deadline and not self.state["gateClosed"]:
                self.stop("grant_expired")
            try:
                connection, _ = listener.accept()
            except socket.timeout:
                continue
            with connection:
                connection.settimeout(15)
                try:
                    self.dispatch(connection)
                except Exception as error:
                    send(connection, {"version": VERSION, "error": str(error) if isinstance(error, ValueError) else "scope_unknown"})


def connect(settings, invocation, operation, environment=None, expected_fds=0):
    _, root, socket_path = paths(settings, invocation)
    state = read_protected(root / "state.json")
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    connection.settimeout(20)
    connection.connect(str(socket_path))
    actual_peer = peer(connection)
    if actual_peer[1] != 0 or actual_peer[0] != state["binding"]["manager"]["pid"]:
        connection.close()
        raise ValueError("scope_unknown_observer_peer_changed")
    request = {"version": VERSION, "operation": operation, "bindingDigest": state["bindingDigest"]}
    if environment is not None:
        request["environment"] = environment
    send(connection, request)
    result, fds = receive(connection, expected_fds)
    connection.close()
    return result, fds


def report(settings, invocation, operation_id):
    if not ID.fullmatch(operation_id):
        raise ValueError("invalid_receipt_identity")
    _, root, _ = paths(settings, invocation)
    receipt_path = root / ("receipt-" + operation_id + ".json")
    if receipt_path.exists():
        return read_protected(receipt_path)
    state = read_protected(root / "state.json")
    observed, fds = connect(settings, invocation, "observe", expected_fds=1)
    fd = fds[0]
    try:
        if observed["state"] != state or not state["gateClosed"] or manager(invocation) != state["binding"]["manager"]:
            raise ValueError("scope_unknown_retained_binding_changed")
        info = os.fstat(fd)
        if {"device": info.st_dev, "inode": info.st_ino} != state["binding"]["object"]:
            raise ValueError("scope_unknown_descriptor_substitution")
        # fstatfs verifies that a root peer did not hand over an unrelated regular file.
        fs = ctypes.create_string_buffer(256)
        if ctypes.CDLL(None, use_errno=True).fstatfs(fd, fs) != 0 or struct.unpack_from("l", fs.raw)[0] != 0x63677270:
            raise ValueError("scope_unknown_not_cgroup_v2")
        deadline = time.monotonic() + 10
        while True:
            os.lseek(fd, 0, os.SEEK_SET)
            events = os.read(fd, 4096).decode("ascii")
            populated = dict(line.split() for line in events.splitlines()).get("populated")
            if populated == "0" or time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        if populated not in ["0", "1"]:
            raise ValueError("scope_unknown_invalid_cgroup_events")
        status = "writers_remaining" if populated == "1" else "never_started" if state["launchState"] == "never_started" else "contained_local_processes_stopped"
        receipt = {"version": VERSION, "receiptId": operation_id, "bindingDigest": state["bindingDigest"], "binding": state["binding"], "journalSequence": state["sequence"], "status": status, "eventsDigest": hashlib.sha256(events.encode()).hexdigest(), "populated": populated == "1", "gateClosed": True, "writerCoverage": "incomplete", "automaticTakeover": False, "observationProfile": "authenticated_scope_only"}
        durable(receipt_path, receipt, immutable=True)
        return receipt
    finally:
        os.close(fd)


def proxy(settings, invocation):
    request_path, _, _ = paths(settings, invocation)
    request = read_protected(request_path)
    environment = {name: os.environ[name] for name in request["environmentNames"] if name in os.environ}
    _, fds = connect(settings, invocation, "launch", environment, expected_fds=2)
    input_fd, output_fd = fds
    active = [sys.stdin.fileno(), output_fd]
    try:
        while output_fd in active:
            ready, _, _ = select.select(active, [], [])
            for fd in ready:
                data = os.read(fd, 65536)
                if not data:
                    active.remove(fd)
                    if fd == sys.stdin.fileno():
                        os.close(input_fd)
                        input_fd = -1
                    continue
                destination = input_fd if fd == sys.stdin.fileno() else sys.stdout.fileno()
                view = memoryview(data)
                while view:
                    written = os.write(destination, view)
                    view = view[written:]
    finally:
        if input_fd >= 0:
            os.close(input_fd)
        os.close(output_fd)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["keeper", "proxy", "stop", "report", "status", "diagnose"])
    parser.add_argument("--instance")
    parser.add_argument("--receipt-id")
    parser.add_argument("--config", default=CONFIG)
    args = parser.parse_args()
    if args.operation == "diagnose":
        print(json.dumps({"version": VERSION, "root": os.geteuid() == 0, "cgroupV2": pathlib.Path("/sys/fs/cgroup/cgroup.controllers").exists(), "writerCoverage": "incomplete", "automaticTakeover": False, "qualification": "opt_in_required"}))
        return
    check_root()
    settings = config(args.config)
    if not args.instance:
        raise ValueError("invocation_identity_required")
    if args.operation == "keeper":
        Keeper(settings, args.instance).run()
    elif args.operation == "proxy":
        proxy(settings, args.instance)
    elif args.operation == "report":
        print(json.dumps(report(settings, args.instance, args.receipt_id or str(uuid.uuid4()))))
    else:
        value, _ = connect(settings, args.instance, args.operation)
        print(json.dumps(value))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"version": VERSION, "error": str(error) if isinstance(error, ValueError) else "scope_unknown", "writerCoverage": "incomplete", "automaticTakeover": False}), file=sys.stderr)
        sys.exit(1)
