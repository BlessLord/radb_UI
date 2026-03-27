# radb Web UI

This folder contains a lightweight local web UI for `radb`.

## Start

From the repository root:

```bash
conda activate ai-class
python -m webui.server
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Database Path

The built-in sample database path is set in `webui/config.py` and points to:

```text
teachingData/college.db
```

Users can either:

- use the built-in sample `college.db`
- upload their own SQLite `.db` file from the browser

Uploads are limited to `1 MB` and are scoped to the current browser session.

You can override the sample database path without editing code:

```bash
RADB_WEBUI_SAMPLE_DB_PATH=/absolute/path/to/college.db python -m webui.server
```

You can also change host, port, upload directory, and upload size:

```bash
RADB_WEBUI_HOST=127.0.0.1 \
RADB_WEBUI_PORT=8010 \
RADB_WEBUI_SAMPLE_DB_PATH=/absolute/path/to/college.db \
RADB_WEBUI_UPLOAD_DIR=/tmp/radb-webui-uploads \
RADB_WEBUI_MAX_UPLOAD_BYTES=1048576 \
python -m webui.server
```

## Notes

- The raw query editor is the source of truth for execution.
- Builder changes automatically rewrite the raw editor.
- The backend reuses `radb` parsing, validation, translation, and execution code instead of reimplementing the RA engine.
- The page now includes a mathematical preview with Unicode RA symbols and LaTeX. Full typeset math uses MathJax from a CDN, so if you are offline the Unicode view and LaTeX source still work but the rendered math panel will stay in fallback mode.
- Uploaded databases must be valid SQLite files with the `.db` extension and a size of at most `1 MB`.
- The frontend uses relative asset and API paths, so it can be reverse-proxied at `/` or under a path prefix such as `/ra/`.

## Deployment

Example Caddy and `systemd` deployment files for a Lightsail host are in:

- `deploy/Caddyfile.example`
- `deploy/Caddyfile.ip.example`
- `deploy/radb-webui.service.example`
- `deploy/radb-webui.env.example`
- `deploy/LIGHTSAIL.md`
