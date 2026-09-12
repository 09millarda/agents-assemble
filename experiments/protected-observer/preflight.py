#!/usr/bin/env python3
"""Throwaway, read-only prerequisite probe for decision #11; no conformance claim."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess


def command(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=15)
        return {"argv": argv, "exit_code": result.returncode,
                "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"argv": argv, "error": str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="preflight.json")
    args = parser.parse_args()
    checks = {
        "sudo_noninteractive": command(["sudo", "-n", "true"]),
        "systemd": command(["systemctl", "--version"]),
        "user_manager": command(["systemctl", "--user", "show", "--property=Version"]),
        "codex_version": command(["codex", "--version"]),
        "openssl": command(["openssl", "version"]),
    }
    root_available = os.geteuid() == 0 or checks["sudo_noninteractive"].get("exit_code") == 0
    result = {
        "kind": "prerequisite_observations_only",
        "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "kernel": platform.release(), "python": platform.python_version(),
        "uid": os.getuid(), "euid": os.geteuid(), "gid": os.getgid(),
        "tools": {name: shutil.which(name) for name in
                  ["systemd-run", "setpriv", "unshare", "newuidmap", "aa-exec", "codex"]},
        "cgroup_v2_present": Path("/sys/fs/cgroup/cgroup.controllers").is_file(),
        "checks": checks,
        "next_gate": "operator_environment_review" if root_available else "administrative_access_required",
        "not_exercised": ["separate_principal_denials", "protected_observer_interface",
                          "native_login_compatibility", "native_launch_stop",
                          "observer_restart", "retained_scope_continuity",
                          "authenticated_receipt", "complete_writer_coverage"],
        "conformance_passed": False,
        "automatic_takeover_eligible": False,
    }
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": args.output, "next_gate": result["next_gate"],
                      "conformance_passed": False}))


if __name__ == "__main__":
    main()
