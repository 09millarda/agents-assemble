"""Independent raw HTTPS client for boundary probes; no fixture auth/client code."""

import http.client
import json
import ssl
from pathlib import Path


def compact(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")


class RawSession:
    def __init__(self, host, port, ca, cert=None, key=None, *, check_hostname=True):
        context = ssl.create_default_context(cafile=str(ca))
        context.check_hostname = check_hostname
        if cert is not None:
            context.load_cert_chain(str(cert), str(key))
        self.connection = http.client.HTTPSConnection(host, port, context=context, timeout=10)

    def request(self, method, path, body=b"", headers=None):
        headers = {"Content-Type": "application/json", **(headers or {})}
        try:
            self.connection.request(method, path, body=body, headers=headers)
            response = self.connection.getresponse()
            sock = self.connection.sock
            local_port = sock.getsockname()[1] if sock is not None else None
            protocol = sock.version() if sock is not None else None
            data = response.read()
            try:
                payload = json.loads(data)
            except (ValueError, UnicodeDecodeError):
                payload = data.decode("utf-8", "replace")
            return {"status": response.status, "body": payload, "local_port": local_port, "tls": protocol}
        except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
            return {"status": None, "error_type": type(exc).__name__, "error": str(exc)}

    def close(self):
        self.connection.close()


class Results:
    def __init__(self):
        self.cases = []

    def record(self, name, expected, actual, ok, *, note=None):
        row = {"case": name, "expected": expected, "actual": actual, "passed": bool(ok)}
        if note:
            row["note"] = note
        self.cases.append(row)
        print(("PASS " if ok else "FAIL ") + name, flush=True)
        return ok

    def save(self, destination):
        result = {
            "method": "Independent Python standard-library HTTPS client; actual local mTLS boundary",
            "passed": sum(case["passed"] for case in self.cases),
            "failed": sum(not case["passed"] for case in self.cases),
            "cases": self.cases,
        }
        Path(destination).write_text(json.dumps(result, indent=2) + "\n")
        return result
