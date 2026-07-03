# Always-on deployment (systemd)

Runs the SQL Configurator (UI + API on **6767**) and the SQL adapter as systemd
services so they **auto-start on boot** and **restart on crash** — no manual
restarts, and nginx (which proxies `:80 → :6767`) always has a backend (no 502s).

## Install
```bash
sudo bash deploy/install-services.sh
```
This installs two units + a scoped sudoers rule, then enables and starts them.

## Services
| Service | What it does |
|---|---|
| `ioconnect-sql-configurator.service` | Node server: serves the UI + API on port 6767 |
| `ioconnect-sql.service` | The SQL polling adapter (reads DB → posts data) |
| `mariadb.service` | Database (local test DB; use your own DB in production) |

The configurator's **▶ Start / ⏹ Stop / ↻ Restart** buttons drive
`ioconnect-sql.service` via the scoped sudoers rule (`/etc/sudoers.d/ioconnect-sql`).

## Manage
```bash
systemctl status ioconnect-sql-configurator ioconnect-sql
journalctl -u ioconnect-sql -f          # live adapter logs
sudo systemctl restart ioconnect-sql    # restart the adapter
```

## Notes
- `ExecStart` uses the resolved absolute `node` / venv `python` paths (fnm/nvm
  shell-specific paths won't survive a reboot — the installer resolves them).
- Live Values uses HTTP ingest (`MONITOR_INGEST_HTTP=1` in `server/.env`) since
  no Kafka/Redpanda broker is present. In a full platform deployment with a
  broker, unset that flag to use the Kafka consumer path instead.
