# API reference

Source-of-truth route table for the lsg-app HTTP API. All routes mount under the `/api`
prefix. Auth column legend:

- **none** — public, no middleware
- **setup token** — requires `X-Setup-Token` header (one-time install token)
- **JWT** — requires `Authorization: Bearer <token>` from `/api/auth/login`
- **guarded** — also blocked by [setupGuard](../src/middleware/setupGuard.js) until `SETUP_COMPLETE=true`

Mount table is in [src/routes/index.js](../src/routes/index.js). Almost every group is
both `setupGuard`'d and JWT-protected; `/setup` and `/health` are the exceptions.

> **Outermost gate — Nginx Basic Auth (frontend only).** Production installs put the
> **frontend** (`/`, static assets, and the included protocol-app UIs under
> `/apps/...`) behind HTTP Basic Auth at the Nginx layer. The credentials are
> collected by [scripts/install.sh](../scripts/install.sh) and stored at
> `/etc/nginx/lsg-app.htpasswd` (APR1-MD5, written `root:www-data 0640`).
>
> **`/api/*` is intentionally exempt** (`auth_basic off;` on the `/api/` location).
> Reason: server-level Basic Auth re-prompts the browser on every polling fetch
> (Topbar uptime, status pages, etc.) on at least some browsers. The API surface is
> still gated by [setupGuard](../src/middleware/setupGuard.js) and `jwtAuth`
> documented below. So the layered model is:
>
> - Human surface (HTML + UIs) → Basic Auth
> - Machine surface (`/api/*`) → JWT + setupGuard, no Basic Auth
>
> Direct HTTP callers (curl, ioadmin webhooks, monitoring probes) only need a JWT
> for `/api/*`, not the Basic Auth password. To call the frontend programmatically
> they would need the Basic Auth credentials — but there's rarely a reason to.
>
> The dev server (CRA `npm start` on `:3000` proxying to `:3001`) is **not** behind
> Nginx and therefore not Basic-Auth-gated at all.

---

## Health

| Method | Path           | Auth | Description           |
|--------|----------------|------|-----------------------|
| GET    | `/api/health`  | none | Liveness probe. Returns `{ status, timestamp }`. |

---

## Setup wizard — [setup.routes.js](../src/routes/setup.routes.js)

Always reachable. The `setupGuard` deliberately whitelists `/setup` and `/health`.

| Method | Path                       | Auth         | Description |
|--------|----------------------------|--------------|-------------|
| GET    | `/api/setup/status`        | none         | `{ configured: bool }` — frontend uses this to decide whether to redirect to `/setup`. |
| POST   | `/api/setup/verify-token`  | none         | Body `{ token }`. Validates the one-time token in `/etc/lsg-app/setup-token`. Returns `403 ALREADY_CONFIGURED` if `SETUP_COMPLETE=true`. |
| POST   | `/api/setup/complete`      | setup token  | Header `X-Setup-Token`. Body: `{ adminUsername, adminPassword, confirmPassword, githubToken, masterMqttHost, masterMqttPort, masterMqttUsername, masterMqttPassword, apiKeys }`. Bcrypt-hashes the password, re-encrypts secrets, and triggers `systemctl restart lsg-app`. Returns `403 ALREADY_CONFIGURED` if already set up. |

---

## Auth — [auth.routes.js](../src/routes/auth.routes.js)

| Method | Path             | Auth      | Description |
|--------|------------------|-----------|-------------|
| POST   | `/api/auth/login`  | guarded | Body `{ username, password }`. Returns `{ token }` (JWT). |
| POST   | `/api/auth/logout` | guarded | Stateless logout (token invalidated client-side). |

---

## Onboarding — [onboarding.routes.js](../src/routes/onboarding.routes.js)

Mounted under `/api/system`. **All routes require JWT.**

| Method | Path                            | Description |
|--------|---------------------------------|-------------|
| GET    | `/api/system/onboard/status`    | `{ onboarded: bool, onboarding?: { adminUrl, connectionMode, onboardedAt, status } }`. |
| POST   | `/api/system/onboard`           | Body `{ token, adminUrl? }`. Pairs the gateway with ioadmin via MQTT request/response. See [onboarding.md](onboarding.md). |
| POST   | `/api/system/onboard/reset`     | Uninstalls every app under [apps/](../apps/), stops the heartbeat, clears `onboarding` from `app-config.json`. |

---

## Protocol adapters — [protocol.routes.js](../src/routes/protocol.routes.js)

Mounted under `/api/polling`. All routes use `jwtAuth` and `systemCheckMiddleware`. See
[app-registry.md](app-registry.md) for the install pipeline.

| Method | Path                                                | Description |
|--------|-----------------------------------------------------|-------------|
| GET    | `/api/polling/protocols`                            | List all known protocols (from `config/protocols-config.json`) plus dynamically installed apps. Each entry includes `installed`, `running`, and the registry metadata. |
| POST   | `/api/polling/protocols/install`                    | Body `{ protocol }` (known protocol key) **or** `{ githubRepo, appName }` (custom). Optional `{ token, toolId, adminUrl }`. Async — returns `202` with `statusEndpoint`. |
| GET    | `/api/polling/protocols/:protocol/status`           | `{ status: 'installing' \| 'completed' \| 'failed', step, logs[], timestamp }`. |
| GET    | `/api/polling/protocols/:protocol/uninstall-status` | Same shape as install status, for the uninstall flow. |
| DELETE | `/api/polling/protocols/:protocol`                  | Async uninstall — runs the app's `scripts/uninstall.sh`, deregisters, and removes the directory. |
| POST   | `/api/polling/protocols/:protocol/start`            | `bash scripts/start.sh`. |
| POST   | `/api/polling/protocols/:protocol/stop`             | `bash scripts/stop.sh`. |
| POST   | `/api/polling/protocols/:protocol/restart`          | `bash scripts/restart.sh`. |
| GET    | `/api/polling/protocols/:protocol/logs`             | Tail of the app's logs (delegates to the manifest's `logs` script if present). |
| GET    | `/api/polling/protocols/:protocol/config`           | Returns the app's `config.csv` and `sys_parameters.json`. |
| POST   | `/api/polling/protocols/:protocol/config/csv`       | Body: parsed CSV rows. Writes `config.csv`. |
| POST   | `/api/polling/protocols/:protocol/config/parameters`| Writes `sys_parameters.json`. |

---

## Data forwarding (Redpanda) — [redpanda.routes.js](../src/routes/redpanda.routes.js)

Mounted under `/api/redpanda`. All routes JWT-protected. See [data-forwarding.md](data-forwarding.md).

### Broker

| Method | Path                            | Description |
|--------|---------------------------------|-------------|
| GET    | `/api/redpanda/status`          | Whether `redpanda` and any `redpanda-connect@*` units are active. |
| GET    | `/api/redpanda/broker/config`   | Returns the parsed `/etc/redpanda/redpanda.yaml`. |
| POST   | `/api/redpanda/broker/config`   | Replaces broker config (validates YAML before writing). |
| POST   | `/api/redpanda/broker/restart`  | `systemctl restart redpanda`. |
| GET    | `/api/redpanda/broker/topics`   | Lists Kafka topics on the local broker. |
| GET    | `/api/redpanda/topics`          | Same as `broker/topics` (UI alias). |
| GET    | `/api/redpanda/consumers`       | Lists consumer groups. |

### Pipelines (each pipeline = one `redpanda-connect@<name>.service`)

| Method | Path                                           | Description |
|--------|------------------------------------------------|-------------|
| GET    | `/api/redpanda/pipelines`                      | List all `redpanda-connect@*` units with status (`active`/`failed`/`inactive`) and detected output type (`mqtt`/`http`/`kafka`). |
| GET    | `/api/redpanda/pipeline/:name`                 | Returns the pipeline's YAML config from `/etc/redpanda-connect/pipelines/<name>.yml`. |
| POST   | `/api/redpanda/pipeline/validate`              | Body: pipeline YAML. Runs `redpanda connect lint`. |
| POST   | `/api/redpanda/pipeline`                       | Creates a new pipeline. Body: `{ name, yaml, secrets? }`. Stages YAML, persists secrets via `update-forwarder-secrets.sh`, enables and starts the service. |
| PUT    | `/api/redpanda/pipeline/:name`                 | Replaces an existing pipeline's YAML and restarts the service. |
| DELETE | `/api/redpanda/pipeline/:name`                 | Stops, disables, and removes the pipeline. |
| POST   | `/api/redpanda/pipeline/:name/action`          | Body `{ action: 'start' \| 'stop' \| 'restart' }`. |
| GET    | `/api/redpanda/logs`                           | `journalctl` tail across all redpanda-connect services. |

---

## Network — [network.js](../src/routes/network.js)

Mounted under `/api/network`. All JWT-protected.

| Method | Path                                              | Description |
|--------|---------------------------------------------------|-------------|
| GET    | `/api/network/interfaces`                         | All network interfaces with addresses and link state. |
| GET    | `/api/network/interfaces/:name/check`             | Diagnostic check on a single interface. |
| PUT    | `/api/network/interfaces/:name`                   | Body: interface config (DHCP/static, IP, gateway, DNS). Writes via `nmcli` or netplan. |
| GET    | `/api/network/connectivity`                       | Pings 8.8.8.8 and resolves a hostname to test connectivity. |
| GET    | `/api/network/firewall/status`                    | UFW status. |
| GET    | `/api/network/firewall/rules`                     | UFW rule list. |
| POST   | `/api/network/firewall/enable`                    | `ufw enable`. |
| POST   | `/api/network/firewall/disable`                   | `ufw disable`. |
| POST   | `/api/network/firewall/rules`                     | Add a UFW rule. |
| DELETE | `/api/network/firewall/rules/:ruleNum`            | Remove a UFW rule by line number. |

---

## System — overview & restart scheduling

### [system.routes.js](../src/routes/system.routes.js) — `/api/system`

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| GET    | `/api/system/overview`| CPU/RAM/disk/network snapshot for the dashboard. |
| GET    | `/api/system/uptime`  | Process uptime + system uptime. |

### [systemRoutes.js](../src/routes/systemRoutes.js) — `/api/remote-management`

Mounted under `/api/remote-management` (older naming — kept for the UI).

| Method | Path                                          | Description |
|--------|-----------------------------------------------|-------------|
| GET    | `/api/remote-management/time`                 | Current time + timezone. |
| PUT    | `/api/remote-management/time`                 | Set timezone / NTP. |
| GET    | `/api/remote-management/time/zones`           | List of available timezones. |
| GET    | `/api/remote-management/restart`              | List scheduled restarts. |
| POST   | `/api/remote-management/restart`              | Schedule a restart (`{ when, type }`). |
| DELETE | `/api/remote-management/restart/:id`          | Cancel a scheduled restart. |
| GET    | `/api/remote-management/schedule/actions`     | List of available scheduled-action types. |

VPN: mounted as a sub-router at `/api/remote-management/vpn`
([vpnRoutes.js](../src/routes/vpnRoutes.js)) — `GET /status`, `POST /profile`, `POST /upload`, `POST /toggle`, `POST /routing`.

### [remote.routes.js](../src/routes/remote.routes.js) — `/api/system/remote`

| Method | Path                              | Description |
|--------|-----------------------------------|-------------|
| POST   | `/api/system/remote/uninstall`    | Trigger remote uninstall of an app on this gateway. |
| POST   | `/api/system/remote/rollback`     | Roll back to a previous app version. |

---

## App registry — [registry.routes.js](../src/routes/registry.routes.js)

Mounted under `/api/registry`. All JWT-protected.

| Method | Path                              | Description |
|--------|-----------------------------------|-------------|
| GET    | `/api/registry`                   | All entries from `config/app-registry.json`. |
| GET    | `/api/registry/:appName`          | Single entry. |
| GET    | `/api/registry/:appName/health`   | Probes the app's `healthCheckPath` (default `/health`) on its registered port. |

---

## Services — SSH / FTP — [services.routes.js](../src/routes/services.routes.js)

Mounted under `/api/services`. All JWT-protected.

| Method | Path                       | Description |
|--------|----------------------------|-------------|
| GET    | `/api/services/ssh/status` | `systemctl is-active ssh` + sshd_config summary. |
| POST   | `/api/services/ssh/toggle` | Body `{ enabled }`. Enables/disables and starts/stops `ssh.service`. |
| POST   | `/api/services/ssh/config` | Body: SSH config (port, password auth, key auth, allowed users). Writes `sshd_config` and reloads. |
| GET    | `/api/services/ftp/status` | Same shape, for `vsftpd`. |
| POST   | `/api/services/ftp/toggle` | Enable/disable FTP. |
| POST   | `/api/services/ftp/config` | FTP config. |

---

## Standard error shape

Most handlers return:

```json
{ "success": false, "message": "human-readable" }
```

Validation / authorization failures additionally include a `code`:

| Code                  | HTTP | Meaning |
|-----------------------|------|---------|
| `SETUP_REQUIRED`      | 503  | Setup not complete; from [setupGuard](../src/middleware/setupGuard.js). |
| `ALREADY_CONFIGURED`  | 403  | Setup endpoints rejected because the device is already configured. |
| `INVALID_TOKEN`       | 401  | Setup token mismatch. |
| `PASSWORD_MISMATCH`   | 400  | `adminPassword !== confirmPassword`. |
| `PASSWORD_TOO_SHORT`  | 400  | Password under 8 chars. |
