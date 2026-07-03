# Environment Configuration

This document describes how environment variables are managed in the LSG IoT Data Handling System.

## Architecture: Two-File System

Configuration is split into two separate files to keep secrets isolated:

| File | Location | Contents | Encrypted? |
|---|---|---|---|
| `config.env` | `/etc/lsg-app/config.env` | Safe non-secret config (ports, timeouts, feature flags) | No — plaintext, readable |
| `secrets.env.age` | `/etc/lsg-app/secrets.env.age` | All credentials and secrets | **Yes — age-encrypted** |

At every boot, systemd runs `age -d` to decrypt `secrets.env.age` into `/run/lsg-app/secrets.env` before the Node.js process starts. `/run` is a RAM-backed tmpfs — the plaintext never touches disk. When the service stops, the decrypted file is shredded.

```
Boot:
  /etc/lsg-app/secrets.env.age  ──[age decrypt]──▶  /run/lsg-app/secrets.env (RAM only)
         │                                                    │
         │ encrypted at rest                                  │ loaded by systemd EnvironmentFile
         ▼                                                    ▼
  safe to store anywhere                            process.env.JWT_SECRET etc.

Shutdown:
  /run/lsg-app/secrets.env  ──[shred -u]──▶  (gone)
```

## Setup Instructions

### 1. Build the frontend (required before install)
```bash
cd client && npm install && npm run build
```

### 2. Run the installer
```bash
sudo bash scripts/install.sh
```

The installer:
- Creates `/etc/lsg-app/config.env` — safe settings
- Generates a device-specific `age` encryption key pair at `/etc/lsg-app/age-identity`
- Generates `JWT_SECRET` and `INTERNAL_API_KEY` cryptographically and encrypts them
- **Prompts for an Nginx Basic Auth username + password** and writes the htpasswd
  file at `/etc/nginx/lsg-app.htpasswd` (`root:www-data 0640`, APR1-MD5 hash via
  `openssl passwd -apr1`). This gates the **human surface** — frontend, static
  assets, and protocol-app UIs under `/apps/...` — independently of the
  application's admin login. The `/api/` location is exempted (`auth_basic off;`)
  because server-level Basic Auth re-prompts the browser on every polling fetch;
  the API stays protected by JWT + setupGuard. Always prompted, even with
  `--defer-setup`.
- Creates the systemd service with `ExecStartPre` age decryption
- Starts the service in **first-run setup mode**

### 3. Complete first-run setup in the browser

Open `http://<device-ip>` — the browser will first prompt for the Nginx Basic Auth
credentials chosen during install, then the app will redirect to the setup wizard.

The setup wizard collects:
- Admin username & password
- IoAdmin MQTT credentials
- Protocol MQTT credentials (optional)
- GitHub personal access token
- IoT API keys (optional)

After submitting, the service re-encrypts `secrets.env.age` with the full set of secrets and restarts automatically. You are then redirected to the login page.

---

## Variable Reference

### Safe Variables (`/etc/lsg-app/config.env`)

#### Server
- `PORT` — Server port number (default: 3001)
- `NODE_ENV` — Environment mode (production/development)
- `API_PREFIX` — Prefix for all API endpoints
- `CORS_ORIGIN` — CORS allowed origins (`*` for all)

#### IoT
- `MAX_PAYLOAD_SIZE` — Maximum IoT data payload size
- `IOT_RATE_LIMIT_PER_DEVICE` — Max requests per minute per device
- `IOT_DATA_RETENTION_DAYS` — Days to keep data before cleanup
- `IOT_FORWARDING_METHOD` — `mqtt`, `http`, or `both`

#### MQTT Forwarding (non-secret)
- `MQTT_ENABLED` — Enable/disable MQTT forwarding
- `MQTT_BROKER` — MQTT broker URL
- `MQTT_TOPIC` — Topic to publish
- `MQTT_QOS` — Quality of Service level (0, 1, 2)
- `MQTT_CLIENT_ID` — Unique client identifier

#### HTTP Forwarding
- `HTTP_ENABLED` — Enable/disable HTTP forwarding
- `HTTP_ENDPOINT` — Target HTTP endpoint
- `HTTP_METHOD` — HTTP method (POST/PUT)
- `HTTP_TIMEOUT` — Request timeout in milliseconds
- `HTTP_MAX_RETRIES` / `HTTP_RETRY_DELAY`

#### Master MQTT (IoAdmin platform — non-secret)
- `MASTER_MQTT_HOST` — Broker hostname
- `MASTER_MQTT_PORT` — Broker port

#### Storage & Timers
- `DATA_DIR` — Directory for storing data files
- `MAX_STORAGE_DAYS` — Days until data cleanup
- `CLEANUP_INTERVAL` — Cleanup interval in milliseconds
- `HEARTBEAT_INTERVAL` — IoAdmin heartbeat interval in ms

#### Security (non-secret)
- `JWT_EXPIRY` — JWT token expiry (e.g. `24h`)
- `RATE_LIMIT_WINDOW` / `RATE_LIMIT_MAX`

#### Feature Flags
- `ENABLE_DATA_VALIDATION` / `ENABLE_AUTO_RECONNECT` / `ENABLE_COMPRESSION`

---

### Secrets (`/etc/lsg-app/secrets.env.age` — encrypted)

These are **never stored in plaintext** on disk. They are set either automatically by `install.sh` or by the first-run UI wizard.

| Variable | Set by | Description |
|---|---|---|
| `JWT_SECRET` | install.sh (auto) | Signs admin session tokens |
| `INTERNAL_API_KEY` | install.sh (auto) | IoAdmin server-to-server auth |
| `SETUP_COMPLETE` | install.sh / setup wizard | `false` until wizard completes |
| `ADMIN_USERNAME` | Setup wizard | Admin login username |
| `ADMIN_PASSWORD_HASH` | Setup wizard | bcrypt hash of admin password |
| `MASTER_MQTT_USERNAME` | Setup wizard | IoAdmin MQTT broker username |
| `MASTER_MQTT_PASSWORD` | Setup wizard | IoAdmin MQTT broker password |
| `MQTT_USERNAME` | Setup wizard (optional) | Protocol MQTT broker username |
| `MQTT_PASSWORD` | Setup wizard (optional) | Protocol MQTT broker password |
| `GITHUB_TOKEN` | Setup wizard | PAT for protocol app downloads |
| `API_KEYS` | Setup wizard (optional) | Comma-separated IoT device API keys |

---

## Development Setup

For local development, create a `.env` file from the template:
```bash
cp config/env.example .env
```

Then manually add the secret variables to `.env` and set `SETUP_COMPLETE=true` to skip the first-run wizard:

```bash
# Add to .env for development:
JWT_SECRET=dev-only-not-for-production-abc123
INTERNAL_API_KEY=dev-internal-key
SETUP_COMPLETE=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<bcrypt hash of your dev password>
GITHUB_TOKEN=ghp_your_token_here
MASTER_MQTT_USERNAME=dev
MASTER_MQTT_PASSWORD=dev
```

Generate a bcrypt hash for development:
```bash
node -e "const b=require('bcryptjs');b.hash('yourpassword',12).then(console.log)"
```

> **Never commit `.env` to version control.** It is in `.gitignore`.

---

## Security Notes

1. `secrets.env.age` is encrypted with a device-specific age key — it cannot be decrypted on any other device
2. The plaintext secrets only exist in `/run/lsg-app/secrets.env` (RAM) while the service is running
3. `JWT_SECRET` and `INTERNAL_API_KEY` are never known by any human — they are machine-generated
4. The age private key at `/etc/lsg-app/age-identity` is owned by the service user with `chmod 440`
5. Rotate secrets by re-running `install.sh` (invalidates all sessions) or via a future UI rotation feature
6. Nginx Basic Auth at `/etc/nginx/lsg-app.htpasswd` is the outermost gate. It is intentionally **not** part of the age bundle — Nginx must be able to read it before the Node process (and its decrypted secrets) exists. Rotate it by re-running `install.sh`, or directly: `htpasswd /etc/nginx/lsg-app.htpasswd <user>` followed by `systemctl reload nginx`. Without `apache2-utils`, use `openssl passwd -apr1` and edit the file by hand.