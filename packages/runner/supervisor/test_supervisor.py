"""Unprivileged protocol tests; never manufacture successful kernel-scope evidence."""
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch
import supervisor


class ProtocolTests(unittest.TestCase):
    def test_descriptor_transfer_preserves_original_open_object(self):
        sender, receiver = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "object"
            original.write_bytes(b"original")
            descriptor = os.open(original, os.O_RDONLY)
            original.unlink()
            original.write_bytes(b"replacement")
            try:
                supervisor.send(sender, {"version": supervisor.VERSION, "status": "unit_test_only"}, [descriptor])
                value, descriptors = supervisor.receive(receiver, 1)
                self.assertEqual(value["status"], "unit_test_only")
                transferred = descriptors[0]
                try:
                    self.assertEqual(os.fstat(descriptor).st_ino, os.fstat(transferred).st_ino)
                    self.assertEqual(os.read(transferred, 32), b"original")
                    self.assertNotEqual(os.stat(original).st_ino, os.fstat(transferred).st_ino)
                finally:
                    os.close(transferred)
            finally:
                os.close(descriptor)
                sender.close()
                receiver.close()

    def test_protocol_rejects_unexpected_descriptor_and_version(self):
        sender, receiver = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        descriptor = os.open("/dev/null", os.O_RDONLY)
        try:
            supervisor.send(sender, {"version": supervisor.VERSION}, [descriptor])
            with self.assertRaisesRegex(ValueError, "invalid_supervisor_frame"):
                supervisor.receive(receiver)
            supervisor.send(sender, {"version": "unsupported"})
            with self.assertRaisesRegex(ValueError, "unsupported_supervisor_protocol"):
                supervisor.receive(receiver)
        finally:
            os.close(descriptor)
            sender.close()
            receiver.close()

    def test_environment_requires_exact_declared_values_and_no_control_credentials(self):
        settings = {"path": "/usr/bin:/bin", "nativeHome": "/home/native", "nativeUid": 1000}
        request = {"command": {"payload": {"environment": {"variables": {"FEATURE": "selected"}, "secretBindings": [{"name": "BUILD_TOKEN"}]}}}}
        env = supervisor.native_environment(settings, request, {"FEATURE": "selected", "BUILD_TOKEN": "local-secret"})
        self.assertEqual(env["HOME"], "/home/native")
        self.assertNotIn("AA_RUNNER_KEY", env)
        for values in [{"FEATURE": "changed", "BUILD_TOKEN": "secret"}, {"FEATURE": "selected"}, {"FEATURE": "selected", "BUILD_TOKEN": "secret", "AA_RUNNER_KEY": "forbidden"}]:
            with self.assertRaises(ValueError):
                supervisor.native_environment(settings, request, values)

    def test_protected_reads_reject_user_owned_or_mutable_path(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text("{}")
            with self.assertRaisesRegex(ValueError, "unprotected_path"):
                supervisor.read_protected(path)
            link = Path(directory) / "link"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                supervisor.read_protected(link)

    def test_non_root_peer_cannot_reach_binding_or_launch(self):
        keeper = object.__new__(supervisor.Keeper)
        with patch.object(supervisor, "peer", return_value=(123, 1000, 1000)):
            with self.assertRaisesRegex(ValueError, "untrusted_observer_peer"):
                keeper.dispatch(None)

    def test_used_or_closed_launch_gate_rejects_before_authorization(self):
        for launch_state, closed in [("launched", False), ("outcome_unknown", False), ("never_started", True)]:
            keeper = object.__new__(supervisor.Keeper)
            keeper.state = {"bindingDigest": "same", "gateClosed": closed, "launchState": launch_state}
            keeper.continuity = lambda: None
            with patch.object(supervisor, "peer", return_value=(123, 0, 0)), patch.object(supervisor, "receive", return_value=({"operation": "launch", "bindingDigest": "same"}, [])), patch.object(supervisor, "authorize_launch") as authority:
                with self.assertRaisesRegex(ValueError, "native_launch_already_used_or_closed"):
                    keeper.dispatch(None)
                authority.assert_not_called()

    def test_scope_and_receipt_paths_cannot_escape(self):
        for invocation in ["../other", "bad/instance", "bad:instance", "", "a" * 161]:
            with self.assertRaisesRegex(ValueError, "invalid_invocation_identity"):
                supervisor.paths({"controlRoot": "/var/lib/protected"}, invocation)


if __name__ == "__main__":
    unittest.main()
