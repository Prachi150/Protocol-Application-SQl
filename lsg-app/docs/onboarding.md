# Onboarding

"Onboarding" is the act of pairing a freshly installed gateway with the **ioadmin**
platform. After onboarding, ioadmin knows the device exists and can send it commands;
the gateway in turn streams heartbeats and accepts remote control over MQTT.

This is **separate** from the first-run *setup* wizard, which only configures the
gateway itself (admin password, secrets, MQTT broker credentials). Setup happens once
at install time; onboarding can be re-run any time to swap which ioadmin instance
this device reports to.

## State machine

The onboarding state lives in `config/app-config.json` under the `onboarding` key:

```json
"onboarding": {
  "token": "<opaque token from ioadmin>",
  "status": "onboarded",
  "adminUrl": "https://hap.faclon.com",
  "connectionMode": "direct",
  "onboardedAt": "2026-04-30T11:14:09.812Z"
}
```

If the key is absent or `status !== 'onboarded'`, the gateway is **not onboarded**:

- the heartbeat service [refuses to start](../src/services/heartbeatService.js)
- the master MQTT client connects but [skips command-topic subscription](../src/services/masterMqttClient.js) — it has no token to subscribe with

## Onboarding flow

```
Browser                 lsg-app                    ioadmin (over MQTT)
   │                       │                              │
   │  POST /api/system/onboard                           │
   │  { token, adminUrl? }                               │
   ├──────────────────────▶│                              │
   │                       │ resetApps() if already       │
   │                       │ onboarded                    │
   │                       │                              │
   │                       │ publishAndWait(              │
   │                       │   "lsg/onboard/<token>",     │
   │                       │   { token, systemDetails })  │
   │                       ├─────────────────────────────▶│
   │                       │                              │
   │                       │     subscribe to             │
   │                       │  "lsg/onboard/<token>/res"   │
   │                       │◀─────────────────────────────┤
   │                       │  { success: true,            │
   │                       │    sshPublicKey?, vpnConfig?,│
   │                       │    connectionMode }          │
   │                       │                              │
   │                       │ persist onboarding to        │
   │                       │ app-config.json              │
   │                       │ subscribe lsg/<token>/cmd/#  │
   │                       │ install SSH key              │
   │                       │ start VPN if config provided │
   │                       │ start heartbeat              │
   │                       │                              │
   │◀──────────────────────┤  { success: true }           │
```

`publishAndWait` is in [masterMqttClient.js:242](../src/services/masterMqttClient.js#L242);
the orchestration is in [onboardingService.onboard()](../src/services/onboardingService.js).

## What gets sent in `systemDetails`

Collected by [onboardingService.getSystemInfo()](../src/services/onboardingService.js):

```json
{
  "systemInformation": {
    "os": "Linux 5.15.0 (x64)",
    "processor": "Intel(R) Core(TM) i5-8265U CPU @ 1.60GHz",
    "installedRam": "8 GB",
    "storage": "128G (44G used, 78G free)",
    "uptime": "3d 4h 12m"
  },
  "resourceOverview": {
    "cpu": 4,
    "ram": 8,
    "disk": 128,
    "cpuUsage": 17,
    "ramUsage": 62,
    "diskUsage": 35
  },
  "networkConfig": {
    "publicIp": "203.0.113.42",
    "privateIp": "192.168.1.50",
    "vpnIp": null,
    "lsgPort": 3001,
    "sshUsername": "lsg-app"
  }
}
```

## What ioadmin sends back

The response payload may include any of:

| Field               | Effect on the gateway |
|---------------------|------------------------|
| `success`           | Boolean. If false, the gateway aborts and surfaces the error to the UI. |
| `connectionMode`    | Stored in `onboarding.connectionMode`. Currently `direct` or `vpn`. |
| `sshPublicKey`      | Appended to `~/.ssh/authorized_keys` so ioadmin operators can SSH in. |
| `sshTargetUsername` | Optional — if set, the key is also installed for that user (e.g. `pi`). |
| `vpnConfig.vpnFile` | Base64 OpenVPN profile. Auto-imported via `vpnService.downloadAndSetupProfile` and enabled. |

The `success: false` path is handled by raising the error message back to the wizard
without persisting state — the gateway stays un-onboarded.

## Heartbeat (post-onboarding)

Once onboarded, [heartbeatService](../src/services/heartbeatService.js) starts:

- Interval: `HEARTBEAT_INTERVAL` env var (default 60 000 ms)
- Primary transport: `lsg/<token>/heartbeat` over master MQTT (QoS 0)
- Fallback: `POST <adminUrl>/api/lsg/public/heartbeat` if MQTT is offline
- Payload: `{ resourceOverview, uptime, vpnIp, vpnStatus }`

If onboarding has not happened yet, `start()` exits early — the gateway will only
begin heartbeating after the wizard completes.

## Reset / re-onboarding

`POST /api/system/onboard/reset` ([onboarding.routes.js:44](../src/routes/onboarding.routes.js#L44)):

1. Iterates `apps/` and runs `uninstallApp(name, path)` on every directory — this
   shells out to each app's `scripts/uninstall.sh` and deregisters from
   `config/app-registry.json`.
2. Stops the heartbeat timer.
3. Deletes `config.onboarding` and persists.

`POST /api/system/onboard` will trigger an **automatic reset before re-onboarding**
if the device is already onboarded — see
[onboardingService.js:235](../src/services/onboardingService.js#L235). This is
deliberate: a fresh ioadmin pairing should not inherit apps installed under the
previous one.

> **Implication for ops:** rotating the ioadmin instance wipes all installed protocol
> apps on the gateway. The user is expected to redeploy them via the new ioadmin's UI.

## SSH key handling

`installSshPublicKey()` ([onboardingService.js:149](../src/services/onboardingService.js#L149)):

- Always installs the key under the process owner's home (`os.homedir()/.ssh/authorized_keys`).
- If `sshTargetUsername` is provided in the onboarding response, also installs the key
  under that user's home, fixing ownership when `lsg-app` runs as root.
- De-duplicates: an exact-match line is not re-appended.
- Creates `~/.ssh` with `0700` and the file with `0600` if absent.

## Failure modes & debugging

| Symptom                                          | Cause / where to look |
|--------------------------------------------------|------------------------|
| `POST /onboard` hangs for 30s then fails         | ioadmin did not respond on `lsg/onboard/<token>/res`. Check master MQTT connectivity, broker auth, and that the token matches the one issued by ioadmin. |
| Onboarding succeeds but no commands arrive       | `subscribeToCommandTopics()` failed — check master MQTT logs. The token must be present in `onboarding.token` for the subscribe topic to be built. |
| Heartbeats not arriving despite onboarding       | Heartbeat only starts at boot if `onboarding.status === 'onboarded'`. If you onboarded without restart, that's expected — restart the service or the post-onboard handler should already have called `heartbeatService.start()`. |
| "Already onboarded" but trying to onboard again  | The endpoint auto-resets first. To inspect state, hit `GET /api/system/onboard/status`. |
| `vpnConfig` provided but VPN not active          | `vpnService.downloadAndSetupProfile` errors are logged but **non-fatal** — onboarding still completes. Check `journalctl -u lsg-app` for `[Onboarding] VPN auto-setup failed`. |

## Why MQTT (not HTTP) for onboarding?

Originally onboarding used `POST <adminUrl>/api/lsg/public/onboard` over HTTPS. It was
moved to MQTT request/response so the same broker connection that powers commands and
heartbeat is the only network dependency. `adminUrl` is now optional — kept only as the
HTTP fallback for heartbeat and the install callback ([protocol.controller.js:381](../src/controllers/protocol.controller.js#L381)).
