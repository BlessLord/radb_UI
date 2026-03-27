from __future__ import annotations

import argparse
import cgi
import json
import secrets
from dataclasses import dataclass
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse

from .config import settings
from .service import QueryServiceError, RadbService


SESSION_COOKIE_NAME = "radb_webui_session"
UPLOAD_FORM_FIELD = "database"
UPLOAD_OVERHEAD_BYTES = 64 * 1024


@dataclass
class _SessionState:
    active_kind: str = "sample"
    uploaded_name: str | None = None
    uploaded_path: Path | None = None
    service: RadbService | None = None


class _DatabaseSessionStore:
    def __init__(self, sample_db_path: Path, upload_dir: Path, max_upload_bytes: int):
        self.sample_db_path = sample_db_path.resolve()
        self.upload_dir = upload_dir.resolve()
        self.max_upload_bytes = max_upload_bytes
        self.upload_dir.mkdir(parents=True, exist_ok=True)

        self._lock = Lock()
        self._sessions: dict[str, _SessionState] = {}

    def schema_payload(self, session_id: str) -> dict:
        with self._lock:
            state = self._state(session_id)
            service = self._service_for_state(state)
            payload = service.schema_payload()
            payload.update(self._database_metadata(state))
            return payload

    def execute_query(self, session_id: str, query: str) -> dict:
        with self._lock:
            state = self._state(session_id)
            service = self._service_for_state(state)
            return service.execute_query(query)

    def use_sample_database(self, session_id: str) -> dict:
        with self._lock:
            state = self._state(session_id)
            self._close_service(state)
            state.active_kind = "sample"
            service = self._service_for_state(state)
            payload = service.schema_payload()
            payload.update(self._database_metadata(state))
            payload["message"] = f"Using sample database: {self.sample_db_path.name}"
            return payload

    def upload_database(self, session_id: str, filename: str, content: bytes) -> dict:
        safe_name = Path(filename or "").name
        if not safe_name:
            raise QueryServiceError("choose a SQLite .db file to upload")
        if Path(safe_name).suffix.lower() != ".db":
            raise QueryServiceError("uploaded database must use the .db file extension")
        if not content:
            raise QueryServiceError("uploaded database is empty")
        if len(content) > self.max_upload_bytes:
            raise QueryServiceError(f"uploaded database exceeds the 1 MB limit")

        session_dir = self.upload_dir / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        destination = session_dir / safe_name
        self._clear_session_uploads(session_dir)
        destination.write_bytes(content)

        try:
            uploaded_service = RadbService(destination)
        except Exception:
            destination.unlink(missing_ok=True)
            raise

        with self._lock:
            state = self._state(session_id)
            old_service = state.service
            state.uploaded_name = safe_name
            state.uploaded_path = destination
            state.active_kind = "upload"
            state.service = uploaded_service
            payload = uploaded_service.schema_payload()
            payload.update(self._database_metadata(state))
            payload["message"] = f"Using uploaded database: {safe_name}"

        if old_service is not None:
            old_service.close()

        return payload

    def _state(self, session_id: str) -> _SessionState:
        state = self._sessions.get(session_id)
        if state is None:
            state = _SessionState()
            self._sessions[session_id] = state
        return state

    def _service_for_state(self, state: _SessionState) -> RadbService:
        if state.service is None:
            state.service = RadbService(self._active_database_path(state))
        return state.service

    def _active_database_path(self, state: _SessionState) -> Path:
        if state.active_kind == "upload" and state.uploaded_path is not None:
            return state.uploaded_path
        return self.sample_db_path

    def _database_metadata(self, state: _SessionState) -> dict:
        active_path = self._active_database_path(state)
        sample_label = f"{self.sample_db_path.name} (sample)"
        uploaded_payload = None
        if state.uploaded_path is not None and state.uploaded_name is not None:
            uploaded_payload = {
                "label": state.uploaded_name,
                "path": str(state.uploaded_path),
                "selected": state.active_kind == "upload",
            }

        return {
            "active_database": {
                "kind": state.active_kind,
                "label": uploaded_payload["label"] if state.active_kind == "upload" and uploaded_payload else sample_label,
                "path": str(active_path),
            },
            "sample_database": {
                "label": sample_label,
                "path": str(self.sample_db_path),
                "selected": state.active_kind == "sample",
            },
            "uploaded_database": uploaded_payload,
            "upload_rules": {
                "max_bytes": self.max_upload_bytes,
                "max_mb_text": f"{self.max_upload_bytes / (1024 * 1024):.0f} MB",
                "required_extension": ".db",
            },
        }

    @staticmethod
    def _clear_session_uploads(session_dir: Path):
        for child in session_dir.iterdir():
            if child.is_file():
                child.unlink()

    @staticmethod
    def _close_service(state: _SessionState):
        if state.service is not None:
            state.service.close()
            state.service = None


class WebUIRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, store: _DatabaseSessionStore, directory: str, **kwargs):
        self.store = store
        self._session_id: str | None = None
        self._pending_cookie: str | None = None
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        session_id = self._ensure_session()

        if parsed.path == "/api/schema":
            self._send_json(HTTPStatus.OK, {"ok": True, **self.store.schema_payload(session_id)})
            return

        if parsed.path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "sample_database_path": str(self.store.sample_db_path),
                    "upload_directory": str(self.store.upload_dir),
                    "max_upload_bytes": self.store.max_upload_bytes,
                },
            )
            return

        if parsed.path == "/":
            self.path = "/index.html"

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        session_id = self._ensure_session()

        if parsed.path == "/api/run":
            payload = self._read_json_request()
            try:
                result = self.store.execute_query(session_id, str(payload.get("query", "")))
            except QueryServiceError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": True, **result})
            return

        if parsed.path == "/api/database/sample":
            try:
                payload = self.store.use_sample_database(session_id)
            except QueryServiceError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": True, **payload})
            return

        if parsed.path == "/api/database/upload":
            try:
                payload = self._handle_database_upload(session_id)
            except QueryServiceError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return
            self._send_json(HTTPStatus.OK, {"ok": True, **payload})
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})

    def end_headers(self):
        if self._pending_cookie is not None:
            self.send_header("Set-Cookie", self._pending_cookie)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        return

    def _ensure_session(self) -> str:
        if self._session_id is not None:
            return self._session_id

        cookie_header = self.headers.get("Cookie", "")
        cookies = SimpleCookie()
        cookies.load(cookie_header)
        existing_cookie = cookies.get(SESSION_COOKIE_NAME)

        if existing_cookie is not None and existing_cookie.value:
            self._session_id = existing_cookie.value
            return self._session_id

        self._session_id = secrets.token_urlsafe(24)
        self._pending_cookie = (
            f"{SESSION_COOKIE_NAME}={self._session_id}; Path=/; HttpOnly; SameSite=Lax"
        )
        return self._session_id

    def _read_json_request(self) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"

        try:
            return json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise QueryServiceError("invalid JSON request body") from exc

    def _handle_database_upload(self, session_id: str) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > self.store.max_upload_bytes + UPLOAD_OVERHEAD_BYTES:
            raise QueryServiceError("uploaded database exceeds the 1 MB limit")

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": str(content_length),
            },
        )

        if UPLOAD_FORM_FIELD not in form:
            raise QueryServiceError("missing uploaded database file")

        uploaded = form[UPLOAD_FORM_FIELD]
        if isinstance(uploaded, list):
            uploaded = uploaded[0]

        if not getattr(uploaded, "file", None):
            raise QueryServiceError("missing uploaded database file")

        content = uploaded.file.read(self.store.max_upload_bytes + 1)
        return self.store.upload_database(session_id, uploaded.filename or "", content)

    def _send_json(self, status: HTTPStatus, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_server(host: str, port: int, sample_db_path: Path) -> int:
    store = _DatabaseSessionStore(
        sample_db_path=sample_db_path,
        upload_dir=settings.upload_dir,
        max_upload_bytes=settings.max_upload_bytes,
    )
    handler = lambda *args, **kwargs: WebUIRequestHandler(
        *args,
        store=store,
        directory=str(settings.static_dir),
        **kwargs,
    )
    server = ThreadingHTTPServer((host, port), handler)

    print(f"radb web UI listening on http://{host}:{port}")
    print(f"Sample database: {store.sample_db_path}")
    print(f"Upload directory: {store.upload_dir}")
    print(f"Max upload size: {store.max_upload_bytes} bytes")

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
        default=str(settings.sample_db_path),
        help=f"sample SQLite database path (default: {settings.sample_db_path})",
    )
    args = parser.parse_args()

    return run_server(args.host, args.port, Path(args.db_path).expanduser())


if __name__ == "__main__":
    raise SystemExit(main())
