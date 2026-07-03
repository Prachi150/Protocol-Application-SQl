# Implementation Plan — Data Forwarding Page (Redpanda + Redpanda Connect)

## Current State

The existing implementation generates only two hardcoded pipeline templates (MQTT output, HTTP output) with minimal configuration exposed. There is no broker configuration UI, no ability to edit existing pipelines, and the atomic write flow only covers pipeline creation.

---

## Goals

1. Full Redpanda broker configuration editor (all fields in `/etc/redpanda/redpanda.yaml`)
2. Full Redpanda Connect pipeline editor — create AND edit, guided form + raw YAML mode
3. Atomic write for both broker config and pipelines: stage → validate → deploy
4. Support all practical pipeline shapes: input options, processor chain, all output types

---

## Architecture Overview

```
UI (DataForwardingManagement.jsx)
  │
  ├── Tab: Overview      → broker status, pipeline list with edit/start/stop/delete
  ├── Tab: Broker Config → full form for redpanda.yaml, atomic write + restart
  ├── Tab: Pipelines     → create/edit pipelines, guided form or raw YAML
  └── Tab: Logs          → existing log viewer (keep as-is)

Backend (redpanda.controller.js + new scripts)
  │
  ├── Broker config endpoints  → read/write redpanda.yaml atomically
  ├── Pipeline read endpoint   → GET /pipeline/:name (returns raw YAML)
  ├── Pipeline validate        → POST /pipeline/validate (lint without deploying)
  ├── Pipeline write endpoints → existing POST + new PUT (update in-place)
  └── Broker restart           → POST /broker/restart

Atomic Write Flow (shared)
  Write YAML to data-broker/redpanda/staging/<uuid>-<name>.(yml|yaml)
    → validate (redpanda-connect lint  OR  rpk redpanda config check)
    → on pass : sudo mv to target path  +  optionally restart service
    → on fail : rm staging file, return lint errors to UI
```

---

## Phase 1 — Backend

### 1.1 New API Endpoints

Add to `src/routes/redpanda.routes.js`:

```
GET    /api/redpanda/broker/config        read /etc/redpanda/redpanda.yaml as JSON
POST   /api/redpanda/broker/config        write broker config (atomic)
POST   /api/redpanda/broker/restart       sudo systemctl restart redpanda
GET    /api/redpanda/broker/topics        rpk topic list --format json
GET    /api/redpanda/pipeline/:name       return raw YAML string for named pipeline
POST   /api/redpanda/pipeline/validate    lint YAML without deploying, return errors
PUT    /api/redpanda/pipeline/:name       update existing pipeline (atomic overwrite)
```

Existing endpoints unchanged:
```
GET    /api/redpanda/status
GET    /api/redpanda/pipelines
GET    /api/redpanda/logs
POST   /api/redpanda/pipeline             (create — keep existing applyPipeline)
DELETE /api/redpanda/pipeline/:name
```

### 1.2 Broker Config Controller (`getBrokerConfig`, `setBrokerConfig`)

**GET** — reads `/etc/redpanda/redpanda.yaml` using `sudo cat`, parses YAML with `js-yaml`,
returns the parsed object as JSON. If file is missing returns safe defaults.

**POST** — receives JSON, converts back to YAML with `js-yaml.dump()`, atomically deploys:

```
1. YAML string → data-broker/redpanda/staging/<uuid>-broker.yaml
2. sudo bash data-broker/redpanda/update-broker-config.sh <staging-path>
   Script does:
     a. rpk redpanda config set --all (dry-run validate) OR yaml schema check
     b. cp <staging> /etc/redpanda/redpanda.yaml
     c. rm <staging>
     d. optional: systemctl reload redpanda (or restart if address/port changed)
3. Return {success, restartRequired, output}
```

**Restart flag:** if the POST body includes `{ restart: true }`, the script runs
`systemctl restart redpanda` after writing the config.

### 1.3 Pipeline Read & Edit

**GET /pipeline/:name**
```js
const ymlPath = path.join(PIPELINES_DIR, `${name}.yml`);
const content = await fs.readFile(ymlPath, 'utf8');  // may need sudo cat via execAsync
res.json({ name, content });
```

**POST /pipeline/validate**
```
Receives: { content: "<yaml string>" }
1. Write to staging/<uuid>-validate.yml
2. redpanda-connect lint <staging-path>
3. Return { valid: bool, errors: string[] }
4. Always rm staging file
```

**PUT /pipeline/:name**
- Same flow as existing `applyPipeline` (generates YAML, writes staging, calls add-config.sh)
- But accepts `{ content }` (raw YAML) instead of structured form fields
- add-config.sh already handles the overwrite+restart case

### 1.4 New Shell Script: `data-broker/redpanda/update-broker-config.sh`

```bash
#!/usr/bin/env bash
# update-broker-config.sh <staging-yaml-path>
# Validates and atomically deploys a new redpanda.yaml.
set -euo pipefail

STAGING="$1"
TARGET="/etc/redpanda/redpanda.yaml"
RESTART="${2:-false}"

# Validate: rpk checks the YAML is a valid redpanda config
rpk redpanda config import --from "$STAGING" --dry-run 2>/dev/null \
  || python3 -c "import yaml,sys; yaml.safe_load(sys.stdin)" < "$STAGING" \
  || { echo "Config validation failed"; exit 1; }

cp "$STAGING" "$TARGET"
rm -f "$STAGING"

if [[ "$RESTART" == "true" ]]; then
  systemctl restart redpanda
fi
echo "Broker config deployed successfully."
```

### 1.5 Staging Directory

Create `data-broker/redpanda/staging/` and add it to `.gitignore`.
All temporary files land here and are cleaned up immediately after deploy or failure.

### 1.6 YAML Library

Add `js-yaml` as a backend dependency (already may be present via other packages — confirm):
```bash
npm install js-yaml
```

---

## Phase 2 — Frontend Structure

### 2.1 File Layout

```
client/src/components/
  DataForwardingManagement.jsx          ← root page, tab routing only
  dataforwarding/
    OverviewTab.jsx                     ← broker status card + pipeline table
    BrokerConfigTab.jsx                 ← broker config form
    PipelinesTab.jsx                    ← create/edit pipeline (form + YAML editor)
    LogsTab.jsx                         ← existing log viewer, extracted
    pipeline/
      PipelineForm.jsx                  ← guided form shell (stepper)
      InputSection.jsx                  ← kafka_franz input fields
      ProcessorsSection.jsx             ← ordered processor list (add/remove/reorder)
      OutputSection.jsx                 ← tab per output type
      output/
        MqttOutput.jsx                  ← all MQTT output fields
        HttpOutput.jsx                  ← all HTTP output fields
        KafkaOutput.jsx                 ← kafka_franz output fields
    broker/
      KafkaApiSection.jsx               ← kafka_api + advertised_kafka_api
      AdminApiSection.jsx               ← admin + admin_api_tls
      StorageSection.jsx                ← data_directory, log retention
      ClusterSection.jsx                ← auto_create_topics, SASL, partitions
      SchemaRegistrySection.jsx         ← schema_registry_api
      RpkSection.jsx                    ← rpk.overprovisioned, coredump_dir
```

### 2.2 DataForwardingManagement.jsx (root)

Purely a shell — holds tab state and passes data down:

```jsx
const TABS = ['overview', 'broker', 'pipelines', 'logs'];

export default function DataForwardingManagement() {
  const [tab, setTab] = useState('overview');
  const [editingPipeline, setEditingPipeline] = useState(null);  // name string
  const [status, setStatus] = useState(null);

  // When user clicks "Edit" on a pipeline in OverviewTab:
  const handleEditPipeline = (name) => {
    setEditingPipeline(name);
    setTab('pipelines');
  };

  return (
    <PageContainer>
      <Tabs value={tab} onValueChange={setTab}>
        ...
        <TabsContent value="overview">
          <OverviewTab status={status} onEdit={handleEditPipeline} onRefresh={fetchStatus} />
        </TabsContent>
        <TabsContent value="broker">
          <BrokerConfigTab />
        </TabsContent>
        <TabsContent value="pipelines">
          <PipelinesTab editingPipeline={editingPipeline} onEditClear={() => setEditingPipeline(null)} />
        </TabsContent>
        <TabsContent value="logs">
          <LogsTab pipelines={status?.pipelines ?? []} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
```

---

## Phase 3 — Broker Config Form

### 3.1 Data Model

The form maps directly to the `redpanda.yaml` structure. On load, `GET /broker/config`
returns the parsed YAML as JSON with these top-level keys: `redpanda`, `rpk`, `pandaproxy`,
`schema_registry`. The form mirrors this shape.

### 3.2 Form Sections

**Section A — Kafka API**

| Field | Type | Default | Notes |
|---|---|---|---|
| Bind address | text | `0.0.0.0` | `redpanda.kafka_api[0].address` |
| Port | number | `9092` | `redpanda.kafka_api[0].port` |
| Advertised address | text | `127.0.0.1` | `redpanda.advertised_kafka_api[0].address` |
| Advertised port | number | `9092` | `redpanda.advertised_kafka_api[0].port` |
| TLS enabled | toggle | off | `redpanda.kafka_api_tls[0].enabled` |
| TLS cert file | text | — | `redpanda.kafka_api_tls[0].cert_file` |
| TLS key file | text | — | `redpanda.kafka_api_tls[0].key_file` |
| Require client auth | toggle | off | `redpanda.kafka_api_tls[0].require_client_auth` |

Show TLS fields only when TLS enabled. Warn user that changing port/address requires broker restart.

**Section B — Admin API**

| Field | Type | Default |
|---|---|---|
| Bind address | text | `0.0.0.0` |
| Port | number | `9644` |
| Require auth | toggle | off |
| TLS enabled | toggle | off |
| TLS cert file | text | — |
| TLS key file | text | — |

**Section C — Storage**

| Field | Type | Default | Notes |
|---|---|---|---|
| Data directory | text | `/var/lib/redpanda/data` | — |
| Log retention | select + custom | `604800000` (7d) | Options: 1h / 6h / 24h / 7d / 30d / unlimited / custom ms |
| Log retention bytes | number | `-1` (unlimited) | -1 = no limit |
| Segment size | number | `1073741824` (1 GiB) | bytes |

**Section D — Cluster Behaviour**

| Field | Type | Default | Notes |
|---|---|---|---|
| Auto-create topics | toggle | on | `auto_create_topics_enabled` |
| Developer mode | toggle | off | skips tuning checks |
| Default partitions | number | `1` | `default_topic_partitions` |
| Default replication | number | `1` | `default_topic_replication` |
| Enable SASL | toggle | off | — |
| Enable idempotence | toggle | on | — |
| Enable transactions | toggle | on | — |

**Section E — RPK**

| Field | Type | Default |
|---|---|---|
| Overprovisioned | toggle | off |
| Coredump dir | text | `/var/lib/redpanda/coredump` |

**Section F — Schema Registry** (collapsible, off by default for edge devices)

| Field | Type | Default |
|---|---|---|
| Enabled | toggle | off |
| Bind address | text | `0.0.0.0` |
| Port | number | `8081` |

### 3.3 Submit Flow

```
User clicks Save
  → Client builds redpanda.yaml JSON from form state
  → POST /api/redpanda/broker/config { config: {...}, restart: <bool> }
  → Show inline spinner
  → On success: green alert "Config deployed. [Broker restarted / Restart required to apply port changes]"
  → On failure: red alert with lint errors
```

Restart checkbox at bottom: "Restart Redpanda broker after saving" — checked by default when port or address fields changed.

---

## Phase 4 — Pipeline Form

### 4.1 Two Modes

**Guided mode:** structured form sections → generates YAML preview in real time.
**YAML mode:** raw textarea with monospace font, validate button.

Toggle between modes via a segmented control ("Guided / YAML") at the top of PipelinesTab.
When editing an existing pipeline: always open in YAML mode (load raw file content), offer "Try Guided" button that attempts to parse it into form fields.

### 4.2 Guided Form Sections

#### Section 1 — Meta
- Pipeline name (alphanum + hyphen/underscore, required)
- Description (optional → becomes `# comment` at top of generated YAML)

#### Section 2 — Input (kafka_franz)

All source data comes from the local Redpanda broker. Most fields have safe defaults.

| Field | Type | Default | Notes |
|---|---|---|---|
| Seed brokers | list | `localhost:9092` | add/remove entries |
| Topics | list | `^devicesIn\..+\.data$` | add/remove, regexp toggle per entry |
| Consumer group | text | `lsg-forwarder-<name>` | auto-filled |
| Start offset | select | `latest` | earliest / latest / committed |
| Checkpoint limit | number | `1024` | backpressure |
| Commit period | text | `5s` | — |
| — Advanced — | collapsible | — | — |
| Fetch max bytes | text | `50MiB` | — |
| Fetch max partition bytes | text | `1MiB` | — |
| Session timeout | text | `1m` | — |
| Heartbeat interval | text | `3s` | — |
| TLS enabled | toggle | off | — |
| SASL enabled | toggle | off | type: SCRAM-SHA-256 / SCRAM-SHA-512 |
| SASL username | text | — | shown when SASL on |
| SASL password | password | — | shown when SASL on |

#### Section 3 — Processors (ordered list)

Buttons: `+ Add Processor`. Each processor is a collapsible card with a drag handle (or up/down arrows for reorder) and a delete button.

**Processor types available:**

**mapping**
- Bloblang expression (`<textarea>` monospace, 6 rows)
- Example hint shown below: `meta mqtt_topic = meta("kafka_topic").replace_all(".", "/")`

**log**
- Level: select (TRACE / DEBUG / INFO / WARN / ERROR), default INFO
- Message: text with interpolation hint (`${! content().string() }`)

**filter**
- Bloblang condition (`<textarea>`, 3 rows)
- Hint: message is dropped if condition returns false

**branch**
- Request map: bloblang (`<textarea>`)
- Result map: bloblang (`<textarea>`)
- Note: branch sub-processors not configurable in guided mode — switch to YAML for complex branching

Default processor set for new pipelines:
```yaml
processors:
  - mapping: |
      meta mqtt_topic = meta("kafka_topic").replace_all(".", "/")
  - log:
      level: INFO
      message: 'Fwd → ${! meta("mqtt_topic") } | ${! content().string() }'
```

#### Section 4 — Output

Output type selector: `MQTT` | `HTTP` | `Kafka (kafka_franz)`

---

**MQTT Output fields:**

| Field | Type | Default | Notes |
|---|---|---|---|
| Broker URL(s) | list | — | `tcp://host:port` format, add/remove |
| Topic | text | `${! meta("mqtt_topic") }` | supports Bloblang interpolation |
| Client ID | text | `lsg-forwarder-<name>` | auto-filled |
| QoS | select | `1` | 0 / 1 / 2 |
| Keepalive (s) | number | `30` | — |
| Connect timeout | text | `10s` | — |
| Write timeout | text | `30s` | — |
| Max in-flight | number | `64` | — |
| Retained | toggle | off | — |
| — Credentials — | section | — | — |
| Creds mode | radio | IoAdmin | IoAdmin (uses MASTER_MQTT_*) / Custom |
| Username | text | — | shown when custom; `${FORWARDER_MQTT_USERNAME}` injected |
| Password | password | — | shown when custom; encrypted to secrets.env.age |
| — TLS — | collapsible | — | — |
| TLS enabled | toggle | off | — |
| Skip cert verify | toggle | off | — |
| Root CA file | text | — | path on device |
| — Last Will — | collapsible | — | — |
| Enabled | toggle | off | — |
| Topic | text | — | — |
| Payload | text | — | — |
| QoS | select | `1` | — |
| Retained | toggle | off | — |

---

**HTTP Output fields:**

| Field | Type | Default | Notes |
|---|---|---|---|
| URL | text | — | required; supports interpolation |
| Method | select | `POST` | GET / POST / PUT / PATCH |
| Timeout | text | `10s` | — |
| Retries | number | `3` | — |
| Retry period | text | `5s` | initial |
| Max retry backoff | text | `300s` | — |
| Max in-flight | number | `64` | — |
| Follow redirects | toggle | on | — |
| — Headers — | key-value list | Content-Type: application/json | add/remove rows |
| Backoff on (status codes) | text | `429` | comma-separated |
| Drop on (status codes) | text | — | comma-separated |
| — Auth — | select | None | None / Basic / Bearer / OAuth2 / JWT |
| Basic username | text | — | shown when Basic |
| Basic password | password | — | shown when Basic |
| Bearer token | text | — | added as `Authorization: Bearer <token>` header |
| OAuth2 client ID | text | — | shown when OAuth2 |
| OAuth2 client secret | password | — | shown when OAuth2 |
| OAuth2 token URL | text | — | shown when OAuth2 |
| — TLS — | collapsible | — | same as MQTT |
| — Batching — | collapsible | — | — |
| Batch count | number | `0` | 0 = disabled |
| Batch byte size | number | `0` | 0 = disabled |
| Batch period | text | — | e.g. `5s` |

---

**Kafka Output fields (kafka_franz):**

| Field | Type | Default | Notes |
|---|---|---|---|
| Seed brokers | list | `localhost:9092` | add/remove |
| Topic | text | — | supports interpolation |
| Key | text | — | optional, Bloblang interpolation |
| Compression | select | none | none / lz4 / snappy / gzip / zstd |
| Max in-flight | number | `10` | batches |
| Timeout | text | `10s` | — |
| Idempotent write | toggle | on | — |
| Allow auto topic creation | toggle | on | — |
| Partitioner | select | `murmur2_hash` | murmur2_hash / round_robin / least_backup / manual |
| — Batching — | collapsible | off | count / byte_size / period |
| — TLS — | collapsible | off | same pattern |
| — SASL — | collapsible | off | type + credentials |
| — Metadata headers — | collapsible | — | include_prefixes list |

### 4.3 YAML Preview (live)

In guided mode, a collapsible "Preview Generated YAML" panel at the bottom updates in real
time as the user fills the form. Uses monospace font, syntax-highlighted via simple CSS classes
(no external library needed — apply colors to lines starting with keys/values).

### 4.4 Validate & Deploy Flow

```
Validate button (or on every YAML change after 800ms debounce in YAML mode):
  POST /api/redpanda/pipeline/validate { content: "<yaml>" }
  → show green "Valid YAML" or red error list under the editor

Deploy button:
  POST /api/redpanda/pipeline       (new)
  PUT  /api/redpanda/pipeline/:name (update)
  Body: { name, content: "<yaml string>" }
  → Backend:
      write to staging/<uuid>-<name>.yml
      redpanda-connect lint staging/<uuid>-<name>.yml
      on pass: sudo bash add-config.sh staging/<uuid>-<name>.yml
      on fail: rm staging file, return errors
  → Frontend:
      success: green alert "Pipeline deployed and started"
      failure: red alert with lint output
```

### 4.5 Edit Existing Pipeline

In OverviewTab, each pipeline row has an Edit button (pencil icon, neutral IconBtn).
Clicking it:
1. Sets `editingPipeline = name` in root state
2. Switches to Pipelines tab
3. PipelinesTab calls `GET /api/redpanda/pipeline/:name`
4. Opens YAML editor pre-filled with the pipeline's current content
5. "Try Guided" button attempts to parse the YAML into form state:
   - Parses with `js-yaml.load()`
   - Maps known keys to form fields
   - If unknown/complex keys found: show warning banner "This pipeline has fields not supported by the guided form. Edit in YAML mode."
6. Save calls `PUT /api/redpanda/pipeline/:name`

---

## Phase 5 — Overview Tab Improvements

### 5.1 Broker Status Card

Current: just a running/stopped dot.

Expand to show:
- Running / Stopped status dot
- Redpanda version (`rpk version`)
- Kafka API address:port (read from config)
- Topic count (`rpk topic list | wc -l`)
- `Restart Broker` button (danger variant IconBtn) → calls `POST /broker/restart`

### 5.2 Pipeline Table

Replace the flat list with a proper table:

| Column | Content |
|---|---|
| Name | pipeline name, monospace |
| Type | MQTT / HTTP / Kafka badge |
| Status | active (success) / inactive (neutral) / failed (danger) |
| Actions | Edit (pencil), Restart (warning), Stop/Start (success/danger), Delete (danger) |

Actions:
- **Edit** → navigates to Pipelines tab with pipeline pre-loaded
- **Restart** → `sudo systemctl restart redpanda-connect@<name>`  — add endpoint `POST /pipeline/:name/restart`
- **Stop/Start** → `sudo systemctl stop/start` — add endpoint `POST /pipeline/:name/action { action: 'start'|'stop' }`
- **Delete** → existing DELETE endpoint, with confirmation dialog

---

## Phase 6 — New Backend Endpoints Detail

Add to `redpanda.controller.js`:

```js
// GET /broker/config
async function getBrokerConfig(req, res) {
  const { stdout } = await execAsync('sudo cat /etc/redpanda/redpanda.yaml');
  const config = yaml.load(stdout);
  res.json({ config });
}

// POST /broker/config
async function setBrokerConfig(req, res) {
  const { config, restart = false } = req.body;
  const yamlContent = yaml.dump(config, { lineWidth: 120 });
  const stagingPath = path.join(DATA_FORWARDER_DIR, 'staging', `${Date.now()}-broker.yaml`);
  await fs.writeFile(stagingPath, yamlContent, { mode: 0o600 });
  const script = path.join(DATA_FORWARDER_DIR, 'update-broker-config.sh');
  const { stdout, stderr } = await execAsync(
    `sudo bash "${script}" "${stagingPath}" "${restart}"`
  );
  res.json({ success: true, output: (stdout + stderr).trim() });
}

// POST /broker/restart
async function restartBroker(req, res) {
  await execAsync('sudo systemctl restart redpanda');
  res.json({ success: true });
}

// GET /broker/topics
async function getBrokerTopics(req, res) {
  const { stdout } = await execAsync('rpk topic list --format json 2>/dev/null || echo "[]"');
  res.json({ topics: JSON.parse(stdout) });
}

// GET /pipeline/:name
async function getPipeline(req, res) {
  const { name } = req.params;
  const content = await fs.readFile(
    path.join(PIPELINES_DIR, `${name}.yml`), 'utf8'
  ).catch(() => null);
  if (!content) return res.status(404).json({ error: 'Pipeline not found' });
  res.json({ name, content });
}

// POST /pipeline/validate
async function validatePipeline(req, res) {
  const { content } = req.body;
  const stagingPath = path.join(DATA_FORWARDER_DIR, 'staging', `${Date.now()}-validate.yml`);
  await fs.writeFile(stagingPath, content, { mode: 0o600 });
  try {
    const { stdout, stderr } = await execAsync(
      `redpanda-connect lint "${stagingPath}" 2>&1 || true`
    );
    const output = (stdout + stderr).trim();
    const valid = !output.includes('lint errors') && !output.toLowerCase().includes('error');
    res.json({ valid, output });
  } finally {
    await fs.unlink(stagingPath).catch(() => {});
  }
}

// PUT /pipeline/:name
// Reuses applyPipeline logic but with { name, content } body (raw YAML)
async function updatePipeline(req, res) {
  const { name } = req.params;
  const { content } = req.body;
  const tmpYml = path.join(os.tmpdir(), `${name}.yml`);
  await fs.writeFile(tmpYml, content, { mode: 0o600 });
  const addConfigScript = path.join(DATA_FORWARDER_DIR, 'add-config.sh');
  const { stdout, stderr } = await execAsync(`sudo bash "${addConfigScript}" "${tmpYml}"`);
  await fs.unlink(tmpYml).catch(() => {});
  res.json({ success: true, pipeline: name, output: (stdout + stderr).trim() });
}

// POST /pipeline/:name/action
async function pipelineAction(req, res) {
  const { name } = req.params;
  const { action } = req.body;  // 'start' | 'stop' | 'restart'
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  await execAsync(`sudo systemctl ${action} "redpanda-connect@${name}"`);
  res.json({ success: true });
}
```

---

## Phase 7 — YAML Generator (Frontend)

A pure function `generatePipelineYaml(formState): string` lives in
`client/src/components/dataforwarding/pipeline/yamlGenerator.js`.

It takes the form state object and returns a complete, validated YAML string using
template literals (no external YAML library needed on the frontend — the output is
deterministic enough to build via string templates).

Structure:
```js
export function generatePipelineYaml({ meta, input, processors, output }) {
  return [
    generateHeader(meta),
    generateInput(input),
    generatePipeline(processors),
    generateOutput(output),
  ].join('\n');
}
```

Each section is a pure function that maps its slice of form state to a YAML string.
This is the source of truth for the live YAML preview.

---

## Phase 8 — API Endpoint Constants

Add to `client/src/config/api.js`:

```js
REDPANDA: {
  STATUS:           '/api/redpanda/status',
  PIPELINES:        '/api/redpanda/pipelines',
  PIPELINE:         '/api/redpanda/pipeline',    // POST + DELETE /:name
  PIPELINE_VALIDATE:'/api/redpanda/pipeline/validate',
  LOGS:             '/api/redpanda/logs',
  BROKER_CONFIG:    '/api/redpanda/broker/config',
  BROKER_RESTART:   '/api/redpanda/broker/restart',
  BROKER_TOPICS:    '/api/redpanda/broker/topics',
}
```

---

## Phase 9 — Implementation Order

Execute in this order to keep the app functional at every step:

1. **Backend foundation**
   - Add `js-yaml` to package.json
   - Create `data-broker/redpanda/staging/` dir + .gitignore entry
   - Add `getPipeline`, `validatePipeline`, `updatePipeline`, `pipelineAction` to controller
   - Add `getBrokerConfig`, `setBrokerConfig`, `restartBroker`, `getBrokerTopics`
   - Write `update-broker-config.sh`
   - Register all new routes in `redpanda.routes.js`
   - **Test each endpoint with curl before touching frontend**

2. **LogsTab extraction**
   - Move existing logs UI from DataForwardingManagement.jsx → `LogsTab.jsx`
   - No logic changes, just extraction
   - Verify existing log functionality still works

3. **OverviewTab**
   - Move existing status + pipeline list → `OverviewTab.jsx`
   - Add Edit button wiring (just logs to console for now)
   - Add Stop/Start/Restart actions

4. **BrokerConfigTab**
   - Implement form sections A → F
   - Wire GET/POST endpoints
   - Test atomic write flow end-to-end

5. **PipelinesTab — YAML mode first**
   - Implement YAML editor + validate button
   - Wire PUT for edit, POST for create
   - Load existing pipeline via GET /:name when editingPipeline is set
   - Wire OverviewTab Edit button

6. **PipelinesTab — Guided form**
   - Implement InputSection
   - Implement ProcessorsSection
   - Implement MqttOutput, HttpOutput, KafkaOutput
   - Implement `generatePipelineYaml` and live preview
   - Wire "Try Guided" button for existing pipelines

7. **Polish**
   - Validate-on-blur in guided form fields
   - Debounced validate in YAML editor
   - Confirmation dialogs (delete, broker restart)
   - Loading/error states for all async operations

---

## File Changeset Summary

| File | Change |
|---|---|
| `src/controllers/redpanda.controller.js` | Add 7 new functions |
| `src/routes/redpanda.routes.js` | Add 8 new routes |
| `data-broker/redpanda/update-broker-config.sh` | New |
| `data-broker/redpanda/staging/` | New directory |
| `.gitignore` | Add `data-broker/redpanda/staging/` |
| `client/src/config/api.js` | Add new endpoint constants |
| `client/src/components/DataForwardingManagement.jsx` | Rewrite as tab shell |
| `client/src/components/dataforwarding/OverviewTab.jsx` | New |
| `client/src/components/dataforwarding/BrokerConfigTab.jsx` | New |
| `client/src/components/dataforwarding/PipelinesTab.jsx` | New |
| `client/src/components/dataforwarding/LogsTab.jsx` | New (extracted) |
| `client/src/components/dataforwarding/pipeline/PipelineForm.jsx` | New |
| `client/src/components/dataforwarding/pipeline/InputSection.jsx` | New |
| `client/src/components/dataforwarding/pipeline/ProcessorsSection.jsx` | New |
| `client/src/components/dataforwarding/pipeline/OutputSection.jsx` | New |
| `client/src/components/dataforwarding/pipeline/output/MqttOutput.jsx` | New |
| `client/src/components/dataforwarding/pipeline/output/HttpOutput.jsx` | New |
| `client/src/components/dataforwarding/pipeline/output/KafkaOutput.jsx` | New |
| `client/src/components/dataforwarding/pipeline/yamlGenerator.js` | New |
| `client/src/components/dataforwarding/broker/KafkaApiSection.jsx` | New |
| `client/src/components/dataforwarding/broker/StorageSection.jsx` | New |
| `client/src/components/dataforwarding/broker/ClusterSection.jsx` | New |
| `client/src/components/dataforwarding/broker/SchemaRegistrySection.jsx` | New |
| `package.json` | Add `js-yaml` |

Total: ~25 files (8 modified, ~17 new).

---

## Key Design Decisions & Rationale

**No external YAML editor library** — keeps bundle size down. A styled `<textarea>` with
monospace font handles raw YAML editing. Syntax highlighting is not worth the dependency
for an admin tool.

**Guided form generates YAML via string templates, not a YAML library** — the generated
pipelines are intentionally simple and deterministic. String templates are easier to
read, audit, and debug than going through a serializer.

**js-yaml is backend-only** — needed to read/write `redpanda.yaml` (which has objects
and arrays that can't be reliably stringified manually). Not added to the frontend bundle.

**Atomic write via staging directory** — avoids the race where a partially written config
file is loaded by the service. Staging files are UUIDs so concurrent deploys don't
collide. The shell script is the only process that does the final `cp` to the target path.

**Edit existing pipelines defaults to YAML mode** — pipeline YAMLs can be hand-edited on
the filesystem. Parsing arbitrary YAML back into structured form state is fragile. YAML
mode is always correct; guided mode is a convenience for new pipelines.

**No direct `redpanda.yaml` field for cluster-level properties** — cluster properties
like `log_retention_ms` are applied via `rpk cluster config set`, not `redpanda.yaml`.
The broker config form only exposes node-level properties (the `redpanda:`, `rpk:`,
`schema_registry:` stanzas). A separate "Cluster Settings" section using `rpk cluster
config` commands can be added later.
