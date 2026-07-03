# Plan: IoAdmin MQTT Setup, Remove Data-Forwarder MQTT from Setup, LSG_APP_DATA

## Context

Three related changes to the install and first-run setup flow:

1. **MASTER_MQTT host/port are hardcoded**: `MASTER_MQTT_HOST=localhost` and `MASTER_MQTT_PORT=1883` are hardcoded in `config.env` by install.sh (lines 270–271). They should be prompted instead. Default host should be `hap.faclon.com`. Because they are not sensitive they go in config.env (not encrypted secrets).

2. **Data-forwarder MQTT should be removed from setup**: The "Protocol MQTT" section in install.sh (lines 488–496) and Setup.jsx Step 2 collects `MQTT_USERNAME`/`MQTT_PASSWORD`. Users configure per-pipeline MQTT credentials via the Data Forwarding UI; this setup step is redundant and confusing.

3. **LSG_APP_DATA missing from /etc/environment**: Protocol apps need a known directory for storing config. `/etc/environment` already exports `LSG_APPS_HOME`, etc. — `LSG_APP_DATA` should be added the same way, with a user-prompted path (suggested default: `/var/lib/lsg-app-data`).

**Key design point — EnvironmentFile loading order** (systemd unit lines 712–716):
```
EnvironmentFile=-/run/lsg-app/secrets.env   ← loaded 1st
EnvironmentFile=/etc/lsg-app/config.env     ← loaded 2nd (overrides secrets!)
EnvironmentFile=-/etc/environment           ← loaded 3rd
```
Since `config.env` loads AFTER `secrets.env`, config.env wins for any key defined in both. Because MASTER_MQTT_HOST/PORT are non-sensitive they live in config.env only. For the defer-setup path (Setup.jsx → setupService.js), `setupService.js` needs to update config.env directly. To allow this, install.sh must give the app user write access to config.env.

---

## Feature 1 — IoAdmin MQTT host + port in config.env

### `scripts/install.sh`

**Config.env permission change** (after the `cat > "$CONFIG_ENV"` heredoc block):
```bash
chown root:${APP_USER} "$CONFIG_ENV"
chmod 664 "$CONFIG_ENV"   # app user can write (for defer-setup web wizard)
```

**In the config.env heredoc** — replace the hardcoded lines with the prompted values:
```bash
# REMOVE (lines 270–271):
MASTER_MQTT_HOST=localhost
MASTER_MQTT_PORT=1883

# REPLACE with (after prompts — see below):
MASTER_MQTT_HOST=${MASTER_MQTT_HOST}
MASTER_MQTT_PORT=${MASTER_MQTT_PORT}
```

**Interactive mode** — add prompts just above the existing "IoAdmin MQTT username" block (after line 476):
```bash
# ── IoAdmin (Master) MQTT ──────────────────────────────────────────────
echo ""
while true; do
  printf "  IoAdmin MQTT host [hap.faclon.com]: "
  read -r MASTER_MQTT_HOST
  MASTER_MQTT_HOST="${MASTER_MQTT_HOST:-hap.faclon.com}"
  [[ -n "$MASTER_MQTT_HOST" ]] && break
done
while true; do
  printf "  IoAdmin MQTT port [1883]: "
  read -r MASTER_MQTT_PORT
  MASTER_MQTT_PORT="${MASTER_MQTT_PORT:-1883}"
  [[ "$MASTER_MQTT_PORT" =~ ^[0-9]+$ ]] && break
  echo "  Port must be a number."
done
```

**Defer-setup mode** — set defaults before the `cat > "$CONFIG_ENV"` block so the heredoc expansion works:
```bash
if [[ "$DEFER_SETUP" != "true" ]]; then
  # (prompts for host/port go here in interactive mode)
else
  MASTER_MQTT_HOST="hap.faclon.com"
  MASTER_MQTT_PORT="1883"
fi
```
(These are placeholders the admin or web wizard will override before the device is commissioned.)

### `src/services/setupService.js`

Add a helper function to update key=value lines in config.env (used only for non-sensitive settings):
```js
const CONFIG_ENV_FILE = '/etc/lsg-app/config.env';

function updateConfigEnv(vars) {
    let content = fs.readFileSync(CONFIG_ENV_FILE, 'utf8');
    for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        const line = `${key}=${value}`;
        content = regex.test(content) ? content.replace(regex, line) : content + `\n${line}`;
    }
    fs.writeFileSync(CONFIG_ENV_FILE, content);
}
```

Call it from `writeSecrets()` after the encryption block (MASTER_MQTT_HOST/PORT are NOT written to secrets):
```js
updateConfigEnv({
    MASTER_MQTT_HOST: fields.masterMqttHost.trim(),
    MASTER_MQTT_PORT: fields.masterMqttPort.trim(),
});
```

Add `masterMqttHost` and `masterMqttPort` to the required fields check in `writeSecrets()`.

### `src/routes/setup.routes.js`

Destructure new fields from req.body and pass to writeSecrets:
```js
const { ..., masterMqttHost, masterMqttPort } = req.body;
// ...
await setupService.writeSecrets({ ..., masterMqttHost, masterMqttPort });
```

### `src/services/masterMqttClient.js`

Add code-level fallback for dev environments:
```js
const brokerHost = process.env.MASTER_MQTT_HOST || 'hap.faclon.com';
// port already has: process.env.MASTER_MQTT_PORT || 1883
```

### `client/src/components/Setup.jsx`

**Form state** — add two fields:
```js
masterMqttHost: 'hap.faclon.com',
masterMqttPort: '1883',
```

**IoAdmin MQTT step (Step 1)** — add host and port inputs above the username field:
```jsx
<SetupInput label="MQTT Host" value={form.masterMqttHost} onChange={set('masterMqttHost')} autoFocus placeholder="hap.faclon.com" />
<SetupInput label="MQTT Port" value={form.masterMqttPort} onChange={set('masterMqttPort')} placeholder="1883" />
```
(autoFocus moves to the first field; username field loses autoFocus.)

**`stepValid()` case 1** — extend:
```js
case 1:
  return form.masterMqttHost.trim().length > 0
    && /^\d+$/.test(form.masterMqttPort.trim())
    && form.masterMqttUsername.trim().length > 0
    && form.masterMqttPassword.length > 0;
```

**`allValid`** — add host/port conditions (remove mqttUsername/mqttPassword — see Feature 2).

**`handleSubmit()`** — add to payload:
```js
masterMqttHost: form.masterMqttHost.trim(),
masterMqttPort: form.masterMqttPort.trim(),
```

---

## Feature 2 — Remove data-forwarder MQTT from setup

### `scripts/install.sh`

Remove the "Protocol MQTT (optional)" prompt block (lines 487–496) and the conditional secrets writes (lines 556–557):
```bash
# DELETE: MQTT_USERNAME/MQTT_PASSWORD prompt section
# DELETE: [[ -n "${MQTT_USERNAME:-}" ]] && echo "MQTT_USERNAME=..."
# DELETE: [[ -n "${MQTT_PASSWORD:-}" ]]  && echo "MQTT_PASSWORD=..."
```

### `client/src/components/Setup.jsx`

**`STEPS` array** — change from 4 to 3 steps:
```js
const STEPS = ['Admin Account', 'IoAdmin MQTT', 'GitHub & API Keys'];
```

**Remove** the Step 2 JSX block (`{activeStep === 2 && ...}` Protocol MQTT section).

**Renumber** Step 3 → Step 2: change `activeStep === 3` to `activeStep === 2` for GitHub & API Keys.

**`stepValid()`** — remove case 2 (Protocol MQTT); rename case 3 → case 2.

**Form state** — remove `mqttUsername: ''` and `mqttPassword: ''`.

**`allValid`** — remove mqttUsername/mqttPassword conditions.

**`handleSubmit()`** — remove `mqttUsername` and `mqttPassword` from the payload.

### `src/routes/setup.routes.js`

Remove `mqttUsername` and `mqttPassword` from req.body destructuring and from the writeSecrets call.

### `src/services/setupService.js`

Remove jsdoc entries, remove them from the optional conditional lines:
```js
// DELETE:
if (fields.mqttUsername ...) lines.push(`MQTT_USERNAME=...`);
if (fields.mqttPassword ...) lines.push(`MQTT_PASSWORD=...`);
```

---

## Feature 3 — LSG_APP_DATA in /etc/environment

### `scripts/install.sh`

**Add prompt** early in the install — near other path variables (around lines 78–79 where `LSG_APPS_HOME` is defined). Prompt unconditionally (both interactive and defer-setup modes):
```bash
printf "  App data directory [/var/lib/lsg-app-data]: "
read -r LSG_APP_DATA
LSG_APP_DATA="${LSG_APP_DATA:-/var/lib/lsg-app-data}"
```

**Create the directory** near where `LSG_APPS_HOME` is created (around line 813):
```bash
info "Creating app data directory → $LSG_APP_DATA"
mkdir -p "$LSG_APP_DATA"
chmod 755 "$LSG_APP_DATA"
success "App data directory ready."
```

**Write to /etc/environment** (after line 832, alongside the other `set_env_var` calls):
```bash
set_env_var "LSG_APP_DATA"   "$LSG_APP_DATA"
success "  LSG_APP_DATA=$LSG_APP_DATA"
```

---

## Critical Files

| File | Change |
|------|--------|
| `scripts/install.sh` | Prompt MQTT host/port (default hap.faclon.com); chmod 664 config.env; remove Protocol MQTT prompts; prompt LSG_APP_DATA; create dir; write to /etc/environment |
| `client/src/components/Setup.jsx` | Add host/port fields to IoAdmin step; remove Protocol MQTT step; 3 steps total |
| `src/routes/setup.routes.js` | Add masterMqttHost/Port; remove mqttUsername/Password |
| `src/services/setupService.js` | Add `updateConfigEnv()` helper; write host/port to config.env; remove MQTT_USERNAME/PASSWORD |
| `src/services/masterMqttClient.js` | Add `|| 'hap.faclon.com'` fallback for MASTER_MQTT_HOST |

---

## Verification

1. **Interactive install**: `sudo bash scripts/install.sh` → prompts for "IoAdmin MQTT host" (default hap.faclon.com), port, username, password — NO "Protocol MQTT" section; prompts for "App data directory" (default /var/lib/lsg-app-data).
2. **Defer-setup**: `sudo bash scripts/install.sh --defer-setup` → open browser → Setup wizard shows 3 steps with host/port/user/pass fields in IoAdmin MQTT step; no Protocol MQTT step.
3. **Config.env update**: After web setup completes, `cat /etc/lsg-app/config.env` shows user-provided `MASTER_MQTT_HOST` and `MASTER_MQTT_PORT`.
4. **LSG_APP_DATA**: After install, `cat /etc/environment` includes `LSG_APP_DATA=...` and directory exists.
5. **Frontend build**: `cd client && npm run build` — no errors.
