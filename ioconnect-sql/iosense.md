# iosense.md — ioconnect-sql state tracking

## What this app is
SQL (MySQL/MSSQL) polling protocol adapter. Reads new DB rows incrementally and posts
device payloads to Redpanda/HTTP/MQTT. Built from `ioconnect-protocol-template`, SQL
logic ported from `ioconnect-sql-python`.

## IOsense platform API usage
This adapter does **not** call IOsense SDK / Bruce / influx APIs directly. It is a data
*source* adapter: it polls SQL databases and publishes to the local Redpanda broker
(topic `devicesIn.<device>.data`), which lsg-app's Redpanda Connect pipelines forward
upstream. No `functionID` API calls are made from this service.

## Ports
- Configurator: **6767 ONLY** — single-port setup. The Express backend (`server/`) serves
  BOTH the built UI (`dist/`) and the `/api` routes on 6767; no separate frontend/dev port.
  Run: `cd ioconnect-protocol-configurator && VITE_CONFIG_PROFILE=sql npm run build`
  then `cd server && npm run dev` (reads `server/.env` PORT=6767).
- Adapter Prometheus metrics: **9464** (`/metrics`, metrics prefixed `sql_`); install.sh
  allocates real ports at install time into `env/.env.api`.
- Redpanda broker (lsg-app): 9092.

## Config state (local test)
- DB: MariaDB `factory.Pipes` @ 127.0.0.1:3306, user `iosense`, ODBC driver `MariaDB Unicode`.
- `data/config.csv`: device `WELLSAWRPEDS_A1`, table `Pipes`, tags ts/D11/D8/D6, 5000ms.
- `data/sys_parameters.json`: posting[0]=redpanda (as saved by Configurator), [1]=http fallback.

## Verified
- Incremental polling reads only new rows; per-row payloads carry each row's own timestamp.
- HTTP + Prometheus paths work; `history.json` persists last_read_time per (conn, table).
- Configurator SQL profile loads/saves the adapter config on 6767 (0 console errors).

## Known follow-ups
- Upstream bug: template `posthandler.py` `import requests as http` collides with
  `import http.server` — fixed here; report to platform team.
- Push this repo to `github.com/Faclon-IoT-Team/ioconnect-sql` (registered in lsg-app
  `config/protocols-config.json` under key `sql`).
- Retest against the user's real SQL database.
