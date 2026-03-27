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
    db_path: Path
    host: str
    port: int
    static_dir: Path


def load_settings() -> Settings:
    default_db_path = ROOT_DIR / "teachingData" / "college.db"
    db_path = _resolve_path(os.environ.get("RADB_WEBUI_DB_PATH", str(default_db_path)))
    host = os.environ.get("RADB_WEBUI_HOST", "127.0.0.1")
    port = int(os.environ.get("RADB_WEBUI_PORT", "8000"))
    return Settings(db_path=db_path, host=host, port=port, static_dir=STATIC_DIR)


settings = load_settings()
