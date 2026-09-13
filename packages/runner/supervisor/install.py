#!/usr/bin/python3
"""Install the optional root-owned observer. Does not enroll or claim qualification."""
import argparse
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
from supervisor import VERSION, durable, protected_path, check_root


def unit_quote(value):
    if any(char in value for char in "\n\r\0"):
        raise ValueError("invalid_service_argument")
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def install_file(source, target, mode):
    target = Path(target)
    if target.exists() and (target.is_symlink() or target.stat().st_uid != 0):
        raise ValueError("unprotected_install_destination")
    data = Path(source).read_bytes()
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(target, mode)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-user", required=True)
    parser.add_argument("--codex", required=True)
    parser.add_argument("--cli", required=True, help="Built apps/runner/dist/cli.js")
    parser.add_argument("--node", default="/usr/bin/node")
    parser.add_argument("--path", default="/usr/local/bin:/usr/bin:/bin")
    args = parser.parse_args()
    check_root()
    user = pwd.getpwnam(args.native_user)
    if user.pw_uid <= 0 or user.pw_gid <= 0:
        raise ValueError("ordinary_native_identity_required")
    codex = str(Path(args.codex).resolve(strict=True))
    node = str(Path(args.node).resolve(strict=True))
    protected_path(node)
    if not os.access(codex, os.X_OK) or not os.access(node, os.X_OK):
        raise ValueError("native_and_node_executables_required")
    roots = {"configuration": "/etc/agents-assemble", "helperDirectory": "/opt/agents-assemble/supervisor", "application": "/opt/agents-assemble/runner", "workRoot": "/var/lib/agents-assemble-workspaces", "controlRoot": "/var/lib/agents-assemble-supervisor", "runnerDirectory": "/var/lib/agents-assemble-runner"}
    # A fresh root-owned enrollment is required. Moving a still-valid user-owned key does not establish custody.
    if (Path(roots["runnerDirectory"]) / "config.json").exists():
        raise ValueError("existing_runner_requires_explicit_upgrade_review")
    for key, name in roots.items():
        Path(name).mkdir(mode=0o711 if key == "workRoot" else 0o700, parents=True, exist_ok=True)
        protected_path(name, directory=True)
        os.chmod(name, 0o711 if key == "workRoot" else 0o700)
    for child in ["requests", "scopes", "sockets"]:
        path = Path(roots["controlRoot"]) / child
        path.mkdir(mode=0o700, exist_ok=True)
        protected_path(path, directory=True)
    helper = Path(__file__).resolve().parent / "supervisor.py"
    install_file(helper, Path(roots["helperDirectory"]) / "supervisor.py", 0o700)
    install_file(args.cli, Path(roots["application"]) / "aa.mjs", 0o600)
    settings = {"version": VERSION, "nativeUid": user.pw_uid, "nativeGid": user.pw_gid, "nativeHome": user.pw_dir, "codexBinary": codex, "workRoot": roots["workRoot"], "controlRoot": roots["controlRoot"], "runnerDirectory": roots["runnerDirectory"], "helperDirectory": roots["helperDirectory"], "path": args.path}
    durable(Path(roots["configuration"]) / "supervisor.json", settings)
    keeper = """[Unit]
Description=Agents Assemble retained scoped observer %i
After=network-online.target

[Service]
Type=exec
ExecStart=/usr/bin/python3 /opt/agents-assemble/supervisor/supervisor.py keeper --instance %i
Restart=no
Delegate=yes
KillMode=control-group
TimeoutStopSec=15
SendSIGKILL=yes
UMask=0077
NoNewPrivileges=yes

"""
    controller = f"""[Unit]
Description=Agents Assemble protected runner controller
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
ExecStart={unit_quote(node)} /opt/agents-assemble/runner/aa.mjs daemon run --directory /var/lib/agents-assemble-runner
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=yes
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
"""
    for name, content in [("agents-assemble-keeper@.service", keeper), ("agents-assemble-protected.service", controller)]:
        path = Path("/etc/systemd/system") / name
        protected_path(path.parent, directory=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
        with os.fdopen(descriptor, "w", encoding="utf8") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(path, 0o644)
    subprocess.run(["/usr/bin/systemctl", "daemon-reload"], check=True)
    print(json.dumps({"installed": True, "enrolled": False, "qualification": "opt_in_required", "writerCoverage": "incomplete", "automaticTakeover": False, "next": "Run the installed CLI as root: enroll --protected --directory /var/lib/agents-assemble-runner --service https://HOST:3443 --ca /root/service-ca.pem --token-stdin. Then daemon start with the same directory."}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else "protected_install_failed", file=sys.stderr)
        sys.exit(1)
