# protocol-template

Starting point for new IoConnect protocol adapter apps. Clone or copy this folder, follow the checklist below, and you have a fully deployable adapter ready for the IoConnect platform.

---

## Folder Structure

```
protocol-template/
├── README.md                     ← You are here. Developer guide + src/ specifications.
├── Jenkinsfile                   ← CI/CD pipeline (4 stages, identical for all adapters)
├── requirements.txt              ← Python dependencies (shared base + protocol-specific)
├── .env.example                  ← Environment variable reference template
├── .gitignore                    ← Standard exclusions (venv, logs, generated files)
│
├── src/
│   └── examples/
│       └── python/               ← Copy these for Python adapters; only 2 files need changes
│           ├── app.py            ← Main orchestrator (copy; change import + class name — 3 lines)
│           ├── logger.py         ← Structured logging (copy verbatim — no changes)
│           ├── metrics.py        ← Prometheus metrics (copy; change "opcua_" prefix — 10 strings)
│           └── posthandler.py    ← Data forwarding engine (copy verbatim — no changes)
│   ← For non-Python adapters or custom protocol logic, create src/ from scratch.
│     See src/ Module Specifications below for interface contracts.
│
├── scripts/
│   ├── install.sh                ← Master installer (venv, systemd, nginx, manifest)
│   ├── uninstall.sh              ← Reverses install.sh; optional --purge flag
│   ├── start.sh                  ← sudo systemctl start <APP_NAME>.service
│   ├── stop.sh                   ← sudo systemctl stop <APP_NAME>.service
│   ├── restart.sh                ← sudo systemctl restart <APP_NAME>.service
│   ├── status.sh                 ← systemctl is-active <APP_NAME>.service
│   └── uptime.sh                 ← Prints Unix epoch when service last became active
│
├── sample-configs/
│   ├── sys_parameters.json       ← Generic template with placeholders
│   ├── config.csv                ← Generic template with column schema reference
│   ├── opc/                      ← Real OPC UA examples (from ioconnect-opcua)
│   │   ├── config.csv
│   │   └── sys_parameters.json
│   ├── modbus/                   ← Real Modbus TCP + Serial examples
│   │   ├── config-tcp.csv
│   │   ├── config-serial.csv
│   │   └── sys_parameters.json
│   └── s7/                       ← Real Siemens S7 examples
│       ├── config.csv
│       └── sys_parameters.json
│
├── docs/
│   └── ARCHITECTURE.md           ← Platform architecture + protocol-specific section
│
└── monitoring/
    └── grafana/
        └── provisioning/
            └── dashboards/
                └── protocol-kpi.json   ← Grafana dashboard (4 panels, templated PromQL)
```

---

## Quick-Start Checklist - Protocol Apps

Jump to next section if you are not creating a protocol-app
Search the codebase for `# REPLACE:` (or `// REPLACE:`) to find every customization point.

---

### Path A — Manual Run / Local Testing (no Jenkins, no systemd)

Use this path first to verify your protocol logic before setting up the full deployment pipeline.

**Step 1 — Rename and Pick a Slug**

- [ ] Rename this folder to `ioconnect-<yourproto>/`
  - New adapters use the `ioconnect-` prefix (e.g. `ioconnect-opcua`, `ioconnect-modbus`, `ioconnect-enip`)
  - Existing adapters for reference: [ioconnect-opcua](https://github.com/Faclon-IoT-Team/ioconnect-opcua-python), [ioconnect-modbus](https://github.com/Faclon-IoT-Team/ioconnect-modbus-python), [ioconnect-s7-python](https://github.com/Faclon-IoT-Team/ioconnect-s7-python)
- [ ] Pick a short protocol slug (lowercase, no spaces/hyphens): e.g. `opcua`, `modbus`, `s7`, `enip`

**Step 2 — Set Up `src/` (Python)**

- [ ] Copy `src/examples/python/` to `src/` — this gives you app.py, logger.py, metrics.py, posthandler.py
- [ ] In `src/app.py`, apply the 3 `# REPLACE:` markers: change `from opc import OPCUAClient` to your module/class
- [ ] In `src/metrics.py`, replace all 10 `opcua_` prefix strings with your protocol slug (e.g. `modbus_`)
- [ ] Create `src/<yourproto>.py` — implement the protocol client (see `src/` Module Specifications below)
- [ ] Create `src/csvparser.py` — implement the CSV merger for your tag schema

  *For non-Python adapters:* create `src/` from scratch following the interface contracts in `src/` Module Specifications.

**Step 3 — Configure `sample-configs/`**

- [ ] Copy `sample-configs/<closest-protocol>/` as a starting point (e.g. `sample-configs/modbus/` for Modbus TCP)
- [ ] Copy the files to the app root:
  ```bash
  cp sample-configs/<closest-protocol>/sys_parameters.json .
  cp sample-configs/<closest-protocol>/config.csv .        # or config-tcp.csv etc.
  ```
- [ ] Edit `sys_parameters.json`: fill in `polling[0].protocol` with real device connection details; remove `_comment` keys
- [ ] Edit `config.csv`: add your actual tag rows; remove `#` comment lines before deployment

**Step 4 — Install and Run**

- [ ] Install dependencies:
  ```bash
  python3.12 -m venv venv
  ./venv/bin/pip install -r requirements.txt
  ```
- [ ] Set required environment variables:
  ```bash
  export FILES_BASE_DIR=.
  export SERVICE_NAME=ioconnect-<yourproto>
  export LOG_LEVEL=DEBUG
  ```
- [ ] Run the adapter:
  ```bash
  cd src && ../venv/bin/python app.py
  ```
- [ ] Verify JSON logs appear in stdout and data reaches the posting destination
- [ ] Check Prometheus metrics: `curl http://localhost:9464/metrics`

---

### Path B — Jenkins Build + IoConnect Install (production deployment)

Complete Path A and confirm the adapter runs correctly first, then proceed with these steps.

**Step 5 — Update `Jenkinsfile` (3 lines)**

- [ ] `APP_NAME` `defaultValue` → your deployment slug (e.g. `lsg-myproto-testing`)
- [ ] `VITE_CONFIG_PROFILE` → the schema profile key (e.g. `myproto`)
- [ ] `VITE_APP_NAME` → human-readable configurator tab title (e.g. `"MyProto Configurator"`)

**Step 6 — Update `.env.example` (5 lines)**

- [ ] `APP_NAME` default value
- [ ] `VITE_BASE_PATH` default value (must match APP_NAME: `/apps/<APP_NAME>/`)
- [ ] `VITE_CONFIG_PROFILE` value
- [ ] `VITE_APP_NAME` display name
- [ ] `KAFKA_CLIENT_ID` (match APP_NAME)

**Step 7 — Update `requirements.txt`**

- [ ] Add your protocol's Python library at the bottom (under the `# REPLACE:` marker)
- [ ] Bundle the corresponding `.whl` file(s) into `packages/` for offline installation on air-gapped devices

**Step 8 — Update Scripts (APP_NAME defaults)**

Run `grep -r "REPLACE" scripts/` to find all change points:

- [ ] `scripts/install.sh` — APP_NAME default + two systemd unit `Description=` strings (3 markers)
- [ ] `scripts/uninstall.sh` — APP_NAME default + banner title (2 markers)
- [ ] `scripts/start.sh`, `stop.sh`, `restart.sh`, `status.sh` — APP_NAME fallback (1 marker each)
- [ ] `scripts/uptime.sh` — no change needed

**Step 9 — Update Grafana Dashboard**

- [ ] In `monitoring/grafana/provisioning/dashboards/protocol-kpi.json`, replace every `protocol_` with `<yourproto>_`
- [ ] Update dashboard `title` and `uid` fields
- [ ] Update the 3 template variable queries (they also use `protocol_`)

**Step 10 — Add Configurator Schema**

- [ ] Create `ioconnect-protocol-configurator/configs/<yourproto>/schema.json` (see **Configurator** section below)

**Step 11 — Update `docs/ARCHITECTURE.md`**

- [ ] Fill in the `## Protocol Adapter: [YOUR PROTOCOL NAME]` section with your protocol's details
- [ ] Document `sys_parameters.json` polling[] block fields and `config.csv` column schema

**Step 12 — Deploy**

- [ ] Commit to SCM, trigger Jenkins build
- [ ] Run `scripts/install.sh` on the target IoConnect device
- [ ] Run `grep -r "REPLACE" .` in the deployed folder to confirm no unresolved placeholder remains

---

## App Integration Contract (All App Types)

This section documents what the IoConnect platform (lsg-app) requires from **every app** it manages — protocol adapter, OEE engine, database sink, UNS forwarder, business logic service, or anything else.

**Non-protocol apps** can skip the `monitoring/`, `docs/`, and `sample-configs/` folders — these are protocol-adapter conveniences, not platform requirements.

---

### Dependency Bundling

It is **recommended** to bundle runtime dependencies in the release zip for on-premise / air-gapped devices where outbound internet is restricted:

| Runtime | Bundle format | How install.sh handles it |
|---------|--------------|--------------------------|
| Python | `.whl` files in `packages/` | Tries offline install first; falls back to PyPI if wheels are incompatible |
| Node.js | pre-built `node_modules/` in `configurator/server/` | ABI-checked at install time; reinstalled from npm if native addons mismatch |
| System packages | `.deb` files or manual note | Install manually before running install.sh |

**For UI/frontend:** bundle only the compiled static files (`dist/`). Do not include `node_modules/` for the frontend — it is only needed at build time (which runs in Jenkins, not on the device).

**Target system specs for bundling compatibility:**

```
Architecture : x86_64 (linux-x64) or ARM64 (linux-arm64)
OS           : Ubuntu 22.04 LTS
Node.js      : v22
Python       : 3.12.5
```

Always build `.whl` files and native Node.js addons on a machine matching these specs to ensure binary compatibility with the target device.

---

### install.sh at a Glance

`install.sh` runs 12 steps in sequence. The table below shows what each step produces, whether it is required for your app type, and whether it is absolutely compulsory, required, or recommended.

**Priority key:**
- ⚫ **Absolute** — lsg-app itself breaks if this is skipped (no exceptions, all app types)
- 🔴 **Required** — the app fails to start or function correctly if skipped for the listed type
- 🟡 **Recommended** — safe to skip in some scenarios, but you will likely regret it
- ⚪ **Conditional** — only needed when your app uses that specific capability; completely skip otherwise

| Step | Purpose | Key output | Priority | Required for |
|------|---------|------------|----------|-------------|
| 1 | Verify runtime tools are installed | Hard error on missing binary | 🟡 Recommended | Adjust which tools are checked to match your runtime (remove `python3.12` check for Node.js-only apps, remove `node` check for headless Python apps) |
| 2 | Resolve `LSG_APPS_HOME` paths | `PACKAGE_DIR` and all derived absolute paths | 🔴 Required | **All apps** — nothing else in install.sh works without this |
| 3 | Resolve `LSG_APP_DATA`, create data dir | `DATA_DIR`; migrates config files on first install | 🔴 Required | Apps with persistent config or data files; skip for fully stateless apps |
| 4 | Create Python venv + install packages | `venv/` with all dependencies | ⚪ Conditional | **Python apps only** — skip entirely for Node.js or other runtimes |
| 5 | npm install for configurator frontend + backend | `node_modules/` in `configurator/server/` | ⚪ Conditional | **Apps with web UI** — skip with `--no-ui` for headless apps; adapt directory paths for custom UI layouts |
| 6 | Tear down old services + allocate free ports | `PORT`, `METRICS_PORT` written to `reserved-ports` | 🔴 Required | **All apps with at least one service** — port conflicts happen silently without this |
| 7 | Generate `env/.env.api` | `env/.env.api` with runtime config | 🔴 Required | **All apps** — systemd `EnvironmentFile=` points here; missing = services fail to start |
| 8 | Write systemd unit files | `services/<APP_NAME>.service` (+ configurator service if UI) | 🔴 Required | **All apps** — no unit file = no managed daemon |
| 9 | Install + enable services via systemctl | Services enabled; configurator service started | 🔴 Required | **All apps** — services not enabled = don't survive reboots |
| 10 | Write nginx location snippet | `${NGINX_SNIPPET_DIR}/<APP_NAME>.conf` | ⚪ Conditional | **Apps with HTTP API or web UI** — skip entirely for pure Kafka / no-HTTP apps |
| 11 | Test nginx config + reload | Clean nginx config reloaded | ⚪ Conditional | **Same as Step 10** — never write a snippet without testing; if Step 10 is skipped, skip this too |
| 12 | Generate `app_manifest.json` | `app_manifest.json` at package root | ⚫ **Absolute** | **All apps, no exceptions** — lsg-app cannot discover, register, or manage the app without this file |

> **Only Step 12 is enforced by lsg-app itself.** Steps 2–9 are required for the app to function correctly but lsg-app does not validate them directly. Step 1 is a safety net — skip it only if you are certain your runtime is installed.

---

### app_manifest.json

`app_manifest.json` is generated by `install.sh` at the package root after installation. **lsg-app cannot register or manage an app without it.** It must never be hand-edited or committed to git — always regenerated at install time with device-specific absolute paths and dynamically allocated ports.

```json
{
  "appName":      "ioconnect-<yourapp>",     // REQUIRED — must match SERVICE_NAME exactly
  "displayName":  "ioconnect-<yourapp>",     // REQUIRED — shown in lsg-app dashboard
  "version":      "1.0.0",                   // REQUIRED
  "description":  "...",                     // optional
  "port":         5000,                      // REQUIRED — primary API port (dynamically allocated)
  "monitoring": {                            // omit entirely if app has no Prometheus endpoint
    "enabled":     true,
    "metricsPort": 5002,
    "metricsPath": "/metrics"
  },
  "uiEnabled":    true,                      // false for headless / API-only apps
  "uiPath":       "/apps/ioconnect-<yourapp>/",       // required if uiEnabled=true
  "apiPath":      "/apps/api/ioconnect-<yourapp>/",   // optional platform routing alias
  "healthCheckPath": "/health",              // null if app has no HTTP server
  "scripts": {
    "start":     { "path": "scripts/start.sh",     "requiresSudo": true },
    "stop":      { "path": "scripts/stop.sh",      "requiresSudo": true },
    "restart":   { "path": "scripts/restart.sh",   "requiresSudo": true },
    "status":    { "path": "scripts/status.sh",    "requiresSudo": true },
    "uninstall": { "path": "scripts/uninstall.sh", "requiresSudo": true }
  },
  "startupDelaySeconds": 5    // seconds lsg-app waits after systemctl start before declaring healthy
}
```

**lsg-app validation (enforced by appRegistry):** `appName`, `displayName`, `version`, `port` are required. If `uiEnabled: true`, then `uiPath` is also required. App registration fails if the manifest is missing or any required field is absent.

The Jenkinsfile already excludes `app_manifest.json` from the release zip — this is intentional, since the manifest contains device-specific absolute paths that can only be resolved at install time.

---

### Port Allocation — Never Hardcode

Ports are **dynamically allocated** by `install.sh` at install time. Hardcoding a port (e.g. always using 5000) causes silent conflicts when two apps are installed on the same device.

**How it works:**
1. `find_free_port()` scans active listeners: `ss -tlnH`
2. Also checks `${LSG_APP_DATA}/reserved-ports` to avoid conflicts with other installed apps
3. Reserves the chosen ports by appending `<PORT> <SERVICE_NAME> <timestamp>` to that file
4. Writes `PORT` and `METRICS_PORT` into `env/.env.api`

**`uninstall.sh` must release the reservation:**
```bash
sed -i "/ ${SERVICE_NAME} /d" "${RESERVED_PORTS_FILE}"
```
If this is skipped, those ports are permanently blocked for all future installs on the device.

For apps with no Prometheus metrics: allocate only one port (API only) and omit `monitoring` from the manifest.

---

### env/.env.api — Runtime Configuration

`env/.env.api` is auto-generated by `install.sh` and must not be hand-edited after installation. Both systemd services (Python daemon + Node.js backend) load it via `EnvironmentFile=`:

```ini
# In both .service unit files:
EnvironmentFile=-/etc/environment            # platform-wide vars (REDPANDA_*, LSG_*) — optional (- = no error if absent)
EnvironmentFile=<PACKAGE_DIR>/env/.env.api   # app runtime vars — required
```

**Full content of env/.env.api (generated at install time):**

```bash
# Auto-generated by install.sh — do NOT edit manually. Re-run install.sh to regenerate.
PORT=5000                          # dynamically allocated primary API/backend port
METRICS_PORT=5002                  # dynamically allocated Prometheus scrape port
SERVICE_NAME=ioconnect-<yourapp>   # service identity — used by logger, SyslogIdentifier
SCRIPTS_DIR=<PACKAGE_DIR>/scripts  # absolute path (used by configurator to invoke start/stop)
FILES_BASE_DIR=<LSG_APP_DATA>/<APP_NAME>  # where config files live (sys_parameters.json, config.csv)
KAFKA_CLIENT_ID=ioconnect-<yourapp>-configurator
KAFKA_GROUP_ID=ioconnect-<yourapp>-monitor
LOG_DIR=<PACKAGE_DIR>/logs
NODE_ENV=production
```

All variables are available to every process the systemd service spawns. Always read from environment rather than hardcoding paths.

---

### Scripts: Exact Contract

lsg-app invokes lifecycle scripts with `sudo bash scripts/<name>.sh` from the app's install directory. **The only signal lsg-app reads is the exit code** (and for uptime.sh, stdout):

| Script | What lsg-app reads | Minimum correct implementation |
|--------|-------------------|-------------------------------|
| `start.sh` | exit 0 = success | `systemctl start ${SERVICE_NAME}.service` |
| `stop.sh` | exit 0 = success | `systemctl stop ${SERVICE_NAME}.service` |
| `restart.sh` | exit 0 = success | `systemctl restart ${SERVICE_NAME}.service` |
| `status.sh` | **exit 0 = running**, non-zero = stopped/failed | `systemctl is-active ${SERVICE_NAME}.service` |
| `uptime.sh` | **stdout = Unix epoch seconds** of last activation | parse `systemctl show` → `date -d ... +%s` |
| `uninstall.sh` | exit 0 = fully removed | See required steps below |

**`uptime.sh` must print an integer Unix epoch**, not a human-readable string. lsg-app parses this number to display "uptime" in the dashboard.

**`uninstall.sh` required cleanup steps** (in order; if any step is skipped, the platform is left in a broken state):
1. Stop and disable all systemd services: `systemctl stop/disable <SERVICE_NAME>`
2. Remove unit files from `/etc/systemd/system/` and reload: `systemctl daemon-reload`
3. Remove nginx snippet: `rm -f "${NGINX_SNIPPET_DIR}/${SERVICE_NAME}.conf"` then `nginx -t && systemctl reload nginx`
4. Release reserved ports: `sed -i "/ ${SERVICE_NAME} /d" "${RESERVED_PORTS_FILE}"`
5. (Optional `--purge` flag): remove `${LSG_APP_DATA}/${SERVICE_NAME}/` — persistent user data

If step 3 is skipped, nginx configuration stays broken until manually reloaded. If step 4 is skipped, those ports are blocked for all future installs.

---

### Health Endpoint

Every app that sets `healthCheckPath` in its manifest must serve that endpoint:

```
GET /health  →  HTTP 200 OK
Body (optional): {"status": "ok"}
```

lsg-app uses the health check response for the "Healthy" badge in its dashboard. Any in-process HTTP server with a trivial `/health` route satisfies this — no business logic needed.

For **headless apps with no HTTP server:** set `"healthCheckPath": null` in the manifest. lsg-app will skip health checks and rely solely on `status.sh` exit code.

---

### Nginx Routing Patterns

`install.sh` writes `${NGINX_SNIPPET_DIR}/<APP_NAME>.conf`. All files in that directory are auto-included by the nginx main config: `include /etc/nginx/lsg-app-locations.d/*.conf`.

**Pattern A — App with UI + API** (protocol adapters, analytics dashboards, any app with a React frontend):

```nginx
# Backend API — frontend derives this from window.location at runtime
location /apps/<APP_NAME>/api/ {
    proxy_pass http://127.0.0.1:<PORT>/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
# Backend API — platform alias path
location /apps/api/<APP_NAME>/ {
    proxy_pass http://127.0.0.1:<PORT>/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
# Frontend static build
location ^~ /apps/<APP_NAME>/ {
    alias <PACKAGE_DIR>/configurator/dist/;
    try_files $uri $uri/ @<APP_NAME>_index;
}
location @<APP_NAME>_index { rewrite ^ /apps/<APP_NAME>/index.html last; }
location = /apps/<APP_NAME> { return 301 $scheme://$host/apps/<APP_NAME>/; }
```

**Pattern B — Headless / API-only** (OEE engine, data forwarder, DB sink — no browser UI):

```nginx
location /apps/api/<APP_NAME>/ {
    proxy_pass http://127.0.0.1:<PORT>/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Set `uiEnabled: false` in the manifest when using Pattern B.

**No HTTP server at all:** omit the nginx snippet entirely. Don't call `nginx -t && systemctl reload` in install.sh.

---

### Platform Environment Variables (Complete)

Set in `/etc/environment` by the IoConnect platform installer. Available to all systemd services via `EnvironmentFile=-/etc/environment`.

| Variable | Default value | Used by |
|----------|--------------|---------|
| `LSG_APPS_HOME` | `/opt/lsg-apps` | install.sh — root directory where all app packages are installed |
| `LSG_APP_DATA` | `/var/lib/lsg-app-data` | install.sh — persistent data root; each app gets `${LSG_APP_DATA}/${APP_NAME}/` |
| `NGINX_SNIPPET_DIR` | `/etc/nginx/lsg-app-locations.d` | install.sh — where nginx location snippets are deposited |
| `REDPANDA_KAFKA_ADDRESS` | `127.0.0.1:9092` | Any Kafka producer/consumer in app code |
| `REDPANDA_BROKER_HOST` | `127.0.0.1` | When host and port are needed separately |
| `REDPANDA_BROKER_PORT` | `9092` | When host and port are needed separately |
| `REDPANDA_KAFKA_SECURITY_PROTOCOL` | `PLAINTEXT` | Kafka client security config |
| `REDPANDA_KAFKA_SASL_MECHANISM` | *(empty)* | Kafka SASL — empty on default install; set for secured clusters |
| `REDPANDA_KAFKA_SASL_USERNAME` | *(empty)* | Kafka SASL credentials |
| `REDPANDA_KAFKA_SASL_PASSWORD` | *(empty)* | Kafka SASL credentials |
| `REDPANDA_ADMIN_ADDRESS` | `127.0.0.1:9644` | Redpanda admin API (topic creation, cluster info) |
| `REDPANDA_SCHEMA_REGISTRY_ADDRESS` | `127.0.0.1:8081` | Avro/Protobuf schema registry |
| `REDPANDA_PANDAPROXY_ADDRESS` | `127.0.0.1:8082` | HTTP REST proxy for Kafka (produce/consume without a Kafka client lib) |
| `NGINX_PORT` | `80` | Reference — port nginx listens on |
| `BROKER_TYPE` | `REDPANDA` | Feature flag for broker-type-aware code paths |

For `--no-ioconnect` / standalone installs these vars are not pre-set. install.sh prompts interactively for `LSG_APPS_HOME` and `LSG_APP_DATA`. The broker address must be configured manually in `sys_parameters.json → posting[].broker`.

---

### Kafka Topic Conventions

All IoConnect apps exchange data through the local Redpanda broker at `$REDPANDA_KAFKA_ADDRESS`.

**Standard topics (produced by protocol adapters):**

| Topic | Producer | Payload |
|-------|----------|---------|
| `devicesIn.{device_id}.data` | Protocol adapters | `{"device": id, "time": epoch_ms, "data": [{"tag": name, "value": v}, ...]}` |

**Recommended patterns for new app types:**

| App type | Suggested topic |
|----------|----------------|
| OEE / analytics | `oee.{line_id}.metrics` |
| UNS (Unified Namespace) | `uns.{namespace}.{node}` |
| DB sink / historian | Consumes `devicesIn.*` — no output topic needed |
| Business logic / rules engine | `logic.{rule_name}.output` |

**Python Kafka connection pattern** (all vars are in the environment from `env/.env.api` + `/etc/environment`):

```python
import os
from confluent_kafka import Producer, Consumer

producer = Producer({
    "bootstrap.servers": os.environ["REDPANDA_KAFKA_ADDRESS"],
    "security.protocol": os.environ.get("REDPANDA_KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
    "client.id": os.environ.get("KAFKA_CLIENT_ID", "my-app")
})

consumer = Consumer({
    "bootstrap.servers": os.environ["REDPANDA_KAFKA_ADDRESS"],
    "security.protocol": os.environ.get("REDPANDA_KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
    "group.id": os.environ.get("KAFKA_GROUP_ID", "my-app-group"),
    "auto.offset.reset": "earliest"
})
consumer.subscribe(["devicesIn.PUMP_01.data"])
```

---

## File Inventory

| File | What to change |
|------|----------------|
| `Jenkinsfile` | 3 lines: APP_NAME default, VITE_CONFIG_PROFILE, VITE_APP_NAME |
| `.env.example` | 5 lines: APP_NAME, VITE_BASE_PATH, VITE_CONFIG_PROFILE, VITE_APP_NAME, KAFKA_CLIENT_ID |
| `requirements.txt` | Add protocol library; bundle .whl into packages/ |
| `.gitignore` | No change needed |
| `scripts/install.sh` | 3 REPLACE markers: APP_NAME default, two systemd Description= strings |
| `scripts/uninstall.sh` | 2 REPLACE markers: APP_NAME default, banner title |
| `scripts/start.sh` | 1 REPLACE marker: APP_NAME fallback |
| `scripts/stop.sh` | 1 REPLACE marker: APP_NAME fallback |
| `scripts/restart.sh` | 1 REPLACE marker: APP_NAME fallback |
| `scripts/status.sh` | 1 REPLACE marker: APP_NAME fallback |
| `scripts/uptime.sh` | No change needed |
| `sample-configs/sys_parameters.json` | Generic template — replace polling[].protocol block; choose one posting backend |
| `sample-configs/config.csv` | Generic template — replace column headers and add sample rows |
| `sample-configs/opc/` | Real OPC UA example — copy to app root and fill in `server` field |
| `sample-configs/modbus/` | Real Modbus TCP + Serial examples — copy to app root and fill in server/port |
| `sample-configs/s7/` | Real Siemens S7 example — copy to app root and fill in PLC IP |
| `src/examples/python/app.py` | Copy to src/; apply 3 REPLACE markers (import + class name) |
| `src/examples/python/logger.py` | Copy to src/ verbatim — no changes needed |
| `src/examples/python/metrics.py` | Copy to src/; replace all 10 `opcua_` strings with your prefix |
| `src/examples/python/posthandler.py` | Copy to src/ verbatim — no changes needed |
| `monitoring/.../protocol-kpi.json` | Replace `protocol_` prefix with `<yourproto>_` throughout |
| `docs/ARCHITECTURE.md` | Fill in Protocol Adapter section |
| `ioconnect-protocol-configurator/configs/<proto>/schema.json` | Create new — see Configurator section |

---

## Configuration Files

### Why Two Files?

Every protocol adapter requires **two** configuration files working together:

| File | Purpose | Who edits it | Changes how often |
|------|---------|--------------|-------------------|
| `sys_parameters.json` | Defines **servers** (connection endpoints) and **posting** destination | Operator / DevOps | Rarely — only when devices are added or network changes |
| `config.csv` | Defines **tags** — every individual signal to read, grouped by device | Engineer / Integrator | Frequently — whenever new tags are commissioned |

Separating them means an engineer can update the tag database without touching connection config, and vice versa.

---

### `sys_parameters.json` Structure

```json
{
  "polling": [
    {
      "protocol": {
        "server": "opc.tcp://192.168.1.100:4840",
        "type": "opcua",
        "...": "← protocol-specific connection fields (auth, port, rack, slot, etc.)"
      },
      "connection_type": "persist",
      "connect_retry_count": 3,
      "connect_retry_time": 5000,
      "poll_timeout": 1000,
      "connection_timeout": 5000
    }
  ],
  "posting": [
    { "type": "redpanda", "bootstrap_servers": "localhost:9092", "..." : "..." }
  ]
}
```

- **`polling[]`** — one entry per physical server / PLC. Each entry has a `protocol` sub-block with connection parameters specific to your protocol. The remaining fields (retry counts, timeouts) are identical across all adapters.

See `sample-configs/<protocol>/sys_parameters.json` for real examples.

---- **`posting[]`** — one entry per data destination. In production this is the local Redpanda Kafka broker. In a live IoConnect install, `$REDPANDA_KAFKA_ADDRESS` env var overrides this at runtime.


### `config.csv` Structure

Each row is one **tag** — a single data point (signal) to read from a field device.

**Columns required by all protocols:**

| Column | Purpose | Example |
|--------|---------|---------|
| `device` | Device name — groups tags under one logical device. Appears in the posted payload as `"device"`. | `PUMP_01`, `REACTOR_A` |
| `server` | Must exactly match a `protocol.server` value in `sys_parameters.json`. csvparser.py uses this to link CSV rows to connection config. | `192.168.1.100`, `opc.tcp://...` |
| `lograte` | Poll interval in milliseconds. Tags with the same `lograte` are batched into one poll cycle. | `1000`, `5000`, `60000` |

All other columns are protocol-specific. See `sample-configs/<protocol>/config.csv` for real column schemas.

---

### How csvparser.py Bridges the Two Files

`csvparser.py` merges `config.csv` + `sys_parameters.json` into the hierarchical structure `app.py` uses for polling. It produces two outputs:

#### Output 1 — Read Config (poll structure)

`csvparser.read(csv_path, sys_params["polling"])` returns a nested list. `app.py` drives this with:
- one **thread** per server entry
- one **scheduling loop** per poll rate
- one **`client.read(packet)` call** per device per rate per cycle

```
[                                    ← list of server entries
  {
    "protocol": { "server": "..." },  ← merged from sys_parameters.json
    "connection_type": "persist",
    "connect_retry_count": 3, ...
    "pollrates": [                    ← one entry per unique lograte value
      {
        "rate": 5000,
        "packets": [                  ← one entry per device at this rate
          {
            "device_id": "PUMP_01",
            ...                       ← protocol-specific address fields
            "tags": [...]
          }
        ]
      }
    ]
  }
]
```

After reading each packet, `app.py` posts one payload per device:
```python
{"device": "PUMP_01", "time": <epoch_ms>, "data": [{"tag": "Pressure", "value": 12.3}, ...]}
```

The csvparser also writes a `<protocol>_read_config.json` file to the app root for debugging — inspect this to verify the merged structure looks correct.

#### Output 2 — Write Index (command routing)

`csvparser.build_write_index(poll_config, base_dir)` returns a flat dict for routing write commands back to devices:

```python
{
  ("PUMP_01", "Valve1"): {"server": "192.168.1.100", "address": "ns=2;s=Valve1", ...},
  ("PUMP_01", "Speed"):  {"server": "192.168.1.100", "address": 165, "slave_id": 1, ...}
}
```

This is passed to `post_handler` for write command routing. Return `{}` for read-only protocols. The csvparser also writes a `<protocol>_write_config.json` file for inspection.

---

## `src/` Module Specifications

> The `src/` directory is not provided by this template because protocol implementations differ by language, library, and protocol semantics. The specifications below define the interface each module must satisfy for the rest of the system (install.sh, app_manifest.json, posthandler, Prometheus) to work correctly.

---

### `src/app.py` — Main Polling Orchestrator

**Role:** Entry point. Loads configuration, starts the metrics server, resolves the broker, and spawns one polling thread per server.

**Three functions to implement:**

#### `main()`
1. Determine `FILES_BASE_DIR` — from `$FILES_BASE_DIR` env var (set by install.sh) or fall back to `Path(__file__).parent.parent`
2. Load `sys_parameters.json` and call `csvparser.read(config_path, sys_params["polling"])` to get the merged poll config
3. Start Prometheus metrics server: `metrics.start(int(os.environ.get("METRICS_PORT", 9464)))`
4. Resolve broker config — cascade:
   - Check `$REDPANDA_KAFKA_ADDRESS` env var (injected by IoConnect platform at `$METRICS_PORT`)
   - Fall back to `sys_params["posting"][0]`
   - Exit CRITICAL if neither is found
5. Instantiate one protocol client per `server_entry` in the poll config
6. Instantiate one shared `post_handler(posting_config, write_index, cmd_server_config, client_registry)`
7. Spawn one `threading.Thread(target=poll, ...)` per server; set `daemon = True`
8. Wait for `stop_event` (set by signal handler)
9. Join all threads (timeout=5s), then call `post_obj.close()` and `client.close()` for each client

#### `poll(config, protocol_obj, post_obj, stop_event, server_url)`
Rate-grouped scheduling loop for one server:
1. Sort config by `rate`; set `nextdue = time.monotonic()*1000` for each rate group
2. Pre-initialize Prometheus counters for all devices (so "bad" series exist from startup with value 0)
3. Loop until `stop_event.is_set()`:
   - Update `connection_status` Prometheus gauge from `protocol_obj.conn_status`
   - For each rate group whose `nextdue` has passed:
     - Record `last_actual_poll_time` and compute jitter vs expected interval
     - For each packet in the rate group:
       - Time the `protocol_obj.read(packet)` call → record latency
       - Count good/bad tags from the result
       - Build payload: `{"device": packet["device_id"], "time": <epoch_ms>, "data": [{"tag": ..., "value": ...}, ...]}`
       - Always append `{"tag": "RSSI", "value": 22}` and `{"tag": "Status", "value": <1|0|2>}`
       - Call `post_obj.post(payload)` — non-blocking
     - Record cycle duration Prometheus histogram
     - Set `nextdue = curr_time + rate`
   - `time.sleep(0.001)` to yield CPU

#### `signal_handler_factory(stop_event)`
Returns a signal handler function that calls `stop_event.set()` on SIGINT or SIGTERM.

**Payload shape posted to post_handler:**
```python
{
  "device": "DEVICE_ID",
  "time": 1715000000000,  # Unix epoch milliseconds
  "data": [
    {"tag": "Temperature", "value": 23.4},
    {"tag": "Pressure",    "value": 1.01},
    {"tag": "RSSI",        "value": 22},
    {"tag": "Status",      "value": 1}   # 1=OK, 0=all bad, 2=partial
  ]
}
```

**Reference implementations:**
- [`ioconnect-opcua/src/app.py`](https://github.com/Faclon-IoT-Team/ioconnect-opcua-python/blob/main/src/app.py)
- [`ioconnect-modbus/src/app.py`](https://github.com/Faclon-IoT-Team/ioconnect-modbus-python/blob/main/src/app.py)
- [`ioconnect-s7-python/src/app.py`](https://github.com/Faclon-IoT-Team/ioconnect-s7-python/blob/main/src/app.py)

---

### `src/<yourproto>.py` — Protocol Client

**Role:** Wraps the industrial protocol library. Manages connections and reads tag data into a protocol-agnostic format.

**Required interface (rename class and file to match your protocol):**

```python
class ProtocolClient:

    conn_status: bool  # True = connected; app.py reads this directly for Prometheus gauge

    def __init__(self, server_entry: dict):
        """
        server_entry is one element from the merged poll config list (produced by csvparser).
        It contains:
          server_entry["protocol"]                   — connection params from sys_parameters.json
          server_entry["connection_type"]            — "persist" or "nonpersist"
          server_entry["connect_retry_count"]        — int
          server_entry["connect_retry_time"]         — int (milliseconds)
          server_entry["poll_retry_count"]           — int
          server_entry["poll_timeout"]               — int (milliseconds)
          server_entry["pollrates"]                  — list of rate groups (not used by __init__)

        If connection_type == "persist": connect immediately in __init__.
        If "nonpersist": connect before each read(), disconnect after.
        """

    def connect(self) -> bool:
        """
        Attempt connection with retry logic.
        - Try up to connect_retry_count times
        - Sleep connect_retry_time ms between attempts
        - Set self.conn_status = True on success, False on failure
        - Return True on success, False on failure
        - Log each attempt and outcome
        """

    def disconnect(self):
        """Clean teardown. Must set self.conn_status = False."""

    def close(self):
        """Called by app.py on graceful shutdown. Typically just calls disconnect()."""

    def read(self, packet: dict) -> list:
        """
        Read one packet of tags from the device.

        packet is one element from pollrate["packets"] in the csvparser output.
        The exact structure depends on your csvparser implementation.

        MUST return a list of result dicts:
        [
          {
            "tags":   [{"tag": "<name>", "value": <any>}, ...],
            "status": 1,       # 1 = at least one good tag, 0 = complete failure
            "error":  None     # or error message string on failure
          },
          ...   # one entry per address/register/node in the packet
        ]

        Rules:
        - NEVER raise an unhandled exception. app.py catches exceptions and increments
          the error counter, but an uncaught exception in the poll loop breaks polling.
        - For nonpersist connections: connect at the start of read(), disconnect at the end.
        - Return status=0 entries (not raise) when individual addresses fail.
        """
```

**Connection types:**
- `persist` — establish one long-lived connection; reconnect on disconnect
- `nonpersist` — connect, read, disconnect for every poll cycle (stateless devices, overloaded networks)

**Reference implementations:**
- [`ioconnect-opcua/src/opc.py`](https://github.com/Faclon-IoT-Team/ioconnect-opcua-python/blob/main/src/opc.py) — OPC UA via `opcua` library (polling, auth, encryption)
- [`ioconnect-modbus/src/modbus.py`](https://github.com/Faclon-IoT-Team/ioconnect-modbus-python/blob/main/src/modbus.py) — Modbus TCP/RTU via `pymodbus` (FC1/2/3/4, endianness, byte packing)
- [`ioconnect-s7-python/src/s7.py`](https://github.com/Faclon-IoT-Team/ioconnect-s7-python/blob/main/src/s7.py) — Siemens S7 via `python-snap7` (DB areas, I/Q/M/C/T, bit fields)

---

### `src/csvparser.py` — CSV Config Merger

**Role:** Transforms the flat `config.csv` + `sys_parameters.json polling[]` into the hierarchical poll config consumed by `app.py`.

**Required functions:**

```python
def read(csv_path: Path, sys_poll_params: list) -> list:
    """
    Entry point.
    1. Read csv_path as a CSV file (header row + data rows)
    2. Call convert(rows, sys_poll_params)
    3. Save result to a <protocol>_read_config.json for debugging
    4. Return the merged config list
    """

def convert(csv_rows: list, sys_poll_params: list) -> list:
    """
    Merge CSV rows with sys_poll_params connection config.
    Returns the merged poll config list (same as read() return value).
    """

def build_write_index(merged_config: list, output_dir: Path) -> dict:
    """
    Build a flat lookup for write command routing.
    Returns: { (device_id, tag_name): { address_info... }, ... }
    Return {} for read-only protocols.
    """
```

**Required output shape** (the merged poll config list):
```python
[
  {
    # ── from sys_parameters.json polling[] entry ──
    "protocol": {
      "server": "...",     # MUST match how app.py derives server_key
      # ...all other connection fields from sys_parameters polling[].protocol
    },
    "connection_type": "persist",
    "connect_retry_count": 3,
    "connect_retry_time": 5000,
    "poll_retry_count": 3,
    "poll_timeout": 1000,
    "connection_timeout": 5000,

    # ── derived from config.csv ──
    "pollrates": [
      {
        "rate": 5000,          # lograte column, milliseconds
        "packets": [
          {
            "device_id": "DEVICE_A",
            # ...protocol-specific address fields...
            # OPC UA:  "addresses": ["ns=2;s=Tag1", ...]
            # Modbus:  "slaves": [{"slaveid": 1, "indexes": [...]}]
            # S7:      "address": [10, 20], "areatype": ["DB51", "MW"]
            "tags": [
              {"tag": "Temperature", "node_id": "...", ...}
            ]
          }
        ]
      }
    ]
  }
]
```

**Important:** The `server_key` used to match CSV rows to `sys_parameters polling[]` must match **exactly** what `app.py` uses to identify a server (typically `server_entry["protocol"]["server"]`).

**Grouping strategies by protocol:**
| Protocol | Grouping |
|----------|---------|
| OPC UA | server → rate → device → list of node IDs (flat parallel arrays) |
| Modbus TCP | (server, port) → rate → device → slave ID → contiguous register blocks |
| S7 | server → rate → device → (area, byte offset) blocks (parallel arrays) |

---

#### Tag Grouping Hierarchy — Detailed

The three-level hierarchy (server → poll rate → device) is consistent across all protocols. What differs is the **innermost grouping** within a device packet — this is where protocol-specific address batching happens.

**Level 1: Server**
CSV `server` column must exactly match a `protocol.server` value in `sys_parameters.json`. This is the merge key. Note: Modbus uses a composite key `(server, port)`.

**Level 2: Poll Rate**
Tags with the same `lograte` value are grouped into one rate bucket. A server with tags at `lograte=1000` and `lograte=5000` produces 2 `pollrates[]` entries. `app.py` schedules them independently.

**Level 3: Device ID**
Within a rate, tags are grouped by `device` column. Each device becomes one `packet` → one `client.read(packet)` call → one payload posted to the broker.

**Level 4 (protocol-specific): Address Batching Within a Device Examples:**

---

**OPC UA** — flat parallel arrays of node IDs and tag definitions

Each OPC UA node ID maps to one entry in `addresses[]`. The parallel `tags[]` list holds the tag metadata. When consecutive CSV rows share the **same node ID** (array nodes), they are merged into the same inner list entry — this enables reading multiple values from a single array node in one call.

```python
# From ioconnect-opcua/src/csvparser.py
{
    "device_id": "WELLSAWEXP3_A1",
    "addresses": [                     # OPC UA node IDs — one per address block
        "ns=2;s=Tag10",
        "ns=2;s=Tag11",
        "ns=2;s=Tag12"
    ],
    "tags": [                          # parallel — tags[i] describes addresses[i]
        {
            "tag_name":      ["D0"],   # list: multiple names if isarray=yes
            "array_indexes": [0],      # index into array node; 0 for scalars
            "data_type":     ["bool"],
            "byte_order":    ["ABCD"],
            "resolution":    [3],
            "isarray":       "no"
        },
        {
            "tag_name":      ["D1"],
            "array_indexes": [0],
            "data_type":     ["float"],
            "byte_order":    ["ABCD"],
            "resolution":    [3],
            "isarray":       "no"
        },
        {
            "tag_name":      ["D2"],
            "array_indexes": [0],
            "data_type":     ["bool"],
            "byte_order":    ["ABCD"],
            "resolution":    [3],
            "isarray":       "no"
        }
    ]
}
# → 1 OPC UA read_nodes() call with all 3 node IDs for this device per poll cycle
```

---

**Modbus** — slave → function-code → contiguous register blocks

Tags are grouped into `indexes[]` blocks where each block is one Modbus read request. Tags are merged into the same block if they have the same slave ID, same function code, contiguous register addresses (`address == prev_address + prev_len`), and total block length ≤ 125 registers. A new block starts when any of these conditions breaks.

```python
# From ioconnect-modbus/src/csvparser.py
# CSV: WELLSAWUTL_SW,1,165,1,D0,int,ABCD,4,3,10.14.62.51,502,10000
#      WELLSAWUTL_SW,1,166,2,D1,ulong,CDAB,4,3,10.14.62.51,502,10000
{
    "device_id": "WELLSAWUTL_SW",
    "slaves": [
        {
            "slaveid": 1,
            "indexes": [
                {
                    # D0 (addr=165, len=1) and D1 (addr=166, len=2) are contiguous
                    # and same fcode=4 → merged into one read request
                    "fncode":  "4",    # function code: 4=input registers
                    "address": 165,    # starting register address
                    "length":  3,      # total registers: 1 + 2 = 3
                    "tags": [
                        {
                            "tag_name":        "D0",
                            "address":         165,   # absolute register address
                            "register_length": 1,     # registers consumed (16-bit)
                            "data_type":       "int",
                            "byte_order":      "ABCD",
                            "resolution":      3,
                            "fncode":          "4"
                        },
                        {
                            "tag_name":        "D1",
                            "address":         166,   # 165 + 1 (contiguous)
                            "register_length": 2,     # registers consumed (32-bit)
                            "data_type":       "ulong",
                            "byte_order":      "CDAB",
                            "resolution":      3,
                            "fncode":          "4"
                        }
                    ]
                }
                # If there were tags with fcode=3, they would start a new indexes[] entry
            ]
        }
    ]
}
# → 1 Modbus read request (FC4, addr=165, count=3) for this device per poll cycle
```

---

**S7** — parallel arrays of (area, byte-offset) with bit-level grouping

The S7 csvparser parses Siemens-notation addresses (e.g. `DB51,DBW10`) into `(area, byte_offset, bit_offset, length)` tuples. Tags are stored as parallel arrays: `address[i]`, `areatype[i]`, and `tags[i]` all correspond to the same memory location. When consecutive CSV rows have the **same byte offset AND same area type**, they are merged into the same inner list — this batches multiple bit fields at the same byte address (e.g. I1.0, I1.1, I1.2 → all at byte=1, area="I").

```python
# From ioconnect-s7-python/src/csvparser.py
# CSV rows (parseAddr results):
#   DB51,DBW10  → ("DB51", byte=10, bit=0, len=2)  → D11
#   DB51,DBD20  → ("DB51", byte=20, bit=0, len=4)  → D8
#   MW71        → ("M",    byte=71, bit=0, len=2)   → D6 (note: MW = Merker Word)
#   DB32,DBD98  → ("DB32", byte=98, bit=0, len=4)  → D9
#   DB50,DBW18  → ("DB50", byte=18, bit=0, len=2)  → D6
{
    "device_id": "WELLSAW",
    "address":  [10,     20,     71,    98,     18    ],  # byte offsets
    "areatype": ["DB51", "DB51", "M",   "DB32", "DB50"],  # memory areas
    "tags": [
        {"tagName": ["D11"], "bit_offsets": [0], "length": [2], "datatype": ["sint"],  "resolution": [3]},
        {"tagName": ["D8"],  "bit_offsets": [0], "length": [4], "datatype": ["float"], "resolution": [3]},
        {"tagName": ["D6"],  "bit_offsets": [0], "length": [2], "datatype": ["float"], "resolution": [3]},
        {"tagName": ["D9"],  "bit_offsets": [0], "length": [4], "datatype": ["float"], "resolution": [3]},
        {"tagName": ["D6"],  "bit_offsets": [0], "length": [2], "datatype": ["float"], "resolution": [3]}
    ]
}
# bit field example — if config had I1.0, I1.1, I1.2 they'd merge into one tags[i]:
# {"tagName": ["Input0","Input1","Input2"], "bit_offsets": [0,1,2], "length": [1,1,1], ...}
# → 1 S7 multi-var read with all 5 (area, offset, length) tuples per poll cycle
```

---

#### Summary: Read Requests Per Poll Cycle

| Protocol | Read requests per poll cycle per device |
|----------|----------------------------------------|
| OPC UA | 1 `read_nodes()` call — all node IDs in one request |
| Modbus | N `read_registers()` calls — one per contiguous register block per slave per fcode |
| S7 | 1 multi-var read — all `(area, byte_offset, length)` tuples in one request |

The batching logic in csvparser.py is what enables this efficiency. It's the main reason csvparser exists as a separate module rather than inline parsing in app.py.

---

**Reference implementations:**
- [`ioconnect-opcua/src/csvparser.py`](https://github.com/Faclon-IoT-Team/ioconnect-opcua-python/blob/main/src/csvparser.py)
- [`ioconnect-modbus/src/csvparser.py`](https://github.com/Faclon-IoT-Team/ioconnect-modbus-python/blob/main/src/csvparser.py) (most complex — includes register contiguity packing, ≤125 register limit)
- [`ioconnect-s7-python/src/csvparser.py`](https://github.com/Faclon-IoT-Team/ioconnect-s7-python/blob/main/src/csvparser.py) (includes S7 address parser + bit-field grouping)

---

### `src/posthandler.py` — Data Forwarding Engine

**Role:** Routes polled payloads to the configured destination (MQTT / HTTP / Redpanda Kafka). Never blocks the polling loop.

> **Python adapters:** Copy [`ioconnect-opcua/src/posthandler.py`](https://github.com/Faclon-IoT-Team/ioconnect-opcua-python/blob/main/src/posthandler.py) verbatim. This file is identical across all three existing adapters. Any bug fix must be replicated to all adapter repos.

**For other languages, implement:**

```
class post_handler:
    __init__(posting_config, write_index, cmd_server_config, client_registry)
    post(payload: dict)   — enqueue payload (non-blocking; background thread delivers)
    close()               — flush queue and disconnect

Backends (posting_config["type"]):
  "mqtt"     — paho-mqtt or equivalent; topic = "devicesIn/{device_id}/data"
  "http"     — POST to host:port/path with custom headers
  "redpanda" — Kafka producer to bootstrap_servers; topic = "devicesIn.{device_id}.data"

Resilience:
  - Queue + background worker thread (polling loop never waits on network)
  - SQLite (or equivalent) local backup: write to disk on send failure; replay on reconnect
  - Max backup file size: 5 MB (rotation)

Optional write command server (when cmd_server_config["enabled"] == true):
  "http" type: open an HTTP server on cmd_server_config["port"] accepting POST
  "mqtt" type: subscribe to a write command topic
  On receipt: look up (device_id, tag_name) in write_index, call client_registry[server].write(...)
```

---

### `src/metrics.py` — Prometheus Metrics

**Role:** Exposes a `/metrics` HTTP endpoint on `$METRICS_PORT`. Provides standard KPI metrics for Grafana.

**Required metrics** (replace `<prefix>` with your protocol slug, e.g. `opcua`, `modbus`, `s7`):

| Metric | Type | Labels | Fed by |
|--------|------|--------|--------|
| `<prefix>_poll_latency_ms` | Histogram | server, device_id, poll_rate_ms | `app.py` — duration of `client.read(packet)` |
| `<prefix>_poll_jitter_ms` | Histogram | server, poll_rate_ms | `app.py` — deviation from configured poll interval |
| `<prefix>_poll_cycle_duration_ms` | Histogram | server, poll_rate_ms | `app.py` — total time across all packets in a rate group |
| `<prefix>_tags_polled_total` | Counter | server, device_id, poll_rate_ms, status | `app.py` — increment by good/bad tag count per packet |
| `<prefix>_poll_requests_total` | Counter | server, device_id, poll_rate_ms, result | `app.py` — increment success/error per `client.read()` |
| `<prefix>_connection_status` | Gauge | server | `app.py` — set to 1 (connected) or 0 (disconnected) each iteration |
| `<prefix>_poll_latency_peak_ms` | Gauge | server, device_id, poll_rate_ms | `app.py` — lifetime max latency |
| `<prefix>_poll_latency_min_ms` | Gauge | server, device_id, poll_rate_ms | `app.py` — lifetime min latency |
| `<prefix>_poll_jitter_peak_ms` | Gauge | server, poll_rate_ms | `app.py` — lifetime max jitter |
| `<prefix>_poll_jitter_min_ms` | Gauge | server, poll_rate_ms | `app.py` — lifetime min jitter |

**Histogram buckets** (25 high-resolution buckets from 1ms to 5000ms):
```
1, 2, 5, 10, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275,
300, 375, 400, 425, 450, 475, 500, 1000, 2500, 5000
```

**Singleton pattern:** Use a thread-safe singleton so the same `Metrics` instance is shared across all polling threads.

**`init_device_counters(server, device_id, poll_rate_ms)`:** Pre-initialize `<prefix>_tags_polled_total` with status=`good` and status=`bad` at 0 before polling starts, so Grafana shows 0% bad tag rate instead of "No data".

> **Python adapters:** Copy [`ioconnect-opcua/src/metrics.py`](https://github.com/Faclon-IoT-Team/ioconnect-opcua-python/blob/main/src/metrics.py) and change only the `METRIC_PREFIX` constant and the 9 metric name strings.

---

### `src/logger.py` — Structured JSON Logging

**Role:** All log output is single-line JSON (one record per line), written to stdout (captured by systemd journald) and optionally to a rotating file.

**Required JSON log record shape:**
```json
{
  "time":     "2024-05-01T10:30:45.123+00:00",
  "level":    "INFO",
  "service":  "ioconnect-myproto",
  "file":     "app.py",
  "function": "poll",
  "thread":   "Thread-1",
  "message":  "Poll cycle finished",
  "server":   "192.168.1.100",
  "rate_ms":  5000,
  "elapsed_ms": 12.4
}
```

**Environment variables:**
- `SERVICE_NAME` — written into `"service"` field (set by install.sh via env/.env.api)
- `LOG_LEVEL` — `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` (default: `INFO`)
- `LOG_DIR` — if set, also write to `$LOG_DIR/$SERVICE_NAME.log` with rotation (10 MB / 5 backups)

**Usage from other modules:**
```python
from logger import get_logger
logger = get_logger(__name__)
logger.info("Poll read completed", extra={"ctx": {"server": "...", "elapsed_ms": 12.4}})
```
All keys in `extra["ctx"]` are merged into the top-level JSON object.

> **Python adapters:** Copy [`ioconnect-opcua/src/logger.py`](https://github.com/Faclon-IoT-Team/ioconnect-opcua-python/blob/main/src/logger.py) verbatim (53 lines). Change only the `SERVICE_NAME` default on line 9 to `"ioconnect-<yourproto>"`.

---

## Environment Variables

Two-file model:

| File | Set by | Contains | Read by |
|------|--------|---------|---------|
| `.env` | Jenkins CI / `cp .env.example .env` | `APP_NAME`, `VITE_*` build vars, `KAFKA_*` identity | `install.sh`, Vite build |
| `env/.env.api` | `install.sh` (auto-generated) | `PORT`, `METRICS_PORT`, `SERVICE_NAME`, absolute paths, `LOG_DIR` | systemd `EnvironmentFile=` for both Python and Node services |

Never hand-edit `env/.env.api` — re-run `install.sh` to regenerate it.

**Platform-injected variables** (set in `/etc/environment` by IoConnect):

| Variable | Value | Used by |
|----------|-------|---------|
| `REDPANDA_KAFKA_ADDRESS` | `localhost:9092` | `app.py` — overrides posting config |
| `REDPANDA_KAFKA_SECURITY_PROTOCOL` | e.g. `SASL_SSL` | `app.py` |
| `REDPANDA_KAFKA_SASL_MECHANISM` | e.g. `SCRAM-SHA-256` | `app.py` |
| `REDPANDA_KAFKA_SASL_USERNAME` | credential | `app.py` |
| `REDPANDA_KAFKA_SASL_PASSWORD` | credential | `app.py` |
| `LSG_APPS_HOME` | e.g. `/opt/lsg-apps` | `install.sh` |
| `LSG_APP_DATA` | e.g. `/var/lib/lsg-app-data` | `install.sh` |
| `NGINX_SNIPPET_DIR` | e.g. `/etc/nginx/lsg-app-locations.d` | `install.sh` |

---

## Running Locally (No Install)

Test your implementation without running install.sh:

```bash
# 1. Create a venv and install dependencies
python3.12 -m venv venv
./venv/bin/pip install -r requirements.txt

# 2. Copy and fill in the config files
cp sample-configs/sys_parameters.json .
cp sample-configs/config.csv .
# Edit sys_parameters.json with real device connection details
# Edit config.csv with real tag rows

# 3. Set required environment variables
export FILES_BASE_DIR=.
export SERVICE_NAME=ioconnect-myproto
export LOG_LEVEL=DEBUG

# 4. Run the adapter
cd src && ../venv/bin/python app.py
```

The adapter will start polling and print JSON logs to stdout. Prometheus metrics are available at `http://localhost:9464/metrics`.

---

## Configurator (ioconnect-protocol-configurator)

### What the Configurator Is

The configurator is a shared web UI for editing the two config files (`sys_parameters.json` and `config.csv`) from a browser. All protocol adapters share the **same React + Vite frontend repo** (`ioconnect-protocol-configurator`), but each adapter has its own **schema file** that defines what form fields to show. The schema profile is selected at build time via `VITE_CONFIG_PROFILE`.

**Repo:** [`ioconnect-protocol-configurator`](https://github.com/Faclon-IoT-Team/ioconnect-protocol-configurator) (clone as a sibling of your adapter folder in the ioconnect workspace)

### Schema Files

```
ioconnect-protocol-configurator/
└── configs/
    ├── opcua/
    │   └── schema.json    ← OPC UA form definition
    ├── modbus/
    │   └── schema.json    ← Modbus form definition
    └── s7/
        └── schema.json    ← S7 form definition
    └── <yourproto>/
        └── schema.json    ← NEW: create this for your protocol
```

`schema.json` defines:
- **`polling.fields[]`** — form fields for `sys_parameters.json` `protocol` block (server URL, port, rack, auth, etc.)
- **`csv.columns[]`** — CSV column definitions for the tag table (column names, data types, validation rules)
- UI labels and help text

**To add a new protocol schema:**
1. Create `ioconnect-protocol-configurator/configs/<yourproto>/schema.json`
2. Use an existing schema as a starting point (e.g. `configs/opcua/schema.json` for URL-based addressing, `configs/modbus/schema.json` for IP+port+register addressing)
3. Update `polling.fields[]` to match your `sys_parameters.json` `protocol` block fields
4. Update `csv.columns[]` to match your `config.csv` column schema
5. Set `VITE_CONFIG_PROFILE=<yourproto>` in Jenkinsfile and `.env.example`

### How the Configurator is Built and Deployed

**In Jenkins (automated):**
Stage 2 clones the `ioconnect-protocol-configurator` repo. Stage 3 runs `npm run build` with `VITE_CONFIG_PROFILE` set from Jenkinsfile parameters — Vite bakes the schema selection into the compiled JS bundle at build time.

```groovy
// Jenkinsfile Stage 3 — Build Configurator
sh """
  cd configurator
  VITE_CONFIG_PROFILE=${params.VITE_CONFIG_PROFILE} \\
  VITE_APP_NAME="${params.VITE_APP_NAME}" \\
  npm run build
"""
```

**For manual testing (local dev):**
```bash
# 1. Navigate to the configurator repo (must be cloned as a sibling of your adapter folder and named as configurator)
cd /path/to/ioconnect/configurator

# 2. Create a .env.local pointing to your new protocol schema
echo "VITE_CONFIG_PROFILE=yourproto" > .env.local
echo "VITE_APP_NAME=YourProto Configurator" >> .env.local

# 3. Install and run the dev server
npm install
npm run dev
# → The configurator will now use configs/yourproto/schema.json
```

> **Backend note:** The configurator reads/writes config files via a backend API (the configurator systemd service installed by install.sh). For local testing without a full install, you'll need to run the configurator backend separately or point it at your local config files. See the configurator repo's README for backend setup.

---

## Non-Protocol App Adaptation Guide

If your app is not a protocol adapter, some parts of the Jenkinsfile and install.sh don't apply. This guide maps each scenario to the specific changes needed.

Search for `# GENERIC-APP NOTE:` in `scripts/install.sh` — these markers identify every place where protocol-adapter-specific behavior can be changed or skipped.

---

### Headless Python App (no web UI)

An OEE engine, rules engine, data forwarder, or any Python service that only produces/consumes Kafka messages with no browser interface.

**Jenkinsfile:** Remove Stages 2 and 3 entirely (no configurator to clone or build). Remove `configurator/` from the zip command in Stage 4.

**install.sh:** Run with `--no-ui` flag, or comment out Steps 4, 7b, and the nginx snippet generation. The `--no-ui` path is already fully supported — every configurator step checks `$NO_UI` before executing.

**manifest:** Set `uiEnabled: false`, remove `uiPath` and `apiPath`. Set `"healthCheckPath": null` if the app has no HTTP server. Omit `monitoring` if no Prometheus endpoint.

---

### Pure Node.js App (no Python daemon)

A Node.js-based microservice, data bridge, or REST API.

**Jenkinsfile:** Keep Stages 2-3 if using the shared configurator UI. Otherwise replace Stage 2 with a clone of your own UI repo, or remove Stages 2-3 for a no-UI app.

**install.sh:**
- Skip Step 3 (Python venv) — remove the venv creation and pip install block
- Step 1: Remove the `python3.12` dependency check
- Step 7a (main service): change `ExecStart` from `${VENV_DIR}/bin/python ${PROTOCOL_DIR}/src/app.py` to `$(which node) ${PACKAGE_DIR}/src/index.js`
- Remove `requirements.txt` from path validation checks

**manifest:** Same structure. No Python-specific fields exist in the manifest.

---

### App with Custom UI (not ioconnect-protocol-configurator)

If your app has its own React/Vue/Angular frontend in a separate repo:

**Jenkinsfile Stage 2:** Replace the `git clone ${CONFIGURATOR_REPO}` command with a clone of your own UI repo into `configurator/`. Stage 3 (npm ci + npm run build) works as-is if your frontend follows the same `package.json` + `dist/` convention.

**Alternatively** (UI already in the app repo): Remove Stage 2 and adjust Stage 3 to build from the checked-out source directly.

**nginx snippet:** Update the `alias` path in Pattern A to point to wherever your build outputs its static files (not necessarily `configurator/dist/`).

---

### Adapting install.sh Checklist

| Step | What to change | When |
|------|----------------|------|
| Step 1 — dependency check | Remove `python3.12` check | Pure Node.js app |
| Step 3 — Python venv | Skip or remove entirely | No Python at runtime |
| Step 4 — npm install | Skip if `--no-ui`; or adjust dirs | Headless app or custom UI location |
| Step 7a — Protocol service ExecStart | Change to `node`, `java`, etc. | Non-Python main service |
| Step 7b — Configurator service | Skip if no Node.js API backend | Headless app |
| Step 10 — nginx snippet | Use Pattern B (API-only) or omit | No UI; or no HTTP API at all |
| Manifest generation — `uiEnabled` | Set `false` | Headless app |
| Manifest generation — `monitoring` | Omit block | No Prometheus endpoint |
| Manifest generation — `healthCheckPath` | Set `null` | No HTTP server |

---

## Architecture Reference

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full IOConnect platform architecture, including:
- LSG-App orchestrator design and startup sequence
- Data forwarding topology (local Redpanda broker → Redpanda Connect pipelines → external endpoints)
- Nginx single-port routing (how all UIs share port 80)
- Cloud connection and MQTT command topics
- `app_manifest.json` and `app-registry.json` data structures
- Technology stack overview
