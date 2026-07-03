const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const { randomUUID } = require('crypto');

const PIPELINES_DIR = '/etc/redpanda-connect/pipelines';
const LOG_DIR = '/var/log/redpanda-connect';
const DATA_FORWARDER_DIR = path.join(process.cwd(), 'data-broker', 'redpanda');
const STAGING_DIR = path.join(DATA_FORWARDER_DIR, 'staging');
const UPDATE_SECRETS_SCRIPT = path.join(process.cwd(), 'scripts', 'update-forwarder-secrets.sh');
const BROKER_CONFIG_PATH = '/etc/redpanda/redpanda.yaml';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function serviceIsActive(name) {
    try {
        await execAsync(`systemctl is-active --quiet "${name}"`);
        return true;
    } catch {
        return false;
    }
}

async function listActivePipelines() {
    try {
        const { stdout } = await execAsync(
            "systemctl list-units --type=service --all --no-legend --plain 2>/dev/null | awk '{print $1}' | grep '^redpanda-connect@' || true"
        );
        const services = stdout.trim().split('\n').filter(Boolean);
        const pipelines = [];
        for (const svc of services) {
            const pipelineName = svc.replace('redpanda-connect@', '').replace('.service', '');
            let status = 'unknown';
            try {
                const { stdout: st } = await execAsync(`systemctl is-active "${svc}" 2>/dev/null || true`);
                status = st.trim();
            } catch { /* ignore */ }

            let outputType = 'unknown';
            try {
                const ymlPath = path.join(PIPELINES_DIR, `${pipelineName}.yml`);
                const content = await fs.readFile(ymlPath, 'utf8');
                if (content.includes('mqtt:')) outputType = 'mqtt';
                else if (content.includes('http_client:')) outputType = 'http';
                else if (content.includes('kafka_franz:') && content.includes('output:')) outputType = 'kafka';
            } catch { /* yml may not exist yet */ }

            pipelines.push({ name: pipelineName, service: svc, status, outputType });
        }
        return pipelines;
    } catch {
        return [];
    }
}

async function restartAllPipelines() {
    try {
        const { stdout } = await execAsync(
            "systemctl list-units --type=service --all --no-legend --plain 2>/dev/null | awk '{print $1}' | grep '^redpanda-connect@' || true"
        );
        const services = stdout.trim().split('\n').filter(Boolean);
        for (const svc of services) {
            try { await execAsync(`sudo systemctl restart "${svc}"`); }
            catch (e) { console.warn(`Could not restart ${svc}:`, e.message); }
        }
    } catch { /* ignore if no pipelines exist yet */ }
}

async function persistForwarderCreds(keyValuePairs) {
    const args = keyValuePairs.map(({ key, value }) => `${key}=${value}`);
    await execAsync(`sudo bash "${UPDATE_SECRETS_SCRIPT}" ${args.map(a => `'${a}'`).join(' ')}`);
    await restartAllPipelines();
}

function stagingPath(label) {
    return path.join(STAGING_DIR, `${randomUUID()}-${label}`);
}

async function cleanupStaging(filePath) {
    await fs.unlink(filePath).catch(() => {});
}

// ── Status ────────────────────────────────────────────────────────────────────

async function getStatus(req, res) {
    try {
        const brokerRunning = await serviceIsActive('redpanda');
        const pipelines = await listActivePipelines();

        let brokerVersion = null;
        if (brokerRunning) {
            try {
                const { stdout } = await execAsync('rpk version 2>/dev/null || true');
                brokerVersion = stdout.trim().split('\n')[0] || null;
            } catch { /* ignore */ }
        }

        res.json({ broker: { running: brokerRunning, version: brokerVersion }, pipelines });
    } catch (error) {
        console.error('Error getting Redpanda status:', error);
        res.status(500).json({ error: error.message });
    }
}

// ── Broker config ─────────────────────────────────────────────────────────────

function deriveKafkaSecurityProtocol(config) {
    const authMethod = config.redpanda?.kafka_api?.[0]?.authentication_method || 'none';
    const tlsEnabled = config.redpanda?.kafka_api_tls?.[0]?.enabled === true;
    if (authMethod === 'sasl') return tlsEnabled ? 'SASL_SSL' : 'SASL_PLAINTEXT';
    if (authMethod === 'mtls_identity') return 'SSL';
    return tlsEnabled ? 'SSL' : 'PLAINTEXT';
}

function deriveKafkaSaslMechanism(config) {
    const mechanisms = config.redpanda?.sasl_mechanisms || [];
    if (mechanisms.includes('SCRAM')) return 'SCRAM-SHA-256';
    return '';
}

async function getBrokerConfig(req, res) {
    try {
        const { stdout } = await execAsync(`sudo cat "${BROKER_CONFIG_PATH}" 2>/dev/null || echo ""`);
        if (!stdout.trim()) {
            return res.json({ config: null });
        }
        const config = yaml.load(stdout);
        res.json({ config });
    } catch (error) {
        console.error('Error reading broker config:', error);
        res.status(500).json({ error: error.message });
    }
}

async function setBrokerConfig(req, res) {
    const { config, restart = false } = req.body;
    if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'config object is required' });
    }

    const staging = stagingPath('broker.yaml');
    const envStaging = stagingPath('env-updates.tmp');
    try {
        const yamlContent = yaml.dump(config, { lineWidth: 120, noRefs: true });
        await fs.writeFile(staging, yamlContent, { mode: 0o600 });

        // Derive /etc/environment updates from the new config
        const kafkaPort = String(config.redpanda?.kafka_api?.[0]?.port || 9092);
        const adminPort = String(config.redpanda?.admin?.[0]?.port     || 9644);
        const envUpdates = {
            REDPANDA_KAFKA_SECURITY_PROTOCOL: deriveKafkaSecurityProtocol(config),
            REDPANDA_KAFKA_SASL_MECHANISM:    deriveKafkaSaslMechanism(config),
            REDPANDA_BROKER_PORT:   kafkaPort,
            REDPANDA_KAFKA_ADDRESS: `127.0.0.1:${kafkaPort}`,
            REDPANDA_ADMIN_PORT:    adminPort,
            REDPANDA_ADMIN_ADDRESS: `127.0.0.1:${adminPort}`,
        };
        const srPort = config.schema_registry?.schema_registry_api?.[0]?.port;
        if (srPort) {
            envUpdates.REDPANDA_SCHEMA_REGISTRY_PORT    = String(srPort);
            envUpdates.REDPANDA_SCHEMA_REGISTRY_ADDRESS = `127.0.0.1:${srPort}`;
        }
        const ppPort = config.pandaproxy?.pandaproxy_api?.[0]?.port;
        if (ppPort) {
            envUpdates.REDPANDA_PANDAPROXY_PORT    = String(ppPort);
            envUpdates.REDPANDA_PANDAPROXY_ADDRESS = `127.0.0.1:${ppPort}`;
        }
        const envContent = Object.entries(envUpdates).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
        await fs.writeFile(envStaging, envContent, { mode: 0o600 });

        const script = path.join(DATA_FORWARDER_DIR, 'update-broker-config.sh');
        const { stdout, stderr } = await execAsync(
            `sudo bash "${script}" "${staging}" "${restart}" "${envStaging}"`
        );
        res.json({ success: true, restartTriggered: restart, output: (stdout + stderr).trim() });
    } catch (error) {
        await cleanupStaging(staging);
        await cleanupStaging(envStaging);
        const details = ((error.stdout || '') + '\n' + (error.stderr || '')).trim();
        console.error('Error setting broker config:', error);
        res.status(500).json({ error: error.message, details });
    }
}

async function restartBroker(req, res) {
    try {
        await execAsync('sudo systemctl restart redpanda');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function getBrokerTopics(req, res) {
    try {
        const { stdout } = await execAsync('rpk topic list --format json 2>/dev/null || echo "[]"');
        let topics = [];
        try { topics = JSON.parse(stdout); } catch { /* malformed output */ }
        const totalPartitions = topics.reduce((s, t) => s + (t.partitions || 0), 0);
        res.json({ topics, totalTopics: topics.length, totalPartitions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// ── Group / Topic helpers ─────────────────────────────────────────────────────

function parseGroupList(stdout) {
    const groups = [];
    for (const line of stdout.trim().split('\n')) {
        if (!line || line.startsWith('BROKER')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) groups.push({ name: parts[1], state: parts[2] });
    }
    return groups;
}

function parseGroupDescribe(name, stdout) {
    const stateMatch   = stdout.match(/^STATE\s+(.+)$/m);
    const membersMatch = stdout.match(/^MEMBERS\s+(\d+)$/m);
    const lagMatch     = stdout.match(/^TOTAL-LAG\s+(\d+)$/m);
    const topics = [];
    let inTable = false;
    for (const line of stdout.split('\n')) {
        if (line.startsWith('TOPIC')) { inTable = true; continue; }
        if (!inTable || !line.trim()) continue;
        const p = line.trim().split(/\s+/);
        if (p.length >= 6) {
            topics.push({
                name: p[0],
                partition: parseInt(p[1]) || 0,
                currentOffset: parseInt(p[2]) || 0,
                logStartOffset: parseInt(p[3]) || 0,
                logEndOffset: parseInt(p[4]) || 0,
                lag: parseInt(p[5]) || 0,
            });
        }
    }
    return {
        name,
        state:   stateMatch   ? stateMatch[1].trim()   : 'Unknown',
        members: membersMatch ? parseInt(membersMatch[1]) : 0,
        lag:     lagMatch     ? parseInt(lagMatch[1])     : 0,
        topics,
    };
}

function parseTopicPartitions(stdout) {
    let retained = 0, highWatermark = 0;
    const partitions = [];
    let inTable = false;
    for (const line of stdout.trim().split('\n')) {
        if (line.startsWith('PARTITION')) { inTable = true; continue; }
        if (!inTable || !line.trim()) continue;
        const p = line.trim().split(/\s+/);
        if (p.length >= 6) {
            const lso = parseInt(p[4]) || 0;
            const hw  = parseInt(p[5]) || 0;
            retained      += hw - lso;
            highWatermark += hw;
            partitions.push({ partition: parseInt(p[0]) || 0, lso, hw });
        }
    }
    return { retained, highWatermark, partitions };
}

async function getLastMessageTime(topic, partition, offset) {
    if (offset < 0) return null;
    try {
        const { stdout } = await execAsync(
            `rpk topic consume "${topic}" --partition ${partition} -n 1 -o ${offset} --format json 2>/dev/null`,
            { timeout: 4000 }
        );
        const line = stdout.trim().split('\n')[0];
        if (!line) return null;
        const msg = JSON.parse(line);
        return typeof msg.timestamp === 'number' ? msg.timestamp : null;
    } catch {
        return null;
    }
}

async function fetchAllGroupDetails() {
    const { stdout: listOut } = await execAsync('rpk group list 2>/dev/null || echo ""');
    const groups = parseGroupList(listOut);
    return Promise.all(groups.map(async g => {
        try {
            const { stdout } = await execAsync(`rpk group describe "${g.name}" 2>/dev/null || echo ""`);
            return parseGroupDescribe(g.name, stdout);
        } catch {
            return { name: g.name, state: g.state, members: 0, lag: 0, topics: [] };
        }
    }));
}

async function getConsumerGroups(req, res) {
    try {
        const groups = await fetchAllGroupDetails();
        const stableGroups = groups.filter(g => g.state === 'Stable').length;
        const totalLag     = groups.reduce((s, g) => s + g.lag, 0);
        res.json({ totalGroups: groups.length, stableGroups, totalLag, groups });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function getTopics(req, res) {
    try {
        const { stdout: listOut } = await execAsync('rpk topic list --format json 2>/dev/null || echo "[]"');
        let topicList = [];
        try { topicList = JSON.parse(listOut); } catch {}

        const groupDetails = await fetchAllGroupDetails();
        const consumerMap = new Map();
        for (const g of groupDetails) {
            for (const t of g.topics) {
                if (!consumerMap.has(t.name)) consumerMap.set(t.name, []);
                const existing = consumerMap.get(t.name).find(c => c.group === g.name);
                if (existing) {
                    existing.lag += t.lag;
                } else {
                    consumerMap.get(t.name).push({ group: g.name, lag: t.lag, members: g.members });
                }
            }
        }

        const topics = await Promise.all(topicList.map(async t => {
            try {
                const { stdout } = await execAsync(`rpk topic describe "${t.name}" -p 2>/dev/null || echo ""`);
                const { retained, highWatermark, partitions } = parseTopicPartitions(stdout);

                // Find the partition with the highest hw that still has retained messages
                const activePart = partitions
                    .filter(p => p.hw > p.lso)
                    .sort((a, b) => b.hw - a.hw)[0];
                const lastMessageAt = activePart
                    ? await getLastMessageTime(t.name, activePart.partition, activePart.hw - 1)
                    : null;

                const consumers = consumerMap.get(t.name) || [];
                return {
                    name: t.name,
                    partitions: t.partitions,
                    replicas: t.replicas,
                    retainedMessages: retained,
                    highWatermark,
                    lastMessageAt,
                    consumers,
                    totalLag: consumers.reduce((s, c) => s + c.lag, 0),
                };
            } catch {
                return { name: t.name, partitions: t.partitions, replicas: t.replicas,
                         retainedMessages: null, highWatermark: null, lastMessageAt: null, consumers: [], totalLag: 0 };
            }
        }));

        res.json({ topics });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// ── Pipelines ─────────────────────────────────────────────────────────────────

async function listPipelines(req, res) {
    try {
        const pipelines = await listActivePipelines();
        res.json({ pipelines });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function getPipeline(req, res) {
    const { name } = req.params;
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid pipeline name.' });
    }
    try {
        const ymlPath = path.join(PIPELINES_DIR, `${name}.yml`);
        const { stdout } = await execAsync(`sudo cat "${ymlPath}" 2>/dev/null || echo ""`);
        if (!stdout.trim()) {
            return res.status(404).json({ error: `Pipeline "${name}" not found.` });
        }
        res.json({ name, content: stdout });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function validatePipeline(req, res) {
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'content string is required' });
    }

    const staging = stagingPath('validate.yml');
    try {
        await fs.writeFile(staging, content, { mode: 0o600 });

        let valid = false;
        let output = '';
        try {
            const result = await execAsync(`redpanda-connect lint "${staging}" 2>&1 || true`);
            output = (result.stdout + result.stderr).trim();
            valid = !output.toLowerCase().includes('error') && !output.includes('lint errors');
        } catch (e) {
            output = ((e.stdout || '') + (e.stderr || '')).trim() || e.message;
            valid = false;
        }

        res.json({ valid, output });
    } finally {
        await cleanupStaging(staging);
    }
}

async function applyPipeline(req, res) {
    const { name, content, outputType, mqttUseIoAdminCreds, mqttCreds, httpEndpoint, httpAuthHeader } = req.body;

    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Pipeline name must be alphanumeric with hyphens/underscores only.' });
    }

    let ymlContent;

    // If raw content is provided, use it directly (YAML mode)
    if (content) {
        ymlContent = content;
    } else {
        // Guided mode — generate from structured fields
        if (!['mqtt', 'http'].includes(outputType)) {
            return res.status(400).json({ error: 'outputType must be "mqtt" or "http".' });
        }
        if (outputType === 'http' && !httpEndpoint) {
            return res.status(400).json({ error: 'httpEndpoint is required for HTTP output.' });
        }

        if (outputType === 'mqtt') {
            const useIoAdmin = mqttUseIoAdminCreds !== false;
            if (!useIoAdmin && mqttCreds) {
                const { host, port, username, password } = mqttCreds;
                if (!host || !port || !username || !password) {
                    return res.status(400).json({ error: 'mqttCreds must include host, port, username, password.' });
                }
                await persistForwarderCreds([
                    { key: 'FORWARDER_MQTT_HOST',     value: host },
                    { key: 'FORWARDER_MQTT_PORT',     value: port },
                    { key: 'FORWARDER_MQTT_USERNAME', value: username },
                    { key: 'FORWARDER_MQTT_PASSWORD', value: password },
                ]);
            }
            ymlContent = generateMqttYml(name, mqttUseIoAdminCreds !== false, mqttCreds);
        } else {
            ymlContent = generateHttpYml(name, httpEndpoint, httpAuthHeader || '');
        }
    }

    const tmpYml = path.join(os.tmpdir(), `${name}-${Date.now()}.yml`);
    try {
        await fs.writeFile(tmpYml, ymlContent, { mode: 0o600 });
        const addConfigScript = path.join(DATA_FORWARDER_DIR, 'add-config.sh');
        const { stdout, stderr } = await execAsync(`sudo bash "${addConfigScript}" "${tmpYml}" "${name}"`);
        res.json({ success: true, pipeline: name, output: (stdout + stderr).trim() });
    } catch (error) {
        const details = ((error.stdout || '') + '\n' + (error.stderr || '')).trim();
        console.error('Error applying pipeline:', error);
        res.status(500).json({ error: error.message, details });
    } finally {
        await cleanupStaging(tmpYml);
    }
}

async function updatePipeline(req, res) {
    const { name } = req.params;
    const { content } = req.body;

    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid pipeline name.' });
    }
    if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'content string is required' });
    }

    const tmpYml = path.join(os.tmpdir(), `${name}-${Date.now()}.yml`);
    try {
        await fs.writeFile(tmpYml, content, { mode: 0o600 });
        const addConfigScript = path.join(DATA_FORWARDER_DIR, 'add-config.sh');
        const { stdout, stderr } = await execAsync(`sudo bash "${addConfigScript}" "${tmpYml}" "${name}"`);
        res.json({ success: true, pipeline: name, output: (stdout + stderr).trim() });
    } catch (error) {
        const details = ((error.stdout || '') + '\n' + (error.stderr || '')).trim();
        console.error('Error updating pipeline:', error);
        res.status(500).json({ error: error.message, details });
    } finally {
        await cleanupStaging(tmpYml);
    }
}

async function removePipeline(req, res) {
    const { name } = req.params;
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid pipeline name.' });
    }

    const serviceName = `redpanda-connect@${name}`;
    const ymlPath = path.join(PIPELINES_DIR, `${name}.yml`);

    try {
        await execAsync(`sudo systemctl stop "${serviceName}" 2>/dev/null || true`);
        await execAsync(`sudo systemctl disable "${serviceName}" 2>/dev/null || true`);
        await execAsync(`sudo rm -f "${ymlPath}"`);
        await execAsync('sudo systemctl daemon-reload');
        res.json({ success: true, pipeline: name });
    } catch (error) {
        console.error('Error removing pipeline:', error);
        res.status(500).json({ error: error.message });
    }
}

async function pipelineAction(req, res) {
    const { name } = req.params;
    const { action } = req.body;

    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid pipeline name.' });
    }
    if (!['start', 'stop', 'restart'].includes(action)) {
        return res.status(400).json({ error: 'action must be start, stop, or restart.' });
    }

    const serviceName = `redpanda-connect@${name}`;
    try {
        await execAsync(`sudo systemctl ${action} "${serviceName}"`);
        const active = await serviceIsActive(serviceName);
        res.json({ success: true, status: active ? 'active' : 'inactive' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function getLogs(req, res) {
    const { pipeline = 'all' } = req.query;
    const lines = Math.min(parseInt(req.query.lines, 10) || 200, 500);

    if (pipeline !== 'all' && !/^[a-zA-Z0-9_-]+$/.test(pipeline)) {
        return res.status(400).json({ error: 'Invalid pipeline name.' });
    }

    try {
        let logs = [];

        if (pipeline === 'all') {
            let files = [];
            try {
                const entries = await fs.readdir(LOG_DIR);
                files = entries.filter(f => f.endsWith('.log'));
            } catch { /* dir may not exist yet */ }

            for (const file of files) {
                const pipelineName = file.replace('.log', '');
                try {
                    const { stdout } = await execAsync(`tail -n ${lines} "${path.join(LOG_DIR, file)}"`);
                    const fileLines = stdout.split('\n').filter(Boolean);
                    logs.push(...fileLines.map(l => `[${pipelineName}] ${l}`));
                } catch { /* skip unreadable files */ }
            }
            logs.sort((a, b) => {
                const tsA = a.match(/time="([^"]+)"/)?.[1] ?? '';
                const tsB = b.match(/time="([^"]+)"/)?.[1] ?? '';
                return tsA.localeCompare(tsB);
            });
        } else {
            const logPath = path.join(LOG_DIR, `${pipeline}.log`);
            try {
                const { stdout } = await execAsync(`tail -n ${lines} "${logPath}"`);
                logs = stdout.split('\n').filter(Boolean);
            } catch (e) {
                if (!e.stderr?.includes('No such file') && e.code !== 'ENOENT') throw e;
            }
        }

        res.json({ logs });
    } catch (error) {
        console.error('Error reading pipeline logs:', error);
        res.status(500).json({ error: error.message });
    }
}

// ── YML generators ────────────────────────────────────────────────────────────

function generateMqttYml(name, useIoAdminCreds, mqttCreds) {
    const host = useIoAdminCreds ? '${MASTER_MQTT_HOST}' : '${FORWARDER_MQTT_HOST}';
    const port = useIoAdminCreds ? '${MASTER_MQTT_PORT}' : '${FORWARDER_MQTT_PORT}';
    const user = useIoAdminCreds ? '${MASTER_MQTT_USERNAME}' : '${FORWARDER_MQTT_USERNAME}';
    const pass = useIoAdminCreds ? '${MASTER_MQTT_PASSWORD}' : '${FORWARDER_MQTT_PASSWORD}';
    const brokerAddr = `localhost:${process.env.REDPANDA_BROKER_PORT || '9092'}`;

    return `# Pipeline: ${name}
# Auto-generated by lsg-app. Edit via the Data Forwarding UI or use YAML mode.
# Output: MQTT  |  Creds: ${useIoAdminCreds ? 'IoAdmin' : 'custom'}
input:
  kafka_franz:
    seed_brokers:
      - "${brokerAddr}"
    topics:
      - '^devicesIn\\..+\\.data$'
    regexp_topics: true
    consumer_group: lsg-forwarder-${name}
    start_offset: latest

pipeline:
  processors:
    - mapping: |
        meta mqtt_topic = meta("kafka_topic").replace_all(".", "/")
    - log:
        level: INFO
        message: 'Publishing → \${! meta("mqtt_topic") } | payload: \${! content().string() }'

output:
  mqtt:
    urls:
      - "tcp://${host}:${port}"
    client_id: "lsg-forwarder-${name}"
    topic: \${! meta("mqtt_topic") }
    user: "${user}"
    password: "${pass}"
    tls:
      enabled: false
    qos: 1
    keepalive: 30
    connect_timeout: 10s
    write_timeout: 30s
`;
}

function generateHttpYml(name, endpoint, authHeader) {
    const brokerAddr = `localhost:${process.env.REDPANDA_BROKER_PORT || '9092'}`;
    const headersBlock = authHeader
        ? `    headers:
      Content-Type: application/json
      Authorization: "${authHeader}"`
        : `    headers:
      Content-Type: application/json`;

    return `# Pipeline: ${name}
# Auto-generated by lsg-app. Edit via the Data Forwarding UI or use YAML mode.
# Output: HTTP
input:
  kafka_franz:
    seed_brokers:
      - "${brokerAddr}"
    topics:
      - '^devicesIn\\..+\\.data$'
    regexp_topics: true
    consumer_group: lsg-forwarder-${name}
    start_offset: latest

pipeline:
  processors:
    - log:
        level: INFO
        message: 'Posting to HTTP: ${endpoint} | payload: \${! content().string() }'

output:
  http_client:
    url: "${endpoint}"
    verb: POST
${headersBlock}
    timeout: 10s
    retries: 3
    retry_period: 5s
`;
}

module.exports = {
    getStatus,
    getBrokerConfig, setBrokerConfig, restartBroker, getBrokerTopics,
    getConsumerGroups, getTopics,
    listPipelines, getPipeline, validatePipeline,
    applyPipeline, updatePipeline, removePipeline, pipelineAction,
    getLogs,
};
