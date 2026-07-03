# LSG architecture

A reference for engineers working on the gateway. Pairs with [README.md](../README.md)
(getting started) and [config/README.md](../config/README.md) (secrets / env).

Companion docs:

- [api.md](api.md) — full HTTP route reference
- [onboarding.md](onboarding.md) — pairing with ioadmin
- [data-forwarding.md](data-forwarding.md) — Redpanda pipelines
- [app-registry.md](app-registry.md) — protocol adapter plugin contract

## What LSG is

LSG ("Linux System Gateway") is a Node.js + React application that runs on a Linux
device and acts as the bridge between **local industrial hardware** and a central
**ioadmin** platform. Each gateway:

- Hosts a set of installable **protocol adapter apps** ([apps/](../apps/)) that talk to
  on-prem hardware (OPC UA servers, modbus devices via Node-RED, etc.).
- **Forwards** the data those adapters collect downstream — via MQTT, HTTP, or local
  Redpanda/Kafka pipelines, configured by the user from the UI.
- Maintains a **persistent control-plane MQTT link** back to ioadmin so the platform can
  send commands (VPN toggle, restart, …), receive heartbeats, and complete onboarding.
- Exposes a **local web UI** (React SPA) for on-device configuration: network, firewall,
  protocol installs, data-forwarding setup, services (SSH/FTP/VPN), etc.

## Process model

A single Node.js process ([src/index.js](../src/index.js)) hosts:

- The Express HTTP server on port `3001` (API + static SPA in production).
- The **master MQTT client** ([src/services/masterMqttClient.js](../src/services/masterMqttClient.js)) — always-on link to ioadmin.
- The **heartbeat service** ([src/services/heartbeatService.js](../src/services/heartbeatService.js)).
- The **config manager** ([src/services/configManager.js](../src/services/configManager.js)) — `EventEmitter` so live config edits notify subscribers without a restart.
- The **app registry** ([src/services/appRegistry.js](../src/services/appRegistry.js)) — index of installed protocol adapters.

Protocol adapter apps run **as separate processes** managed by their own systemd units
and Nginx server blocks. lsg-app does not embed them — it shells out to their
`scripts/start.sh`, `stop.sh`, `status.sh`, etc.

## Startup sequence

[src/index.js:24](../src/index.js#L24) — `startServer()`:

1. `configManager.init()` — load/merge `config/app-config.json`, hydrate with defaults from [src/config/index.js](../src/config/index.js)
2. `appRegistry.init()` — load `config/app-registry.json` (or create empty)
3. Mount `app.use('/api', routes)` — see [src/routes/index.js](../src/routes/index.js)
4. Mount static handler for `client/build/` and SPA catch-all
5. `initMasterMqttClient()` — connect to ioadmin MQTT, subscribe to `lsg/<token>/cmd/#` once onboarded
6. `heartbeatService.start()` — only fires if `onboarding.status === 'onboarded'`
7. `app.listen(3001)`

Failures in steps 5 and 6 are logged but **non-fatal** — the HTTP server still comes up
so the user can recover via the UI.

## Two-layer config

LSG separates **process boot config** (env vars) from **runtime app config** (a JSON file
that the UI can edit live).

### Layer 1 — env vars ([src/config/index.js](../src/config/index.js))

Reads `process.env`, applies defaults, exports a single canonical `config` object.
After setup completes (`SETUP_COMPLETE=true`), it **fails fast** if any of `JWT_SECRET`,
`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, or `GITHUB_TOKEN` are missing
([src/config/index.js:114](../src/config/index.js#L114)). During setup mode these can
legitimately be absent — `setupGuard` blocks all auth-requiring routes anyway.

In production, env vars come from systemd `EnvironmentFile=` directives:

- `/etc/lsg-app/config.env` — plaintext, non-secret
- `/run/lsg-app/secrets.env` — RAM-only tmpfs, decrypted at boot from `/etc/lsg-app/secrets.env.age`

In development, both are replaced by a single `.env` (gitignored). See
[config/README.md](../config/README.md) for the full variable list.

### Layer 2 — runtime config ([src/services/configManager.js](../src/services/configManager.js))

Persists user-editable settings to `config/app-config.json`:

- `iot.forwarding.{method, mqtt, http}` — data forwarder config
- `iot.forwarding.{retry, batch}` — delivery semantics
- `iot.security.apiKeys` — IoT device API keys
- `vpn` — VPN profile / state
- `onboarding` — `{ token, adminUrl, status }` once paired with ioadmin

`ConfigManager extends EventEmitter`. Update methods (`updateMQTTConfig`,
`updateHTTPConfig`, `updateForwardingMethod`, `updateHTTPHeaders`, …) emit events that
the data forwarder listens for, so changes apply without a restart. Every change is
also appended to `config/config-history.json` for audit.

## Setup and the setup guard

A fresh install starts with `SETUP_COMPLETE=false`. While that is the case,
[src/middleware/setupGuard.js](../src/middleware/setupGuard.js) returns
`503 SETUP_REQUIRED` for every API route **except** `/api/setup/*` and `/api/health`.
The guard is mounted in [src/routes/index.js:37](../src/routes/index.js#L37), after the
`/setup` mount, so the wizard endpoints stay reachable.

Wizard flow:

1. `install.sh` writes a one-time token to `/etc/lsg-app/setup-token` and `SETUP_COMPLETE=false` to the encrypted secrets bundle.
2. Browser hits `/` → React calls `GET /api/setup/status` → if not configured, redirects to `/setup`.
3. Wizard POSTs credentials to `/api/setup/complete` with the token in the `X-Setup-Token` header.
4. [src/services/setupService.js](../src/services/setupService.js):
   - bcrypts the admin password
   - writes all secrets (existing machine-generated + newly collected) to a temp file
   - re-encrypts to `/etc/lsg-app/secrets.env.age` via `age`
   - shreds the temp file and the `setup-token`
   - schedules a delayed `systemctl restart lsg-app` (response is sent first)

Re-running the wizard later (secret rotation) is intentionally a one-line change in
`setup.routes.js` — bypass the `isConfigured()` guard with `jwtAuth`. See the doc
comment at the top of [setupService.js](../src/services/setupService.js) for details.

## Auth layers (outside-in)

In production the gateway is gated by **three** layers, each independent:

1. **Nginx Basic Auth — human surface only.** `auth_basic` is set at the `server` block
   level in the Nginx site config so it covers `/`, static assets, and the included
   `${NGINX_SNIPPET_DIR}/*.conf` protocol-app UIs (`/apps/lsg-opcua/`, `/apps/lsg-nodered/`,
   …). The `/api/` location explicitly opts out with `auth_basic off;` because keeping
   it on caused the browser to re-prompt on every polling fetch from the SPA. Credentials
   are collected by [scripts/install.sh](../scripts/install.sh) and stored at
   `/etc/nginx/lsg-app.htpasswd` (APR1-MD5 via `openssl passwd -apr1`, `root:www-data 0640`).
2. **setupGuard** — returns `503 SETUP_REQUIRED` for every API path except
   `/api/setup/*` and `/api/health` until `SETUP_COMPLETE=true`. Applies regardless of
   whether the request reached Nginx with or without Basic Auth, since `/api/` is
   exempt at layer 1.
3. **jwtAuth** — application-level admin login; required by every route except
   `/api/setup/*`, `/api/health`, and `/api/auth/login`.

The split is deliberate:

- **Human surface** (HTML, UIs) → Basic Auth gate. One prompt per browser session.
- **Machine surface** (`/api/*`) → JWT + setupGuard. Direct HTTP callers (ioadmin
  webhooks, curl probes, external integrations) only need a JWT.

Layer 1 is configured at install time and rotated by re-running `install.sh` (or
manually re-writing the htpasswd file and `systemctl reload nginx`). Layers 2–3 are
configured by the first-run wizard and rotated by re-running setup.

## Two MQTT clients

This is the architectural distinction most likely to confuse newcomers.

|                  | **Master MQTT** ([masterMqttClient.js](../src/services/masterMqttClient.js)) | **Data forwarder** |
|------------------|------|--------------------|
| Purpose          | Control plane to ioadmin | Data plane to user-chosen destination |
| Connects to      | `MASTER_MQTT_HOST` (default `hap.faclon.com`) | User-supplied broker |
| Credentials      | `MASTER_MQTT_USERNAME` / `MASTER_MQTT_PASSWORD` from secrets | `iot.forwarding.mqtt.username/password` from `app-config.json` |
| Editable from UI | **No** — set at install time only | Yes — Data Forwarding page |
| Topics           | `lsg/<token>/cmd/#` (sub), `lsg/<token>/res/<action>` (pub), `lsg/<token>/heartbeat` (pub) | User-defined topic with payload template |
| Lifecycle        | `initMasterMqttClient()` at boot, always on | Active only when `iot.forwarding.method` includes `mqtt` and `enabled=true` |
| QoS              | 1 for cmds, 0 for heartbeat | Configurable (`iot.forwarding.mqtt.qos`) |

### Master MQTT command channel

Subscribes to `lsg/<token>/cmd/#` once onboarding info is present. Topic suffix
becomes the action. Currently dispatched ([masterMqttClient.js:123](../src/services/masterMqttClient.js#L123)):

| Action     | Payload                                  | Behavior |
|------------|------------------------------------------|----------|
| `vpn`      | `{ enable: bool }`                       | Toggles `vpnService.enable()` / `disable()` |
| `restart`  | `{ type, force, delay }`                 | Acks first, waits 1s, then `systemService.restartSystem(...)` |

Each command carries a `correlationId`; the response is published back to
`lsg/<token>/res/<action>`.

`publishAndWait(topic, data, responseTopic, timeoutMs)` is the one-shot request/response
helper used during onboarding to register with ioadmin.

### Heartbeat

`heartbeatService` ([heartbeatService.js](../src/services/heartbeatService.js)) runs every
`HEARTBEAT_INTERVAL` ms (default 60 000), but **only after onboarding**. It collects:

```js
{
  resourceOverview: { cpu, ram, disk, cpuUsage, ramUsage, diskUsage },
  uptime,
  vpnIp,
  vpnStatus
}
```

…and publishes to `lsg/<token>/heartbeat` over master MQTT. If MQTT is disconnected, it
falls back to `POST <adminUrl>/api/lsg/public/heartbeat` over HTTPS.

## App registry — the protocol adapter plugin model

Protocol adapters are **fully self-contained** sub-projects under [apps/](../apps/) (e.g.
[apps/ioconnect-opcua/](../apps/ioconnect-opcua/)). Each adapter ships with:

- `app_manifest.json` — `{ appName, displayName, version, port, uiPath, apiPath, scripts: { start, stop, restart, status, uninstall }, … }`
- `scripts/install.sh` / `scripts/uninstall.sh` — own systemd unit, **own Nginx server-block snippet**
- Its own runtime (Node, Python, Docker, …) on its own port

Lifecycle:

1. User triggers install via `POST /api/polling/protocols/install`. lsg-app downloads /
   unpacks the app, runs its `install.sh`, then reads the resulting `app_manifest.json`.
2. lsg-app **only** persists the manifest metadata to `config/app-registry.json` via
   [appRegistry.register()](../src/services/appRegistry.js). Nginx config is written by
   the app's own `install.sh`, not by lsg-app.
3. Operations (`start`, `stop`, `restart`, `status`, `logs`) become route handlers in
   [protocol.routes.js](../src/routes/protocol.routes.js) /
   [protocol.controller.js](../src/controllers/protocol.controller.js) that shell out to
   the manifest's script paths.
4. Uninstall calls the app's `uninstall.sh` (which also tears down its Nginx snippet),
   then `appRegistry.deregister(appName)`.

> **Why this split?** Each adapter is shipped as a separate repo with its own release
> cadence and runtime requirements. Forcing lsg-app to know about each adapter's web
> server, env vars, or update strategy would couple it tightly to every protocol team.
> The manifest is the only contract.

The Nginx snippet directory and apps install root are exported globally as
`NGINX_SNIPPET_DIR` and `LSG_APPS_HOME` (written to `/etc/environment` by `install.sh`)
so each adapter can find them without hard-coding.

## Secrets at rest

See [config/README.md](../config/README.md) for the full reference. In short:

```
Boot (systemd ExecStartPre):
  /etc/lsg-app/secrets.env.age
       │  age -d  (key at /etc/lsg-app/age-identity, chmod 440)
       ▼
  /run/lsg-app/secrets.env   ← tmpfs, RAM only

Process loads:
  EnvironmentFile=/etc/lsg-app/config.env
  EnvironmentFile=/run/lsg-app/secrets.env

Shutdown (ExecStopPost):
  shred -u /run/lsg-app/secrets.env
```

Three properties to keep in mind:

1. The age private key is **device-specific** — `secrets.env.age` cannot be decrypted on
   another device.
2. `JWT_SECRET` and `INTERNAL_API_KEY` are machine-generated; no human ever knows them.
3. Re-running `install.sh` rotates everything and invalidates all sessions.

The Nginx Basic Auth credentials (see *Auth layers* above) are stored separately at
`/etc/nginx/lsg-app.htpasswd` as APR1-MD5 hashes — they are **not** part of the age
bundle, since Nginx must read them before the Node process (and its decrypted secrets)
exists. Rotate by re-running `install.sh`, or by editing the file directly:
`htpasswd /etc/nginx/lsg-app.htpasswd <user>` (or `openssl passwd -apr1` + a manual
write) followed by `systemctl reload nginx`.

## API surface

All routes mount under `/api`. Mounted in [src/routes/index.js](../src/routes/index.js):

| Prefix                  | File                                                       | Auth         | Purpose |
|-------------------------|------------------------------------------------------------|--------------|---------|
| `/health`               | inline in `index.js`                                       | none         | Liveness probe |
| `/setup`                | [setup.routes.js](../src/routes/setup.routes.js)           | `X-Setup-Token` (when present) | First-run wizard endpoints (`status`, `verify-token`, `complete`) |
| `/auth`                 | [auth.routes.js](../src/routes/auth.routes.js)             | none / JWT   | `login`, `logout` |
| `/redpanda`             | [redpanda.routes.js](../src/routes/redpanda.routes.js)     | `jwtAuth`    | Local Redpanda/Kafka broker — topics, consumers, pipelines, logs |
| `/network`              | [network.js](../src/routes/network.js)                     | `jwtAuth`    | Interfaces, connectivity, UFW firewall |
| `/remote-management`    | [systemRoutes.js](../src/routes/systemRoutes.js)           | mixed        | Time, restart scheduling, scheduled actions |
| `/polling`              | [protocol.routes.js](../src/routes/protocol.routes.js)     | `jwtAuth`    | Protocol adapter install/uninstall/start/stop/logs/config |
| `/system`               | [system.routes.js](../src/routes/system.routes.js)         | `jwtAuth`    | `/overview`, `/uptime` |
| `/system` (onboarding)  | [onboarding.routes.js](../src/routes/onboarding.routes.js) | mixed        | `/onboard`, `/onboard/status`, `/onboard/reset` |
| `/system/remote`        | [remote.routes.js](../src/routes/remote.routes.js)         | `jwtAuth`    | Remote uninstall, rollback |
| `/registry`             | [registry.routes.js](../src/routes/registry.routes.js)     | `jwtAuth`    | Read installed-app metadata + per-app health probe |
| `/services`             | [services.routes.js](../src/routes/services.routes.js)     | `jwtAuth`    | SSH / FTP toggle + config |

Everything except `/setup` and `/health` runs through
[setupGuard](../src/middleware/setupGuard.js) first. Authenticated routes additionally
run [jwtAuth](../src/middleware/jwtAuth.js).

## Frontend

React SPA (CRA + MUI v5) under [client/](../client/). Major top-level routes (in
[client/src/](../client/src/)):

- `/setup` — first-run wizard
- `/login` — admin login
- `/onboarding` — pairing with ioadmin
- protected, inside `ModernLayout`:
  - `/overview` — dashboard
  - `/network` — interfaces, firewall, connectivity
  - `/data-polling` — protocol adapter management
  - `/data-forwarding` — pipelines, MQTT/HTTP forwarder config
  - `/services` — SSH, FTP, VPN, scheduled tasks
  - `/remote-management` — time config, restart scheduling

Auth state lives in `context/AuthContext.jsx`; the API client
([client/src/config/api.js](../client/src/config/api.js)) attaches the JWT to every
request.

In production Express serves `client/build/` directly with a catch-all that returns
`index.html` for unknown paths so client-side routing works. In development CRA's dev
server proxies `/api` to `localhost:3001`.

## Where to look first when debugging

| Symptom                                            | Look at                                                                     |
|----------------------------------------------------|-----------------------------------------------------------------------------|
| Service won't start, "missing required secrets"    | [src/config/index.js:114](../src/config/index.js#L114), `secrets.env.age` decryption |
| All API calls return `503 SETUP_REQUIRED`          | `SETUP_COMPLETE` env var, [setupGuard.js](../src/middleware/setupGuard.js)  |
| ioadmin shows device offline                       | [masterMqttClient.js](../src/services/masterMqttClient.js) connect logs, `MASTER_MQTT_*` env |
| Heartbeat not arriving                             | [heartbeatService.js](../src/services/heartbeatService.js); requires `onboarding.status === 'onboarded'` |
| Data forwarder ignored a UI change                 | `ConfigManager` event subscriber in `dataForwarder` — verify event name matches |
| Protocol adapter install succeeded but no Nginx    | The adapter's own `install.sh` — lsg-app does **not** write Nginx config    |
| `app-registry.json` out of sync after manual edits | [appRegistry.js](../src/services/appRegistry.js) loads on boot only         |
