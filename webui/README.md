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

The default database path is set in `webui/config.py` and points to:

```text
teachingData/college.db
```

You can override it without editing code:

```bash
RADB_WEBUI_DB_PATH=/absolute/path/to/college.db python -m webui.server
```

You can also change host and port:

```bash
RADB_WEBUI_HOST=127.0.0.1 RADB_WEBUI_PORT=8010 python -m webui.server
```

## Notes

- The raw query editor is the source of truth for execution.
- Builder changes automatically rewrite the raw editor.
- The backend reuses `radb` parsing, validation, translation, and execution code instead of reimplementing the RA engine.
- The page now includes a mathematical preview with Unicode RA symbols and LaTeX. Full typeset math uses MathJax from a CDN, so if you are offline the Unicode view and LaTeX source still work but the rendered math panel will stay in fallback mode.
