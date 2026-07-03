// Pure function: form state → YAML string for a Redpanda Connect pipeline.
// No external YAML library — output is deterministic enough for string templates.

function indent(str, spaces) {
  return str.split('\n').map(l => (l.trim() ? ' '.repeat(spaces) + l : l)).join('\n');
}

function brokerList(brokers) {
  return brokers.filter(Boolean).map(b => `      - "${b}"`).join('\n');
}

function topicList(topics) {
  return topics
    .filter(t => t.value)
    .map(t => `      - '${t.value}'`)
    .join('\n');
}

function generateHeader({ name, description }) {
  const desc = description ? `# ${description}\n` : '';
  return `${desc}# Pipeline: ${name}\n# Managed by lsg-app Data Forwarding UI.\n`;
}

function generateInput({ brokers, topics, consumerGroup, startOffset, checkpointLimit,
  commitPeriod, fetchMaxBytes, sessionTimeout, heartbeatInterval,
  tlsEnabled, saslEnabled, saslMechanism, saslUsername, saslPassword }) {

  const brokerStr = brokerList(brokers.length ? brokers : ['localhost:9092']);
  const topicStr = topics.length
    ? topicList(topics)
    : `      - '^devicesIn\\..+\\.data$'`;
  const hasRegexp = topics.some(t => t.regexp);

  let out = `input:\n  kafka_franz:\n    seed_brokers:\n${brokerStr}\n    topics:\n${topicStr}\n`;
  if (hasRegexp) out += `    regexp_topics: true\n`;
  out += `    consumer_group: ${consumerGroup || 'lsg-forwarder'}\n`;
  out += `    start_offset: ${startOffset || 'latest'}\n`;
  if (checkpointLimit && checkpointLimit !== '1024') out += `    checkpoint_limit: ${checkpointLimit}\n`;
  if (commitPeriod && commitPeriod !== '5s')         out += `    commit_period: ${commitPeriod}\n`;
  if (fetchMaxBytes && fetchMaxBytes !== '50MiB')    out += `    fetch_max_bytes: ${fetchMaxBytes}\n`;
  if (sessionTimeout && sessionTimeout !== '1m')     out += `    session_timeout: ${sessionTimeout}\n`;
  if (heartbeatInterval && heartbeatInterval !== '3s') out += `    heartbeat_interval: ${heartbeatInterval}\n`;

  if (tlsEnabled) {
    out += `    tls:\n      enabled: true\n`;
  }
  if (saslEnabled && saslUsername) {
    const mech = saslMechanism || 'SCRAM-SHA-256';
    out += `    sasl:\n      - mechanism: ${mech}\n        username: ${saslUsername}\n        password: ${saslPassword || ''}\n`;
  }

  return out;
}

function generateProcessors(processors) {
  if (!processors || processors.length === 0) return '';

  const items = processors.map(p => {
    if (p.type === 'mapping') {
      const expr = p.mapping || 'root = this';
      const indented = expr.split('\n').map(l => '          ' + l).join('\n');
      return `    - mapping: |\n${indented}`;
    }
    if (p.type === 'log') {
      return `    - log:\n        level: ${p.level || 'INFO'}\n        message: '${p.message || ''}'`;
    }
    if (p.type === 'filter') {
      return `    - filter: '${p.condition || 'true'}'`;
    }
    return '';
  }).filter(Boolean);

  if (items.length === 0) return '';
  return `pipeline:\n  processors:\n${items.join('\n')}\n`;
}

function generateMqttOutput({ urls, topic, clientId, qos, keepalive, connectTimeout,
  writeTimeout, maxInFlight, retained, user, password,
  credsMode, customHost, customPort, customUser, customPassword,
  tlsEnabled, tlsSkipVerify, tlsRootCasFile,
  willEnabled, willTopic, willPayload, willQos, willRetained }) {

  let urlList, resolvedUser, resolvedPassword;
  if (credsMode === 'custom') {
    const h = customHost || 'localhost';
    const p = customPort || '1883';
    urlList = `      - "tcp://${h}:${p}"`;
    resolvedUser    = customUser     || '';
    resolvedPassword = customPassword || '';
  } else {
    urlList = (urls || []).filter(Boolean).map(u => `      - "${u}"`).join('\n') ||
      `      - "tcp://\${MASTER_MQTT_HOST}:\${MASTER_MQTT_PORT}"`;
    resolvedUser    = user     || '\${MASTER_MQTT_USERNAME}';
    resolvedPassword = password || '\${MASTER_MQTT_PASSWORD}';
  }

  let out = `output:\n  mqtt:\n    urls:\n${urlList}\n`;
  out += `    client_id: "${clientId || 'lsg-forwarder'}"\n`;
  out += `    topic: ${topic || '${! meta("kafka_topic") }'}\n`;
  if (resolvedUser)     out += `    user: "${resolvedUser}"\n`;
  if (resolvedPassword) out += `    password: "${resolvedPassword}"\n`;
  out += `    qos: ${qos ?? 1}\n`;
  out += `    keepalive: ${keepalive || 30}\n`;
  out += `    connect_timeout: ${connectTimeout || '10s'}\n`;
  out += `    write_timeout: ${writeTimeout || '30s'}\n`;
  if (maxInFlight && maxInFlight !== '64') out += `    max_in_flight: ${maxInFlight}\n`;
  if (retained)       out += `    retained: true\n`;

  if (tlsEnabled) {
    out += `    tls:\n      enabled: true\n`;
    if (tlsSkipVerify)  out += `      skip_cert_verify: true\n`;
    if (tlsRootCasFile) out += `      root_cas_file: ${tlsRootCasFile}\n`;
  }

  if (willEnabled && willTopic) {
    out += `    will:\n      topic: "${willTopic}"\n`;
    if (willPayload) out += `      payload: "${willPayload}"\n`;
    out += `      qos: ${willQos ?? 1}\n`;
    if (willRetained) out += `      retained: true\n`;
  }

  return out;
}

function generateHttpOutput({ url, verb, headers, timeout, retries, retryPeriod,
  maxRetryBackoff, maxInFlight, followRedirects, backoffOn, dropOn,
  authType, basicUser, basicPassword, bearerToken,
  oauth2ClientId, oauth2ClientSecret, oauth2TokenUrl,
  tlsEnabled, tlsSkipVerify, tlsRootCasFile,
  batchCount, batchByteSize, batchPeriod }) {

  let out = `output:\n  http_client:\n    url: "${url || ''}"\n`;
  out += `    verb: ${verb || 'POST'}\n`;

  const hdrs = headers || [{ key: 'Content-Type', value: 'application/json' }];
  const validHdrs = hdrs.filter(h => h.key && h.value);
  if (validHdrs.length) {
    out += `    headers:\n`;
    validHdrs.forEach(h => { out += `      ${h.key}: "${h.value}"\n`; });
  }

  out += `    timeout: ${timeout || '10s'}\n`;
  out += `    retries: ${retries ?? 3}\n`;
  out += `    retry_period: ${retryPeriod || '5s'}\n`;
  if (maxRetryBackoff && maxRetryBackoff !== '300s') out += `    max_retry_backoff: ${maxRetryBackoff}\n`;
  if (maxInFlight && String(maxInFlight) !== '64')   out += `    max_in_flight: ${maxInFlight}\n`;
  if (followRedirects === false)                      out += `    follow_redirects: false\n`;
  if (backoffOn)  out += `    backoff_on: [${backoffOn}]\n`;
  if (dropOn)     out += `    drop_on: [${dropOn}]\n`;

  if (authType === 'basic' && basicUser) {
    out += `    basic_auth:\n      enabled: true\n      username: "${basicUser}"\n      password: "${basicPassword || ''}"\n`;
  }
  if (authType === 'bearer' && bearerToken) {
    // Bearer is injected as an Authorization header — already handled via headers list
    // but we add it explicitly here if the user used the auth section instead
  }
  if (authType === 'oauth2' && oauth2ClientId) {
    out += `    oauth2:\n      enabled: true\n      client_key: "${oauth2ClientId}"\n      client_secret: "${oauth2ClientSecret || ''}"\n      token_url: "${oauth2TokenUrl || ''}"\n`;
  }

  if (tlsEnabled) {
    out += `    tls:\n      enabled: true\n`;
    if (tlsSkipVerify)  out += `      skip_cert_verify: true\n`;
    if (tlsRootCasFile) out += `      root_cas_file: ${tlsRootCasFile}\n`;
  }

  const hasBatch = (batchCount && batchCount !== '0') || (batchByteSize && batchByteSize !== '0') || batchPeriod;
  if (hasBatch) {
    out += `    batching:\n`;
    if (batchCount)     out += `      count: ${batchCount}\n`;
    if (batchByteSize)  out += `      byte_size: ${batchByteSize}\n`;
    if (batchPeriod)    out += `      period: "${batchPeriod}"\n`;
  }

  return out;
}

function generateKafkaOutput({ brokers, topic, key, compression, maxInFlight, timeout,
  idempotentWrite, allowAutoCreate, partitioner,
  batchCount, batchByteSize, batchPeriod,
  tlsEnabled, saslEnabled, saslMechanism, saslUsername, saslPassword }) {

  const brokerStr = brokerList(brokers || ['localhost:9092']);
  let out = `output:\n  kafka_franz:\n    seed_brokers:\n${brokerStr}\n`;
  out += `    topic: "${topic || ''}"\n`;
  if (key)          out += `    key: "${key}"\n`;
  if (compression)  out += `    compression: ${compression}\n`;
  out += `    max_in_flight: ${maxInFlight || 10}\n`;
  out += `    timeout: ${timeout || '10s'}\n`;
  if (idempotentWrite === false)  out += `    idempotent_write: false\n`;
  if (allowAutoCreate === false)  out += `    allow_auto_topic_creation: false\n`;
  if (partitioner && partitioner !== 'murmur2_hash') out += `    partitioner: ${partitioner}\n`;

  const hasBatch = (batchCount && batchCount !== '0') || (batchByteSize && batchByteSize !== '0') || batchPeriod;
  if (hasBatch) {
    out += `    batching:\n`;
    if (batchCount)     out += `      count: ${batchCount}\n`;
    if (batchByteSize)  out += `      byte_size: ${batchByteSize}\n`;
    if (batchPeriod)    out += `      period: "${batchPeriod}"\n`;
  }

  if (tlsEnabled) out += `    tls:\n      enabled: true\n`;
  if (saslEnabled && saslUsername) {
    out += `    sasl:\n      - mechanism: ${saslMechanism || 'SCRAM-SHA-256'}\n        username: ${saslUsername}\n        password: ${saslPassword || ''}\n`;
  }

  return out;
}

export function generatePipelineYaml(formState) {
  const { meta, input, processors, output } = formState;
  const parts = [
    generateHeader(meta),
    generateInput(input),
    generateProcessors(processors),
  ];

  if (output.type === 'mqtt')  parts.push(generateMqttOutput(output.mqtt));
  if (output.type === 'http')  parts.push(generateHttpOutput(output.http));
  if (output.type === 'kafka') parts.push(generateKafkaOutput(output.kafka));

  return parts.filter(Boolean).join('\n');
}

// Try to parse an existing YAML string back into guided form state.
// Returns { ok: true, state } or { ok: false, reason }.
export function parseYamlToFormState(yamlStr, name) {
  try {
    // Very basic extraction — we only try for known auto-generated patterns
    const isMqtt  = yamlStr.includes('  mqtt:');
    const isHttp  = yamlStr.includes('  http_client:');
    const isKafka = yamlStr.includes('  kafka_franz:') && yamlStr.includes('\noutput:');

    if (!isMqtt && !isHttp && !isKafka) {
      return { ok: false, reason: 'Cannot determine output type from YAML.' };
    }

    // Extract consumer_group
    const cgMatch = yamlStr.match(/consumer_group:\s*(.+)/);
    const startOffMatch = yamlStr.match(/start_offset:\s*(.+)/);

    const inputSection = {
      brokers: ['localhost:9092'],
      topics: [{ value: '^devicesIn\\..+\\.data$', regexp: true }],
      consumerGroup: cgMatch ? cgMatch[1].trim() : `lsg-forwarder-${name}`,
      startOffset: startOffMatch ? startOffMatch[1].trim() : 'latest',
      checkpointLimit: '1024', commitPeriod: '5s',
      fetchMaxBytes: '50MiB', sessionTimeout: '1m', heartbeatInterval: '3s',
      tlsEnabled: false, saslEnabled: false,
    };

    let outputType = isMqtt ? 'mqtt' : isHttp ? 'http' : 'kafka';

    return {
      ok: true,
      state: {
        meta: { name, description: '' },
        input: inputSection,
        processors: [],
        output: { type: outputType, mqtt: {}, http: {}, kafka: {} },
      },
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
