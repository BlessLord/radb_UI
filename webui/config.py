from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"


def _resolve_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = ROOT_DIR / path
    return path.resolve()


@dataclass(frozen=True)
class Settings:
    sample_db_path: Path
    host: str
    port: int
    static_dir: Path
    upload_dir: Path
    max_upload_bytes: int


def load_settings() -> Settings:
    default_db_path = ROOT_DIR / "teachingData" / "college.db"
    configured_sample_db = os.environ.get("RADB_WEBUI_SAMPLE_DB_PATH") or os.environ.get("RADB_WEBUI_DB_PATH")
    sample_db_path = _resolve_path(configured_sample_db or str(default_db_path))
    host = os.environ.get("RADB_WEBUI_HOST", "127.0.0.1")
    port = int(os.environ.get("RADB_WEBUI_PORT", "8000"))
    upload_dir = _resolve_path(os.environ.get("RADB_WEBUI_UPLOAD_DIR", str(ROOT_DIR / ".webui_uploads")))
    max_upload_bytes = int(os.environ.get("RADB_WEBUI_MAX_UPLOAD_BYTES", str(1024 * 1024)))
    return Settings(
        sample_db_path=sample_db_path,
        host=host,
        port=port,
        static_dir=STATIC_DIR,
        upload_dir=upload_dir,
        max_upload_bytes=max_upload_bytes,
    )


settings = load_settings()
