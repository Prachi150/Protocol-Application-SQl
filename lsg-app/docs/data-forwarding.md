# Data forwarding

Data forwarding is how device data collected by the protocol adapters reaches its
destination — an MQTT broker, an HTTP endpoint, or another Kafka cluster.

LSG implements forwarding using **Redpanda Connect** (a Benthos-style stream processor)
running locally as a set of systemd-managed services. Each *pipeline* is its own
service; the local Redpanda broker buffers messages between adapters and pipelines.

> **Note:** an earlier internal design used a custom `dataForwarder.js` Node module.
> That module no longer exists — all forwarding flows through Redpanda pipelines now.
> The legacy `iot.forwarding.{mqtt,http}` keys in `config/app-config.json` are still
> persisted by [configManager.js](../src/services/configManager.js) but are not read
> by the runtime forwarder.

## Topology

```
┌────────────────────┐                                     ┌──────────────────┐
│ Protocol adapter   │  publishes to Kafka topic           │  External MQTT   │
│ (e.g. opcua)       │  e.g. "telemetry"                   │  broker          │
└─────────┬──────────┘                                     │                  │
          │                                                │  / HTTP endpoint │
          ▼                                                │                  │
┌────────────────────┐         ┌──────────────────────┐    │  / Kafka cluster │
│ Local Redpanda     │ reads   │ redpanda-connect@    │───▶│                  │
│ broker (port 9092) │────────▶│   <pipeline>.service │    └──────────────────┘
└────────────────────┘         └──────────────────────┘
                                  one systemd unit per pipeline
                                  config:
                                  /etc/redpanda-connect/pipelines/<name>.yml
```

### Why a broker in the middle?

- **Decoupling** — the adapter doesn't need to know how data leaves the device.
  Add or change forwarders without touching adapter code.
- **Buffering** — if upstream is offline, Redpanda buffers messages on disk; when
  the link recovers, pipelines drain.
- **Fan-out** — one source topic can feed many pipelines (e.g. send the same data to
  MQTT *and* an HTTP endpoint *and* another Kafka cluster).

## Components

### Redpanda broker

Installed by [data-broker/redpanda/install.sh](../data-broker/redpanda/install.sh).
Runs as `systemctl status redpanda`. Config at `/etc/redpanda/redpanda.yaml`.

UI controls (via [src/controllers/redpanda.controller.js](../src/controllers/redpanda.controller.js)):

- `/api/redpanda/status` — broker + pipeline service activity
- `/api/redpanda/broker/config` (GET/POST) — view/edit YAML
- `/api/redpanda/broker/restart` — `systemctl restart redpanda`
- `/api/redpanda/broker/topics`, `/api/redpanda/topics` — list topics
- `/api/redpanda/consumers` — list consumer groups

### Pipelines

Each pipeline is a Redpanda Connect YAML config that defines an `input` (always Kafka
on the local broker), a chain of `processors`, and an `output`. Each gets its own
systemd unit:

- Service unit pattern: `redpanda-connect@<name>.service`
- Config path: `/etc/redpanda-connect/pipelines/<name>.yml`
- Logs: `journalctl -u redpanda-connect@<name>` (or `/api/redpanda/logs` for combined)
- Output type detected by string-matching the YAML for `mqtt:`, `http_client:`, or `kafka_franz:` ([redpanda.controller.js](../src/controllers/redpanda.controller.js))

Lifecycle endpoints:

| Action     | Endpoint                                                    |
|------------|-------------------------------------------------------------|
| List       | `GET  /api/redpanda/pipelines`                              |
| Read       | `GET  /api/redpanda/pipeline/:name`                         |
| Validate   | `POST /api/redpanda/pipeline/validate` (runs `connect lint`)|
| Create     | `POST /api/redpanda/pipeline`                               |
| Update     | `PUT  /api/redpanda/pipeline/:name`                         |
| Delete     | `DELETE /api/redpanda/pipeline/:name`                       |
| Start/stop | `POST /api/redpanda/pipeline/:name/action` `{action}`       |

The create flow:

1. POST body `{ name, yaml, secrets? }`.
2. YAML is staged at `data-broker/redpanda/staging/<uuid>-<name>.yml`.
3. `redpanda connect lint` validates it; failure → `400`.
4. If `secrets` is provided, [scripts/update-forwarder-secrets.sh](../scripts/update-forwarder-secrets.sh) is invoked via sudo to merge them into `/etc/lsg-app/forwarder-secrets.env.age` (a *separate* age bundle from `secrets.env.age`) and rebuild `/run/lsg-app/secrets.env`.
5. Staged YAML is moved to `/etc/redpanda-connect/pipelines/<name>.yml`.
6. `systemctl enable --now redpanda-connect@<name>.service`.

Updates and deletes restart or stop the corresponding service. Deleting a pipeline
does **not** delete its credentials — those persist in the encrypted forwarder-secrets
bundle.

## Secret management for pipelines

Pipelines reference credentials via `${ENV_VAR}` in their YAML. Those env vars come
from `/run/lsg-app/secrets.env`, which is the merged decryption of two age bundles:

```
/etc/lsg-app/secrets.env.age            ← admin/MQTT/JWT (managed by setup wizard)
/etc/lsg-app/forwarder-secrets.env.age  ← pipeline secrets (managed by update-forwarder-secrets.sh)
                            │
                            ▼ at boot, both are decrypted and concatenated to:
/run/lsg-app/secrets.env    (tmpfs)
```

`update-forwarder-secrets.sh` ([scripts/update-forwarder-secrets.sh](../scripts/update-forwarder-secrets.sh)):

1. Reads existing `forwarder-secrets.env.age` if present.
2. Merges new `KEY=VALUE` pairs (overwrite on key collision).
3. Re-encrypts with the device's age key.
4. Rebuilds `/run/lsg-app/secrets.env`.
5. Caller (`redpanda.controller.js`) then restarts every `redpanda-connect@*` service so
   they pick up the new env.

The split into two age bundles exists so pipeline secret rotation does not require
re-running the full setup wizard.

## Example pipeline YAML

```yaml
input:
  kafka_franz:
    seed_brokers: ["localhost:9092"]
    topics: ["telemetry"]
    consumer_group: "to-cloud-mqtt"

pipeline:
  processors:
    - mapping: |
        root.deviceId = this.id
        root.payload = this.measurements
        root.timestamp = now()

output:
  mqtt:
    urls: ["tcp://broker.example.com:1883"]
    topic: "iot/${! json(\"deviceId\") }/data"
    client_id: "lsg-${HOSTNAME}"
    user: "${MQTT_FORWARDER_USER}"     # from forwarder-secrets bundle
    password: "${MQTT_FORWARDER_PASS}"
    qos: 1
```

When this is POSTed to `/api/redpanda/pipeline` with
`secrets: [{ key: "MQTT_FORWARDER_USER", value: "..." }, ...]`, the secrets are
persisted encrypted, the YAML is written, and the service is enabled and started.

## Frontend

The Data Forwarding page ([client/src/components/dataforwarding/](../client/src/components/dataforwarding/)) has four tabs:

- **Overview** — broker status, pipeline summary
- **Topics** — topics on the local broker
- **Pipelines** — list, edit, validate, start/stop, delete; YAML editor with output-type detection
- **Logs** — combined `journalctl` tail across all pipeline services

## Failure modes & debugging

| Symptom                                          | Cause / where to look |
|--------------------------------------------------|------------------------|
| Pipeline shows `failed` after create             | Broker unreachable, bad output URL, or missing env var. `journalctl -u redpanda-connect@<name>`. |
| Validation passes but pipeline silently emits no data | Adapter is publishing to a different topic, or pipeline `consumer_group` collides with another pipeline reading from offset 0 (use distinct groups). |
| Credentials look correct but auth fails           | The pipeline service was not restarted after `update-forwarder-secrets.sh`. The controller does this automatically; if you edited the bundle by hand, run `systemctl restart 'redpanda-connect@*'`. |
| `/api/redpanda/topics` empty                      | No producer has connected. Confirm an adapter is running and pushing to the topic name configured in the pipeline. |
| Broker config edit broke startup                  | YAML invalid. Restore `/etc/redpanda/redpanda.yaml` from `/etc/redpanda/redpanda.yaml.bak` (created by the controller before each write). |
