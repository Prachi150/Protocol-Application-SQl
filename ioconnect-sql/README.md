# ioconnect-sql

A SQL database (**MySQL / MSSQL**) data-polling protocol adapter for the IoConnect / IOsense platform.

It periodically reads **new rows** from configured database tables (incrementally, by a
timestamp column), turns each row into a device payload, and posts it to a broker
(**Redpanda/Kafka**, HTTP, or MQTT). It is scaffolded from `ioconnect-protocol-template`
and reuses the proven query/connection logic from `ioconnect-sql-python`, so it is fully
platform-compliant: structured JSON logging, Prometheus metrics, systemd lifecycle
scripts, offline SQLite buffering, and an `app_manifest.json` for lsg-app.

## How it works

```
config.csv + sys_parameters.json
        │  csvparser.read()  → one server entry per (server, port, database)
        ▼                        each with pollrates[] → packets[] (one per device+table)
   app.py poll loop  → SQLClient.read(packet)   (src/sql.py)
        │                  • SELECT rows WHERE <ts_col> > last_read_time  (batched, ORDER BY ts)
        │                  • remembers last_read_time per (connection, table) in history.json
        ▼                  • returns [{time, tags:[{tag,value}], status, error}]  — one per row
   post_handler.post()  → one payload PER ROW, stamped with that row's own timestamp
                          → Redpanda / HTTP / MQTT   (src/posthandler.py)
```

**Incremental reads:** every table must expose a monotonic **timestamp column**, tagged
`ts` in `config.csv`. The adapter only pulls rows newer than the last one it read.

## Configuration

Two files in `FILES_BASE_DIR` (default `./data`), normally authored via the **SQL
Configurator** UI (`configs/sql` profile), or by hand — see `sample-configs/sql/`.

### `sys_parameters.json`
- `polling[]` — one entry per SQL **connection**; `protocol` holds
  `type` (`mysql`|`mssql`), `server`, `port`, `database`, `username`, `password`,
  `driver` (ODBC driver name), `rowlimit`, `default_last_read_time`, `tz_offset_minutes`.
- `posting[]` — destinations; `redpanda` is pinned to index 0 (the platform default).

### `config.csv`
Columns: `device,server,port,database,table,column,tag,datatype,resolution,lograte`
- `server/port/database` **must match** a `polling[]` entry's `protocol.{server,port,database}`.
- one row per column; the timestamp column's row uses tag **`ts`**.
- `datatype`: `int | float | str | datetime | bool` (blank = accept as-is).

> Note: the hand-written `sample-configs/sql/config.csv` has `#` comment lines for
> documentation. The Configurator's CSV editor does not strip comments, so the
> **runtime** `data/config.csv` should be comment-free (the Configurator writes it clean).

## Running

### Prerequisites
- Python 3.10+, and an **ODBC driver** for your database:
  - MySQL: *MySQL ODBC Unicode Driver* (or *MariaDB Unicode*), package `odbc-mariadb` / MySQL Connector/ODBC
  - MSSQL: *ODBC Driver 18 for SQL Server*
  - plus `unixodbc`. Pre-built wheels/drivers are vendored in `../ioconnect-sql-python/{packages,odbc-drivers}`.

### Local / manual
```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
FILES_BASE_DIR=./data METRICS_PORT=9464 ./venv/bin/python src/app.py
```
Metrics are exposed at `http://localhost:9464/metrics` (all metrics prefixed `sql_`).

### Production (IoConnect device)
```bash
sudo bash scripts/install.sh          # venv + systemd + nginx + app_manifest.json
```
lsg-app then manages the service via `scripts/{start,stop,restart,status,uninstall}.sh`.

## Test tooling (`tools/`)
- `http_sink.py [port] [outfile]` — a tiny HTTP endpoint that records posted payloads.
- `db_insert.py [count] [step_seconds]` — inserts advancing-timestamp rows to simulate live data.

Local end-to-end (proven): stand up a MySQL/MariaDB with a timestamped table, point
`sys_parameters.json` at it with `posting[0]` = http → `http://127.0.0.1:8001/`, run
`tools/http_sink.py`, then run the adapter and insert rows with `tools/db_insert.py`.
