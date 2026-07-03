import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, Save, RotateCcw } from 'lucide-react';
import {
  Panel, PanelHeader, PanelBody, AppInput, AppButton, AppAlert,
  SectionLabel, AppDivider, Spinner,
} from '../../ui/app-ui';
import { useAuth } from '../../../context/AuthContext';
import { getApiEndpoint } from '../../../config/api';

const selectStyle = {
  padding: '8px 12px', borderRadius: 8, fontSize: 13.5,
  background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)',
  color: 'var(--app-text-1)', width: '100%',
};

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--app-accent)', width: 15, height: 15 }} />
      <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>{label}</span>
    </label>
  );
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--app-border)' }}>
      <button
        className="flex items-center justify-between w-full px-4 py-3 text-[13.5px] font-semibold"
        style={{ background: 'var(--app-elevated)', color: 'var(--app-text-1)', border: 'none', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        {title}
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {open && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

function TlsBlock({ value, onChange, prefix }) {
  const s = value || {};
  const set = (k, v) => onChange({ ...s, [k]: v });
  return (
    <div className="space-y-2 pl-3" style={{ borderLeft: '2px solid var(--app-border)' }}>
      <Toggle checked={s.enabled} onChange={v => set('enabled', v)} label="Enable TLS" />
      {s.enabled && (
        <div className="grid grid-cols-2 gap-3">
          <AppInput label="Cert file" placeholder="/etc/redpanda/certs/server.crt" value={s.cert_file || ''} onChange={e => set('cert_file', e.target.value)} />
          <AppInput label="Key file"  placeholder="/etc/redpanda/certs/server.key" value={s.key_file  || ''} onChange={e => set('key_file',  e.target.value)} />
          <Toggle checked={s.require_client_auth} onChange={v => set('require_client_auth', v)} label="Require client certificate (mTLS)" />
        </div>
      )}
    </div>
  );
}

// Build a deep-merged config from defaults + loaded config
function buildDefaultConfig(loaded) {
  const base = {
    redpanda: {
      data_directory: '/var/lib/redpanda/data',
      seed_servers: [],
      kafka_api: [{ address: '0.0.0.0', port: 9092 }],
      advertised_kafka_api: [{ address: '127.0.0.1', port: 9092 }],
      kafka_api_tls: [{ enabled: false }],
      admin: [{ address: '0.0.0.0', port: 9644 }],
      admin_api_tls: [{ enabled: false }],
      rpc_server: { address: '0.0.0.0', port: 33145 },
      advertised_rpc_api: { address: '127.0.0.1', port: 33145 },
      developer_mode: true,
      auto_create_topics_enabled: true,
    },
    rpk: {
      overprovisioned: true,
      coredump_dir: '/var/lib/redpanda/coredump',
    },
    schema_registry: null,
    pandaproxy: {},
  };

  if (!loaded) return base;

  // Deep merge only known top-level keys
  return {
    redpanda: { ...base.redpanda, ...(loaded.redpanda || {}) },
    rpk: { ...base.rpk, ...(loaded.rpk || {}) },
    schema_registry: loaded.schema_registry || null,
    pandaproxy: loaded.pandaproxy || {},
  };
}

export default function BrokerConfigForm() {
  const { getAuthHeaders } = useAuth();
  const [config, setConfig]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [restart, setRestart] = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(null);
  const [srEnabled, setSrEnabled] = useState(false);
  const [ppEnabled, setPpEnabled] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(getApiEndpoint('REDPANDA.BROKER_CONFIG'), { headers: getAuthHeaders() });
      const data = await res.json();
      const cfg  = buildDefaultConfig(data.config);
      setConfig(cfg);
      setSrEnabled(!!(data.config?.schema_registry));
      setPpEnabled(!!(data.config?.pandaproxy?.pandaproxy_api));
    } catch (e) {
      setError('Failed to load broker config: ' + e.message);
      setConfig(buildDefaultConfig(null));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const setRp  = (key, val) => setConfig(c => ({ ...c, redpanda: { ...c.redpanda, [key]: val } }));
  const setRpk = (key, val) => setConfig(c => ({ ...c, rpk: { ...c.rpk, [key]: val } }));

  const setKafkaApi       = (i, key, val) => {
    const arr = [...(config.redpanda.kafka_api || [{}])];
    arr[i] = { ...arr[i], [key]: val };
    setRp('kafka_api', arr);
  };
  const setAdvKafkaApi    = (i, key, val) => {
    const arr = [...(config.redpanda.advertised_kafka_api || [{}])];
    arr[i] = { ...arr[i], [key]: val };
    setRp('advertised_kafka_api', arr);
  };
  const setKafkaTls       = (val) => setRp('kafka_api_tls', [val]);
  const setAdminApi       = (i, key, val) => {
    const arr = [...(config.redpanda.admin || [{}])];
    arr[i] = { ...arr[i], [key]: val };
    setRp('admin', arr);
  };
  const setAdminTls       = (val) => setRp('admin_api_tls', [val]);

  const save = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);

    const payload = { ...config };
    if (!srEnabled) {
      delete payload.schema_registry;
    } else {
      payload.schema_registry = {
        schema_registry_api:            [{ address: sr.address      || '0.0.0.0',   port: sr.port      || 8081 }],
        advertised_schema_registry_api: [{ address: advSr.address   || '127.0.0.1', port: advSr.port   || 8081 }],
      };
    }
    if (!ppEnabled) {
      payload.pandaproxy = {};
    } else {
      payload.pandaproxy = {
        pandaproxy_api:            [{ address: pp.address    || '0.0.0.0',   port: pp.port    || 8082 }],
        advertised_pandaproxy_api: [{ address: advPp.address || '127.0.0.1', port: advPp.port || 8082 }],
      };
    }

    try {
      const res  = await fetch(getApiEndpoint('REDPANDA.BROKER_CONFIG'), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payload, restart }),
      });
      const data = await res.json();
      if (res.ok) setSuccess(data.output || 'Broker config saved.');
      else setError(data.error || 'Failed to save.');
    } catch (e) {
      setError('Network error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-8 flex justify-center"><Spinner size={24} /></div>;

  const rp  = config.redpanda;
  const rpk = config.rpk;
  const ka  = rp.kafka_api?.[0]          || {};
  const aka = rp.advertised_kafka_api?.[0] || {};
  const kaTls  = rp.kafka_api_tls?.[0]   || {};
  const adm  = rp.admin?.[0]             || {};
  const admTls = rp.admin_api_tls?.[0]   || {};
  const sr    = config.schema_registry?.schema_registry_api?.[0]            || {};
  const advSr = config.schema_registry?.advertised_schema_registry_api?.[0] || {};
  const pp    = config.pandaproxy?.pandaproxy_api?.[0]                      || {};
  const advPp = config.pandaproxy?.advertised_pandaproxy_api?.[0]           || {};

  return (
    <div className="space-y-3">
      {error   && <AppAlert severity="error">{error}</AppAlert>}
      {success && <AppAlert severity="success"><pre className="text-[11px] whitespace-pre-wrap">{success}</pre></AppAlert>}

      {/* Kafka API */}
      <Section title="Kafka API">
        <div className="grid grid-cols-2 gap-3">
          <AppInput label="Bind address" placeholder="0.0.0.0" value={ka.address || ''} onChange={e => setKafkaApi(0, 'address', e.target.value)} />
          <AppInput label="Port" type="number" value={ka.port || 9092} onChange={e => setKafkaApi(0, 'port', parseInt(e.target.value))} />
          <AppInput label="Advertised address (used by clients)" placeholder="127.0.0.1" value={aka.address || ''} onChange={e => setAdvKafkaApi(0, 'address', e.target.value)} />
          <AppInput label="Advertised port" type="number" value={aka.port || 9092} onChange={e => setAdvKafkaApi(0, 'port', parseInt(e.target.value))} />
          <div className="col-span-2">
            <SectionLabel>Authentication method</SectionLabel>
            <select style={selectStyle} value={ka.authentication_method || 'none'}
              onChange={e => setKafkaApi(0, 'authentication_method', e.target.value)}>
              <option value="none">None (PLAINTEXT)</option>
              <option value="sasl">SASL</option>
              <option value="mtls_identity">mTLS identity</option>
            </select>
          </div>
        </div>
        <div>
          <SectionLabel>TLS</SectionLabel>
          <TlsBlock value={kaTls} onChange={setKafkaTls} />
        </div>
        <p className="text-[12px]" style={{ color: 'var(--app-text-3)' }}>
          Changing the port or address requires a broker restart to take effect.
        </p>
      </Section>

      {/* Admin API */}
      <Section title="Admin API" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-3">
          <AppInput label="Bind address" placeholder="0.0.0.0" value={adm.address || ''} onChange={e => setAdminApi(0, 'address', e.target.value)} />
          <AppInput label="Port" type="number" value={adm.port || 9644} onChange={e => setAdminApi(0, 'port', parseInt(e.target.value))} />
        </div>
        <Toggle checked={rp.admin_api_require_auth} onChange={v => setRp('admin_api_require_auth', v)} label="Require HTTP basic auth for Admin API" />
        <div>
          <SectionLabel>TLS</SectionLabel>
          <TlsBlock value={admTls} onChange={setAdminTls} />
        </div>
      </Section>

      {/* Storage */}
      <Section title="Storage & Retention" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-3">
          <AppInput label="Data directory" value={rp.data_directory || ''} onChange={e => setRp('data_directory', e.target.value)} />
          <AppInput label="Log retention (ms) — −1 = unlimited" type="number" placeholder="604800000 (7 days)"
            value={rp.log_retention_ms ?? ''} onChange={e => setRp('log_retention_ms', e.target.value === '' ? undefined : parseInt(e.target.value))} />
          <AppInput label="Log retention bytes — −1 = unlimited" type="number" placeholder="-1"
            value={rp.log_retention_bytes ?? ''} onChange={e => setRp('log_retention_bytes', e.target.value === '' ? undefined : parseInt(e.target.value))} />
          <AppInput label="Log segment size (bytes)" type="number" placeholder="1073741824 (1 GiB)"
            value={rp.log_segment_size ?? ''} onChange={e => setRp('log_segment_size', e.target.value === '' ? undefined : parseInt(e.target.value))} />
        </div>
      </Section>

      {/* Cluster Behaviour */}
      <Section title="Cluster Behaviour" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-3">
          <AppInput label="Default topic partitions" type="number" value={rp.default_topic_partitions ?? 1}
            onChange={e => setRp('default_topic_partitions', parseInt(e.target.value))} />
          <AppInput label="Default replication factor" type="number" value={rp.default_topic_replication ?? 1}
            onChange={e => setRp('default_topic_replication', parseInt(e.target.value))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Toggle checked={rp.auto_create_topics_enabled} onChange={v => setRp('auto_create_topics_enabled', v)} label="Auto-create topics" />
          <Toggle checked={rp.developer_mode}              onChange={v => setRp('developer_mode', v)}             label="Developer mode (skips tuning checks)" />
          <Toggle checked={rp.enable_sasl}                 onChange={v => setRp('enable_sasl', v)}                label="Enable SASL authentication" />
          {rp.enable_sasl && (
            <Toggle
              checked={(rp.sasl_mechanisms || []).includes('SCRAM')}
              onChange={v => setRp('sasl_mechanisms', v ? ['SCRAM'] : [])}
              label="SASL mechanism: SCRAM (SHA-256 / SHA-512)"
            />
          )}
          <Toggle checked={rp.enable_idempotence !== false} onChange={v => setRp('enable_idempotence', v)}        label="Enable idempotence" />
          <Toggle checked={rp.enable_transactions !== false} onChange={v => setRp('enable_transactions', v)}      label="Enable transactions" />
          <Toggle checked={rp.admin_api_require_auth}       onChange={v => setRp('admin_api_require_auth', v)}   label="Admin API requires auth" />
        </div>
      </Section>

      {/* RPK */}
      <Section title="RPK Tuning" defaultOpen={false}>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 pt-1">
            <Toggle checked={rpk.overprovisioned} onChange={v => setRpk('overprovisioned', v)} label="Overprovisioned (dedicated server)" />
          </div>
          <AppInput label="Coredump directory" value={rpk.coredump_dir || ''} onChange={e => setRpk('coredump_dir', e.target.value)} />
        </div>
      </Section>

      {/* Schema Registry */}
      <Section title="Schema Registry" defaultOpen={false}>
        <Toggle checked={srEnabled} onChange={setSrEnabled} label="Enable Schema Registry" />
        {srEnabled && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <AppInput label="Bind address" placeholder="0.0.0.0" value={sr.address || '0.0.0.0'}
              onChange={e => setConfig(c => ({ ...c, schema_registry: { ...c.schema_registry, schema_registry_api: [{ ...sr, address: e.target.value }] } }))} />
            <AppInput label="Port" type="number" value={sr.port || 8081}
              onChange={e => setConfig(c => ({ ...c, schema_registry: { ...c.schema_registry, schema_registry_api: [{ ...sr, port: parseInt(e.target.value) }] } }))} />
            <AppInput label="Advertised address" placeholder="127.0.0.1" value={advSr.address || '127.0.0.1'}
              onChange={e => setConfig(c => ({ ...c, schema_registry: { ...c.schema_registry, advertised_schema_registry_api: [{ ...advSr, address: e.target.value }] } }))} />
            <AppInput label="Advertised port" type="number" value={advSr.port || 8081}
              onChange={e => setConfig(c => ({ ...c, schema_registry: { ...c.schema_registry, advertised_schema_registry_api: [{ ...advSr, port: parseInt(e.target.value) }] } }))} />
          </div>
        )}
      </Section>

      {/* Pandaproxy */}
      <Section title="Pandaproxy (HTTP API)" defaultOpen={false}>
        <Toggle checked={ppEnabled} onChange={setPpEnabled} label="Enable Pandaproxy" />
        {ppEnabled && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <AppInput label="Bind address" placeholder="0.0.0.0" value={pp.address || '0.0.0.0'}
              onChange={e => setConfig(c => ({ ...c, pandaproxy: { ...c.pandaproxy, pandaproxy_api: [{ ...pp, address: e.target.value }] } }))} />
            <AppInput label="Port" type="number" value={pp.port || 8082}
              onChange={e => setConfig(c => ({ ...c, pandaproxy: { ...c.pandaproxy, pandaproxy_api: [{ ...pp, port: parseInt(e.target.value) }] } }))} />
            <AppInput label="Advertised address" placeholder="127.0.0.1" value={advPp.address || '127.0.0.1'}
              onChange={e => setConfig(c => ({ ...c, pandaproxy: { ...c.pandaproxy, advertised_pandaproxy_api: [{ ...advPp, address: e.target.value }] } }))} />
            <AppInput label="Advertised port" type="number" value={advPp.port || 8082}
              onChange={e => setConfig(c => ({ ...c, pandaproxy: { ...c.pandaproxy, advertised_pandaproxy_api: [{ ...advPp, port: parseInt(e.target.value) }] } }))} />
          </div>
        )}
        <p className="text-[12px] mt-2" style={{ color: 'var(--app-text-3)' }}>
          Pandaproxy exposes a REST API for producing and consuming Kafka messages over HTTP.
        </p>
      </Section>

      <AppDivider />

      {/* Save */}
      <div className="flex items-center gap-4">
        <AppButton onClick={save} disabled={saving}>
          {saving ? <><Spinner size={13} /> Saving…</> : <><Save size={14} /> Save Broker Config</>}
        </AppButton>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={restart} onChange={e => setRestart(e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
          <span className="text-[13px]" style={{ color: 'var(--app-text-2)' }}>Restart broker after saving</span>
        </label>
        <AppButton variant="ghost" onClick={fetchConfig} disabled={loading}>
          <RotateCcw size={13} /> Reload
        </AppButton>
      </div>
    </div>
  );
}
