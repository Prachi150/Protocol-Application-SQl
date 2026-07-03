# CLAUDE.md — ioconnect-sql

Guidance for Claude Code when working in this repo.

## What this is
A SQL (MySQL/MSSQL) polling **protocol adapter** for the IoConnect platform. It reads new
rows from database tables incrementally and posts one payload per row to Redpanda/HTTP/MQTT.
Scaffolded from `ioconnect-protocol-template`; SQL logic ported from `ioconnect-sql-python`.

## Layout
```
src/app.py         Main loop. One SQLClient + poll thread per (server,port,database).
                   SQL-specific: posts ONE payload per returned row (each row's own time);
                   status 2 (no new rows) posts nothing. Client registry keyed by
                   composite server:port/database.
src/sql.py         SQLClient — connect (pyodbc/ODBC), incremental read(packet), history.json.
src/csvparser.py   Merges config.csv + polling[] → poll_config (server→pollrates→packets).
src/logger.py      Structured JSON logging.        (verbatim from template)
src/metrics.py     Prometheus, metrics prefixed sql_.(template, prefix renamed)
src/posthandler.py Redpanda/HTTP/MQTT + SQLite buffer.(template + HTTP-import bugfix, see below)
scripts/*.sh       systemd lifecycle (install/start/stop/restart/status/uninstall/uptime).
sample-configs/sql config templates.  tools/  test HTTP sink + row inserter.
```

## The template contract (do not break)
`app.py` expects `SQLClient(server_entry)`, `client.read(packet) -> [{time,tags,status,error}]`,
truthy/falsy `client.conn_status`, and `client.close()`. `csvparser.read(path, polling)` returns
server entries with a `pollrates` key; `build_write_index()` returns `{}` (SQL is read-only).

## Rules / gotchas
- **Incremental key:** every device+table needs exactly one `ts`-tagged row (the timestamp column).
- **Runtime `config.csv` must be comment-free** — the Configurator's CSV editor doesn't strip `#`.
- **posthandler HTTP bugfix:** upstream template does `import requests as http`, then
  `import http.server`, which shadows `requests` → HTTP posting throws. Fixed here to
  `import requests` + `requests.request(...)`. Keep it; report upstream.
- **ODBC required:** `pyodbc` + a system ODBC driver (MySQL/MariaDB or MSSQL) + `unixodbc`.
- All UI/config is authored via the Configurator `sql` profile (`configs/sql/schema.json`),
  served on port **6767**.

## Run
`FILES_BASE_DIR=./data METRICS_PORT=9464 ./venv/bin/python src/app.py`
