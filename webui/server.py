from __future__ import annotations

import argparse
import json
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .config import settings
from .service import QueryServiceError, RadbService


class WebUIRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, service: RadbService, directory: str, **kwargs):
        self.service = service
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/schema":
            self._send_json(HTTPStatus.OK, {"ok": True, **self.service.schema_payload()})
            return

        if parsed.path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "database_path": str(self.service.db_path),
                },
            )
            return

        if parsed.path == "/":
            self.path = "/index.html"

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/run":
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid JSON request body"})
            return

        try:
            result = self.service.execute_query(str(payload.get("query", "")))
        except QueryServiceError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
            return

        self._send_json(HTTPStatus.OK, {"ok": True, **result})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        return

    def _send_json(self, status: HTTPStatus, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_server(host: str, port: int, db_path: Path) -> int:
    service = RadbService(db_path)
    handler = partial(
        WebUIRequestHandler,
        service=service,
        directory=str(settings.static_dir),
    )
    server = ThreadingHTTPServer((host, port), handler)

    print(f"radb web UI listening on http://{host}:{port}")
    print(f"Using database: {service.db_path}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping radb web UI")
    finally:
        server.server_close()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the radb local web UI.")
    parser.add_argument("--host", default=settings.host, help=f"host to bind (default: {settings.host})")
    parser.add_argument("--port", type=int, default=settings.port, help=f"port to bind (default: {settings.port})")
    parser.add_argument(
        "--db-path",
        default=str(settings.db_path),
        help=f"SQLite database path (default: {settings.db_path})",
    )
    args = parser.parse_args()

    return run_server(args.host, args.port, Path(args.db_path).expanduser())


if __name__ == "__main__":
    raise SystemExit(main())
