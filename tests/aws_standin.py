"""A small local stand-in for the two AWS APIs SIAGA calls at run time, speaking their wire
protocol so the real boto3 clients can be pointed at it (tests and e2e runs, no AWS account):

- Lambda `Invoke`: POST /2015-03-31/functions/{name}/invocations -> runs the real solver
  handler (services/solver/lambda_handler.py) on the event.
- S3: PUT object (refuses to overwrite: what Object Lock + SIAGA's one-object-per-entry
  layout guarantee), GET object, HEAD object (with Object Lock headers), ListObjectsV2,
  GetObjectLockConfiguration.

    uv run python -m tests.aws_standin --port 4599
    AWS_ENDPOINT_URL_S3=http://127.0.0.1:4599 AWS_ENDPOINT_URL_LAMBDA=http://127.0.0.1:4599 ...

Not a general emulator: only what the S3 audit writer, the Lambda solver and preflight use.
"""

from __future__ import annotations

import argparse
import json
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse
from xml.sax.saxutils import escape

LAMBDA_PREFIX = "/2015-03-31/functions/"


class Store:
    def __init__(self, functions: tuple[str, ...] = ("siaga-solver",)):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.headers: dict[tuple[str, str], dict[str, str]] = {}
        self.functions = set(functions)
        self.invocations: list[dict] = []
        self.lock = threading.Lock()


def make_handler(store: Store):
    class Handler(BaseHTTPRequestHandler):
        # HTTP/1.1 answers botocore's "Expect: 100-continue" at once, as S3 does (HTTP/1.0
        # makes every PUT wait a second for it)
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):  # quiet
            pass

        def _send(self, code: int, body: bytes = b"", ctype: str = "application/xml",
                  headers: dict[str, str] | None = None) -> None:  # fmt: skip
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            headers = headers or {}
            if "Content-Length" not in headers:
                self.send_header("Content-Length", str(len(body)))
            for k, v in headers.items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _s3_error(self, code: int, name: str) -> None:
            xml = f"<Error><Code>{name}</Code><Message>{name}</Message></Error>".encode()
            self._send(code, xml)

        def _body(self) -> bytes:
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def _split(self) -> tuple[str, str, dict[str, list[str]]]:
            u = urlparse(self.path)
            parts = u.path.lstrip("/").split("/", 1)
            bucket = unquote(parts[0])
            key = unquote(parts[1]) if len(parts) > 1 else ""
            return bucket, key, parse_qs(u.query, keep_blank_values=True)

        # ------------------------------------------------------------- Lambda
        def do_POST(self):  # noqa: N802
            if not self.path.startswith(LAMBDA_PREFIX):
                return self._s3_error(400, "NotImplemented")
            name = unquote(self.path[len(LAMBDA_PREFIX) :].split("/", 1)[0])
            event = json.loads(self._body() or b"{}")
            if name not in store.functions:
                body = json.dumps({"Type": "User", "message": f"Function not found: {name}"})
                return self._send(404, body.encode(), "application/json",
                                  {"x-amzn-ErrorType": "ResourceNotFoundException"})  # fmt: skip
            from services.solver.lambda_handler import handler

            with store.lock:
                store.invocations.append(event)
            out = json.dumps(handler(event)).encode()
            self._send(200, out, "application/json", {"X-Amz-Executed-Version": "$LATEST"})

        # ------------------------------------------------------------- S3
        def do_PUT(self):  # noqa: N802
            bucket, key, _ = self._split()
            body = self._body()
            with store.lock:
                if (bucket, key) in store.objects:
                    return self._s3_error(409, "ObjectAlreadyExists")
                store.objects[(bucket, key)] = body
                store.headers[(bucket, key)] = {k.lower(): v for k, v in self.headers.items()}
            self._send(200, b"", headers={"ETag": '"standin"'})

        def do_HEAD(self):  # noqa: N802
            bucket, key, _ = self._split()
            if (bucket, key) not in store.objects:
                return self._send(404)
            until = (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            self._send(200, b"", "application/json", {
                "x-amz-object-lock-mode": "GOVERNANCE",
                "x-amz-object-lock-retain-until-date": until,
                "Content-Length": str(len(store.objects[(bucket, key)])),
            })  # fmt: skip

        def do_GET(self):  # noqa: N802
            bucket, key, q = self._split()
            if key:
                body = store.objects.get((bucket, key))
                return self._send(200, body, "application/json") if body is not None else (
                    self._s3_error(404, "NoSuchKey"))  # fmt: skip
            if "object-lock" in q:
                xml = ("<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled>"
                       "<Rule><DefaultRetention><Mode>GOVERNANCE</Mode><Days>1</Days>"
                       "</DefaultRetention></Rule></ObjectLockConfiguration>")  # fmt: skip
                return self._send(200, xml.encode())
            prefix = (q.get("prefix") or [""])[0]
            keys = sorted(k for b, k in store.objects if b == bucket and k.startswith(prefix))
            contents = "".join(
                f"<Contents><Key>{escape(k)}</Key><Size>{len(store.objects[(bucket, k)])}</Size>"
                "</Contents>"
                for k in keys
            )
            xml = (f"<ListBucketResult><Name>{escape(bucket)}</Name><Prefix>{escape(prefix)}"
                   f"</Prefix><KeyCount>{len(keys)}</KeyCount><IsTruncated>false</IsTruncated>"
                   f"{contents}</ListBucketResult>")  # fmt: skip
            self._send(200, xml.encode())

    return Handler


def serve(port: int = 0, store: Store | None = None) -> tuple[ThreadingHTTPServer, Store]:
    store = store or Store()
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(store))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, store


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4599)
    args = ap.parse_args()
    server, _ = serve(args.port)
    print(f"AWS stand-in (S3 + Lambda) on http://127.0.0.1:{server.server_port}", flush=True)
    threading.Event().wait()
