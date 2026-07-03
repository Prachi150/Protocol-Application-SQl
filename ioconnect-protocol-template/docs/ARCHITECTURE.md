# IOConnect Platform Architecture

## Overview

IOConnect is an industrial IT/OT edge platform that bridges industrial field devices (PLCs, sensors, SCADA systems) to cloud-based management and data pipelines. It runs on a Linux gateway device installed at a customer site.

The platform has three tiers:

1. **LSG-App (Linux System Gateway)** — the central orchestrator running on the edge device
2. **Protocol Adapters** (this repo) — installable apps that speak industrial protocols
3. **ioadmin** — the cloud control plane for remote management (not in this repo)

```
                        ┌──────────────────────────────────────────────────────────┐
                        │                  Edge Gateway Device                     │
                        │                                                          │
                        │  ┌────────────┐    ┌──────────────────────┐             │
  Field Devices         │  │  Protocol  │───▶│  Redpanda (Kafka)    │             │
  (PLCs, SCADA,  ───────┼─▶│  Adapter   │    │  Local Broker :9092  │             │
   Sensors)             │  │ (this app) │    └──────────┬───────────┘             │
                        │  └────────────┘               │                         │
                        │                     Redpanda Connect Pipelines           │
                        │  ┌────────────┐               │                         │
                        │  │  LSG-App   │    manages    │       ┌───────────────┐ │
                        │  │(Orchestrat)│───────────────┘       │ Configurator  │ │
                        │  └─────┬──────┘                       │  (Web UI)     │ │
                        │        │                              └───────────────┘ │
                        │        │  Nginx :80 routes all UIs + APIs               │
                        └────────┼─────────────────────────────────────────────────┘
                                 │ MQTT (always-on)       │ MQTT / HTTP / Kafka
                                 ▼                        ▼
                            ioadmin Cloud          External Endpoints
                         (Remote Management)    (cloud MQTT broker, REST APIs,
                                                 remote Kafka/Redpanda)
```

---

## LSG-App (Orchestrator)

### Role

LSG-App is a Node.js + Express process that acts as the gateway's brain. It:

- Serves a React web UI for local administration
- Manages the lifecycle of installed protocol adapters
- Maintains an always-on MQTT connection to the ioadmin cloud
- Manages data forwarding pipelines (via Redpanda Connect)
- Handles first-run setup, authentication, and secret management

### Startup Sequence

```
1. configManager.init()      → Load config/app-config.json
2. appRegistry.init()        → Load registry of installed protocol apps
3. Mount Express routes      → /api/* and static client/build/
4. initMasterMqttClient()    → Connect to ioadmin (if onboarded)
5. heartbeatService.start()  → Begin periodic status reporting
6. app.listen(3001)
```

### Key Services

#### ConfigManager (`src/services/configManager.js`)
Two-layer configuration system:
- **Layer 1 (immutable)**: Environment variables loaded from `/run/lsg-app/secrets.env` at boot — JWT secret, admin credentials, MQTT broker credentials
- **Layer 2 (runtime)**: `config/app-config.json` — VPN state, onboarding status, data forwarding settings; persisted and mutated at runtime via EventEmitter-notified updates

#### AppRegistry (`src/services/appRegistry.js`)
Central registry for installed protocol adapters:
- Each adapter's `install.sh` writes an `app_manifest.json` describing its ports, UI paths, script locations, and health check endpoint
- LSG-App reads that manifest and persists it to `config/app-registry.json`
- Used to enumerate installed apps, invoke lifecycle scripts, and proxy health checks

#### Master MQTT Client (`src/services/masterMqttClient.js`)
Always-on MQTT connection to the ioadmin cloud broker:
- Subscribes to `lsg/<token>/cmd/#` for incoming commands (install app, toggle VPN, sync config)
- Implements request-response patterns (e.g., request a signed S3 URL for a protocol zip download)
- Exposes connection telemetry (`getStatus()`) for the Overview page

#### Heartbeat Service (`src/services/heartbeatService.js`)
Periodic status reports to ioadmin (default every 60 seconds):
- Reports: hostname, IP addresses, MAC addresses, installed apps list, uptime
- Sends an out-of-band heartbeat immediately on network state changes (VPN toggle, interface up/down)
- Only active after the device has completed onboarding

### Authentication

Three-layer security model in production:

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| Nginx Basic Auth | APR1-MD5 htpasswd | Browser UI and `/apps/*` |
| setupGuard middleware | Blocks all routes until setup complete | All Express routes |
| JWT | Application-level auth | All `/api/*` endpoints post-setup |

### Secret Management

- **Safe config**: `/etc/lsg-app/config.env` — non-sensitive settings (plaintext)
- **Secrets**: `/etc/lsg-app/secrets.env.age` — bcrypt password hash, JWT secret, MQTT credentials (age-encrypted, device-specific key)
- **At boot**: Systemd ExecStartPre decrypts and concatenates both into `/run/lsg-app/secrets.env` (tmpfs, never written to disk)
- **Pipeline secrets**: Separate `/etc/lsg-app/forwarder-secrets.env.age` bundle (rotatable independently)

### First-Run Setup Flow

LSG-App's `install.sh` supports two modes selected at install time:

**Interactive mode (default — no flags)**
The installer prompts for admin credentials and MQTT broker passwords at the terminal. All secrets are encrypted with `age` before the service starts. The device is fully configured on first boot — no browser setup step is needed.

**Deferred setup mode (`--defer-setup` flag)**
Skips all secret prompts. The service starts in setup mode, writing only a minimal secrets bundle. The browser wizard must then be completed:

1. `install.sh --defer-setup` writes a one-time setup token to `/etc/lsg-app/setup-token` and starts the service with `SETUP_COMPLETE=false`
2. Browser hits `http://<device-ip>` → React detects `SETUP_COMPLETE=false`, redirects to `/setup`
3. Setup wizard collects admin username + password
4. POST to `/api/setup/complete` with the one-time token in the request header
5. `setupService.js` bcrypts the password, encrypts all secrets with `age`, shreds temp files and the token, then triggers `systemctl restart lsg-app`

**Re-install modes**
- `--preserve` — keeps existing secrets, Basic Auth, and app config; regenerates only the Nginx site, systemd unit, and sudoers file. Used for code-only updates.
- `--flush` — wipes all app config and runs a fresh interactive setup. Used for recovery or clean reinstall.

---

## Protocol Adapter: [YOUR PROTOCOL NAME] (This App)

<!-- REPLACE: Fill in your protocol name in the heading above and throughout this section. -->

### Role

<!-- REPLACE: Describe what industrial protocol this adapter implements and what field
     devices it communicates with. Include any special capabilities (authentication modes,
     connection types, supported function codes, etc.).

     Example from OPC UA adapter:
       "This adapter connects to one or more OPC UA servers (industrial PLCs, SCADA systems,
        historians) and reads tag values via periodic polling. Collected data is forwarded
        to a local Redpanda Kafka broker. A web configurator UI lets operators edit the
        poll configuration without touching files."
-->

### Installation Flow (`scripts/install.sh`)

The install script is invoked by LSG-App after downloading and extracting the protocol zip:

```
1. Parse flags (--no-ui, --no-ioconnect)
2. Verify system dependencies (python3.12, python3.12-venv, node, npm, nginx)
3. Resolve paths from LSG_APPS_HOME and .env
4. Create Python venv at venv/
5. Install Python packages from requirements.txt
   (offline from packages/ dir, or PyPI if online)
6. npm install for configurator (frontend + server)
7. Find free ports (protocol API, configurator, metrics)
8. Write env/.env.api with SERVICE_NAME, FILES_BASE_DIR, PORT, METRICS_PORT, etc.
9. Write systemd units:
   - lsg-<name>.service              → venv/bin/python src/app.py
   - lsg-<name>-configurator.service → node configurator/server/dist/index.js
10. Copy units to /etc/systemd/system/, enable and start
11. Write Nginx snippet at $NGINX_SNIPPET_DIR/lsg-<name>.conf
    (proxies /apps/lsg-<name>/ and /apps/api/lsg-<name>/)
12. nginx -t && systemctl reload nginx
13. Write app_manifest.json with final ports and paths
```

### Configuration Files

#### `sys_parameters.json` — Server and Posting Config

<!-- REPLACE: Document your protocol's polling[] block structure here.
     Show the full JSON schema with field descriptions, just like the OPC UA example:

     ```json
     {
       "polling": [{
         "protocol": {
           "type": "myproto",
           "server": "192.168.1.100",
           "port": 502,
           ...your-protocol-fields...
         },
         "connection_type": "persist",
         "connect_retry_count": 3,
         ...
       }],
       "posting": [{ "type": "redpanda", ... }]
     }
     ```

     Document what each field means and what values are accepted.
     The posting[] section is identical across all adapters — only document
     what is different in your protocol block.
-->

**`connection_type`** options: `persist` (long-lived), `nonpersist` (connect/disconnect per read)  
**`posting.type`** options: `redpanda`, `mqtt`, `http`

#### `config.csv` — Tag Database

<!-- REPLACE: List every column your CSV schema uses, with description and example.
     The table below has the three mandatory columns pre-filled.
     Add your protocol-specific columns below them. -->

| Column | Description | Example |
|--------|-------------|---------|
| `device` | Device identifier (becomes "device" field in posted payload) | `Pump_01` |
| `server` | Server address — must match a `polling[].protocol.server` entry in sys_parameters.json | `192.168.1.100` |
| `lograte` | Poll interval in milliseconds | `5000` |
| `...` | <!-- REPLACE: add your protocol-specific columns --> | |

### Source Code (`src/`)

<!-- REPLACE: Briefly describe each file in your src/ directory and what it does.
     The sections below mirror the modules documented in README.md — expand them
     with implementation details specific to your protocol. -->

#### `app.py` (or equivalent entry point)

<!-- REPLACE: Describe your main polling loop implementation. -->

Entry point. On startup:
1. Reads `sys_parameters.json` and `config.csv`
2. Calls `csvparser.read()` to merge tag rows with server config
3. Starts the Prometheus metrics server on `$METRICS_PORT`
4. Resolves broker config (`REDPANDA_KAFKA_ADDRESS` env → `sys_parameters.json posting[0]`)
5. Instantiates one protocol client per server entry
6. Spawns one polling thread per server (one thread = isolated failure domain)
7. Threads loop: for each rate group, calls `client.read(packet)`, posts payload, updates metrics

#### `<protocol_client>.py` (or equivalent)

<!-- REPLACE: Describe your protocol client. Cover:
     - Which library it wraps
     - Connection modes (persist / nonpersist)
     - Authentication and encryption options (if any)
     - Data types supported
     - Byte order / endianness handling (if relevant)
     - Write support (if implemented)
-->

#### `csvparser.py` (or equivalent)

<!-- REPLACE: Describe how your CSV parser groups tags into the hierarchical poll config.
     Explain the grouping strategy (e.g. by slave ID for Modbus, by DB area for S7).
     Show the output structure consumed by app.py's polling loop.
-->

Transforms the flat `config.csv` into the nested poll config:

```
Input:  flat CSV rows (one row = one tag/register/node)
Output: hierarchical structure:
  [
    {
      "protocol": { "server": "...", ...connection fields... },
      "pollrates": [
        {
          "rate": 5000,
          "packets": [
            {
              "device_id": "DEVICE_01",
              ...protocol-specific address groupings...
              "tags": [...]
            }
          ]
        }
      ]
    }
  ]
```

#### `posthandler.py` (or equivalent)

Sends polled data to the configured destination. Three backends:

| Backend | Library | Notes |
|---------|---------|-------|
| `redpanda` / `kafka` | `confluent-kafka` | Publishes to local Redpanda broker; supports SASL/SSL |
| `mqtt` | `paho-mqtt` | Configurable host, port, credentials, QoS |
| `http` | `requests` | POST to arbitrary endpoint; custom headers |

Uses a queue + background thread so the polling loop never blocks on network I/O. Falls back to a local SQLite buffer when the destination is unreachable.

> **Note:** The Python implementation of posthandler.py is identical across all IoConnect protocol adapters. Copy it directly from `protocol-opcua/src/posthandler.py` for Python-based adapters.

#### `metrics.py` (or equivalent)

Exposes a `/metrics` endpoint (Prometheus format) on `$METRICS_PORT`:

| Metric | Type | Labels |
|--------|------|--------|
| `<prefix>_poll_requests_total` | Counter | `server`, `device_id`, `poll_rate_ms`, `result` |
| `<prefix>_poll_latency_ms` | Histogram | `server`, `device_id`, `poll_rate_ms` |
| `<prefix>_poll_jitter_ms` | Histogram | `server`, `poll_rate_ms` |
| `<prefix>_poll_cycle_duration_ms` | Histogram | `server`, `poll_rate_ms` |
| `<prefix>_tags_polled_total` | Counter | `server`, `device_id`, `poll_rate_ms`, `status` |
| `<prefix>_connection_status` | Gauge | `server` |
| `<prefix>_poll_latency_peak_ms` | Gauge | `server`, `device_id`, `poll_rate_ms` |
| `<prefix>_poll_latency_min_ms` | Gauge | `server`, `device_id`, `poll_rate_ms` |
| `<prefix>_poll_jitter_peak_ms` | Gauge | `server`, `poll_rate_ms` |
| `<prefix>_poll_jitter_min_ms` | Gauge | `server`, `poll_rate_ms` |

<!-- REPLACE: Update the `<prefix>` placeholder with your protocol slug (e.g. opcua_, modbus_, s7_). -->

#### `logger.py` (or equivalent)

JSON-formatted log output with per-record context fields (server, device_id, rate_ms, latency). Written to `$LOG_DIR` and to stdout (captured by systemd journal).

> **Note:** The Python implementation of logger.py is identical across all IoConnect protocol adapters. Copy it directly from `protocol-opcua/src/logger.py` for Python-based adapters; change only the `SERVICE_NAME` default value.

### Configurator Web UI

Each protocol adapter ships its own configuration UI (a full Vite + React + TypeScript app with an Express backend). It is served by Nginx at `/apps/<APP_NAME>/`.

#### Frontend (React)
- **JSON tab**: Schema-driven form for `sys_parameters.json`. Form fields and their visibility are declared in `schema.json` for your protocol's `VITE_CONFIG_PROFILE`.
- **CSV tab**: Spreadsheet-style editor for `config.csv`. Changes are staged in localStorage before an explicit Save.
- **Monitor tab**: Real-time tag values read from the local Redpanda broker via Server-Sent Events.
- **Logs tab**: Tailed output of the Python service's log file, also via SSE.

#### Backend (Express)
- `GET /api/files/read-default?type=json|csv` — Reads `sys_parameters.json` or `config.csv` from `FILES_BASE_DIR`
- `POST /api/files/write-default` — Writes updated file content
- `GET /api/service/status` — Checks systemd service state
- `POST /api/service/{start|stop|restart}` — Shells out to lifecycle scripts in `SCRIPTS_DIR`
- `GET /api/monitor/stream` — SSE stream; Kafka consumer subscribes to topics discovered from `config.csv`

---

## Data Forwarding Architecture

### Topology

```
Protocol Adapter (Python)
      │
      │  publish to topic "devicesIn.<device_id>.data"
      ▼
Redpanda Broker (local, port 9092)
      │
      │  consume
      ▼
Redpanda Connect Pipeline (per-destination YAML, one systemd unit each)
      │
      ├──▶ External MQTT broker      (new MQTT connection opened by the pipeline)
      ├──▶ HTTP endpoint             (direct HTTP POST)
      └──▶ Remote Kafka / Redpanda Cloud
```

Data flows **directly** from a Redpanda Connect pipeline to the external destination. The LSG-App orchestrator is **not** in the data path — it only manages the pipeline lifecycle (creates/deletes YAML files and systemd units).

**Why a local broker in the middle?**
- **Decoupling**: The protocol adapter does not need to know about downstream destinations
- **Buffering**: Redpanda persists messages to disk; if the external destination goes offline, no data is lost — the pipeline replays when it reconnects
- **Fan-out**: Multiple pipelines can consume the same topic independently

### Pipeline Lifecycle (managed by LSG-App)

1. User creates a pipeline in the LSG-App Data Forwarding UI (or ioadmin pushes one via MQTT command)
2. POST `/api/redpanda/pipeline` with pipeline name + Redpanda Connect YAML
3. LSG-App stages YAML, runs `redpanda connect lint` to validate
4. If pipeline secrets are included, merges them into the forwarder-secrets encrypted bundle
5. Moves YAML to `/etc/redpanda-connect/pipelines/<name>.yml`
6. `systemctl enable --now redpanda-connect@<name>.service`

---

## Nginx: Single-Port Routing

All web UIs and their backend APIs are accessed through a single Nginx instance on port 80. This is what makes the platform feel like one cohesive product even though it is composed of separately installed services.

### How it works

LSG-App's `install.sh` creates the **master Nginx site** at `/etc/nginx/sites-available/lsg-app`. This site listens on port 80 and contains:

```nginx
server {
    listen 80;
    server_name _;

    # Basic Auth gates all browser access (UI + /apps/*)
    auth_basic           "LSG Gateway";
    auth_basic_user_file /etc/nginx/lsg-app.htpasswd;

    # LSG-App React SPA (static files)
    root /path/to/lsg-app/client/build;
    location / { try_files $uri $uri/ /index.html; }

    # LSG-App Express API — Basic Auth OFF (JWT-gated instead)
    location /api/ {
        auth_basic off;
        proxy_pass http://127.0.0.1:3001;
    }

    # Protocol-app snippets included here
    include /etc/nginx/lsg-app-locations.d/*.conf;
}
```

The key line is `include /etc/nginx/lsg-app-locations.d/*.conf;`. This directory is the **protocol app snippet directory**.

### Protocol app snippets

When a protocol adapter is installed, its own `install.sh` writes a snippet file to `$NGINX_SNIPPET_DIR` (set in `/etc/environment` by the LSG-App installer, pointing to `/etc/nginx/lsg-app-locations.d/`). Each snippet adds two `location` blocks to the master server:

```nginx
# Configurator backend API
location /apps/api/lsg-<name>/ {
    proxy_pass http://127.0.0.1:<API_PORT>/api/;
    ...
}

# Configurator frontend (static build)
location ^~ /apps/lsg-<name>/ {
    alias /path/to/configurator/dist/;
    try_files $uri $uri/ @lsg-<name>_index;
    ...
}
```

After writing the snippet, the protocol installer runs `nginx -t && systemctl reload nginx` — the new UI is immediately accessible at `http://<device-ip>/apps/<APP_NAME>/` with no port to remember and no separate login (Basic Auth is inherited from the parent server block).

### Result

| Path | What it serves |
|------|----------------|
| `http://<ip>/` | LSG-App React SPA (dashboard, onboarding, data forwarding) |
| `http://<ip>/api/` | LSG-App Express API (JWT-gated, Basic Auth off) |
| `http://<ip>/apps/<APP_NAME>/` | Protocol adapter configurator UI |
| `http://<ip>/apps/api/<APP_NAME>/` | Protocol adapter configurator backend API |

All on port 80, all under Basic Auth, all through one Nginx process.

---

## Cloud Connection (ioadmin)

### Onboarding

Before the device can receive cloud commands:
1. User navigates to the Onboarding page in LSG-App UI
2. Enters the ioadmin URL and a one-time device token
3. LSG-App calls the ioadmin onboarding API, receives a permanent `lsg_token`
4. Token stored in `config/app-config.json`; Master MQTT client subscribes to `lsg/<token>/cmd/#`

### Command Topics

ioadmin sends commands over MQTT to the gateway:

| Topic pattern | Purpose |
|---------------|---------|
| `lsg/<token>/cmd/install` | Install a protocol adapter (sends signed S3 URL) |
| `lsg/<token>/cmd/uninstall` | Uninstall a protocol adapter |
| `lsg/<token>/cmd/vpn` | Toggle WireGuard VPN |
| `lsg/<token>/cmd/config-sync` | Push config file updates |
| `lsg/<token>/cmd/pipeline` | Create or delete a forwarding pipeline |

### Heartbeat

Every 60 seconds (and immediately on network changes), LSG-App publishes:
```json
{
  "hostname": "gateway-01",
  "ip": ["192.168.1.50", "10.8.0.1"],
  "mac": "aa:bb:cc:dd:ee:ff",
  "apps": ["lsg-modbus", "lsg-opcua"],
  "uptime": 86400
}
```
ioadmin uses heartbeats to track device online status and trigger alerts on missed beats.

---

## Key Data Structures

### `app_manifest.json` (written by install.sh)
```json
{
  "appName": "lsg-myproto-testing",
  "displayName": "lsg-myproto-testing",
  "version": "1.0.0",
  "port": 5003,
  "monitoring": { "enabled": true, "metricsPort": 5004, "metricsPath": "/metrics" },
  "uiEnabled": true,
  "uiPath": "/apps/lsg-myproto-testing/",
  "apiPath": "/apps/api/lsg-myproto-testing/",
  "healthCheckPath": "/health",
  "scripts": {
    "start":     { "path": "scripts/start.sh",     "requiresSudo": true },
    "stop":      { "path": "scripts/stop.sh",      "requiresSudo": true },
    "restart":   { "path": "scripts/restart.sh",   "requiresSudo": true },
    "status":    { "path": "scripts/status.sh",    "requiresSudo": true },
    "uninstall": { "path": "scripts/uninstall.sh", "requiresSudo": true }
  },
  "startupDelaySeconds": 5
}
```

### `config/app-registry.json` (in LSG-App)
```json
{
  "lsg-myproto-testing": {
    "appName": "lsg-myproto-testing",
    "displayName": "lsg-myproto-testing",
    "version": "1.0.0",
    "port": 5003,
    "installedAt": "2024-05-01T10:00:00Z"
  }
}
```

---

## Technology Stack

| Component | Technology | Key Libraries |
|-----------|-----------|---------------|
| LSG-App backend | Node.js + Express | mqtt, axios, bcryptjs, jsonwebtoken, csv-parse |
| LSG-App frontend | React 18 (CRA) | axios, React Router, Material-UI |
| Protocol adapter | Python 3.12 (or your language) | `<your-protocol-library>`, paho-mqtt, confluent-kafka, prometheus-client |
| Configurator frontend | React 18 + Vite + TypeScript | @tanstack/react-query, React Hook Form, Zod, Tailwind, Shadcn/UI |
| Configurator backend | Express + TypeScript | kafkajs, cors |
| Local data broker | Redpanda (Kafka-compatible) | systemd service, port 9092 |
| Data pipelines | Redpanda Connect | YAML-driven, one systemd unit per pipeline |
| Secret encryption | age | Device-specific key, systemd ExecStartPre decryption |
| Reverse proxy | Nginx | Basic auth, protocol app routing via snippets |

<!-- REPLACE: Update the "Protocol adapter" row in the Technology Stack table above with
     your actual language, runtime, and protocol library. -->

---

## Feature Implementation Summary

| Feature | Where implemented |
|---------|------------------|
| Protocol app installation | LSG-App: `src/routes/protocol.routes.js` + `scripts/install.sh` in each adapter |
| App lifecycle (start/stop/restart) | LSG-App shells out to adapter's `scripts/*.sh`; systemd manages actual process |
| App health monitoring | LSG-App polls `{manifest.port}{manifest.healthCheckPath}` via HTTP |
| Config file editing (JSON) | Configurator frontend: `JSONEditor.tsx` + `SchemaFormSections.tsx`; backend: `routes/files.ts` |
| Config file editing (CSV) | Configurator frontend: `CSVEditor.tsx` with localStorage staging |
| Real-time data monitoring | Configurator backend: `routes/monitor.ts` (Kafka consumer → SSE); frontend: `MonitorView.tsx` |
| Log streaming | Configurator backend: `routes/logs.ts` (tail → SSE); frontend logs tab |
| Data polling | `src/app.py` main loop; rate-grouped, metric-tracked |
| Protocol communication | `src/<protocol_client>.py` — wraps your industrial protocol library |
| Data forwarding | `src/posthandler.py` (Redpanda/MQTT/HTTP) → local Redpanda broker |
| Forwarding pipelines | LSG-App: `src/routes/redpanda.routes.js`; Redpanda Connect YAML + systemd |
| Cloud command reception | LSG-App: `src/services/masterMqttClient.js` (MQTT subscribe) |
| Device heartbeat | LSG-App: `src/services/heartbeatService.js` |
| Prometheus metrics | `src/metrics.py` — per-device poll counters and latency histograms |
| Schema-driven config UI | `configs/<profile>/schema.json` → `SchemaFormSections.tsx` renders fields dynamically |
