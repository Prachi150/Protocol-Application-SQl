import React from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { AppInput, AppButton, IconBtn, SectionLabel, AppDivider } from '../../../ui/app-ui';

export const defaultKafka = {
  brokers: ['localhost:9092'],
  topic: '',
  key: '',
  compression: 'none',
  maxInFlight: '10',
  timeout: '10s',
  idempotentWrite: true,
  allowAutoCreate: true,
  partitioner: 'murmur2_hash',
  batchCount: '0', batchByteSize: '0', batchPeriod: '',
  tlsEnabled: false,
  saslEnabled: false, saslMechanism: 'SCRAM-SHA-256', saslUsername: '', saslPassword: '',
};

const selectStyle = {
  padding: '8px 12px', borderRadius: 8, fontSize: 13.5,
  background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)',
  color: 'var(--app-text-1)', width: '100%',
};

export default function KafkaOutput({ value, onChange }) {
  const [batchOpen, setBatchOpen]   = React.useState(false);
  const [tlsOpen, setTlsOpen]       = React.useState(false);
  const [saslOpen, setSaslOpen]     = React.useState(false);
  const s = value;
  const set = (key, val) => onChange({ ...s, [key]: val });

  const setBroker = (i, v) => { const next = [...s.brokers]; next[i] = v; set('brokers', next); };
  const addBroker    = () => set('brokers', [...s.brokers, '']);
  const removeBroker = (i) => set('brokers', s.brokers.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {/* Brokers */}
      <div>
        <SectionLabel>Seed Brokers</SectionLabel>
        <div className="space-y-2">
          {s.brokers.map((b, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1"><AppInput placeholder="localhost:9092" value={b} onChange={e => setBroker(i, e.target.value)} /></div>
              {s.brokers.length > 1 && (
                <IconBtn variant="danger" title="Remove" onClick={() => removeBroker(i)}><Trash2 size={13} /></IconBtn>
              )}
            </div>
          ))}
        </div>
        <AppButton variant="ghost" className="mt-2 text-[12.5px] px-0" onClick={addBroker}>
          <Plus size={13} /> Add broker
        </AppButton>
      </div>

      <AppDivider />

      <div className="grid grid-cols-2 gap-3">
        <AppInput label="Topic" placeholder="my-topic or ${! meta('kafka_topic') }" value={s.topic} onChange={e => set('topic', e.target.value)} />
        <AppInput label="Key (optional)" placeholder="Bloblang expression or literal" value={s.key} onChange={e => set('key', e.target.value)} />
        <div>
          <label className="text-[13px] font-medium block mb-1" style={{ color: 'var(--app-text-1)' }}>Compression</label>
          <select value={s.compression} onChange={e => set('compression', e.target.value)} style={selectStyle}>
            {['none', 'lz4', 'snappy', 'gzip', 'zstd'].map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[13px] font-medium block mb-1" style={{ color: 'var(--app-text-1)' }}>Partitioner</label>
          <select value={s.partitioner} onChange={e => set('partitioner', e.target.value)} style={selectStyle}>
            {['murmur2_hash', 'round_robin', 'least_backup', 'manual'].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <AppInput label="Max in-flight" type="number" value={s.maxInFlight} onChange={e => set('maxInFlight', e.target.value)} />
        <AppInput label="Timeout" placeholder="10s" value={s.timeout} onChange={e => set('timeout', e.target.value)} />
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" checked={s.idempotentWrite} onChange={e => set('idempotentWrite', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
          <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Idempotent write</span>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" checked={s.allowAutoCreate} onChange={e => set('allowAutoCreate', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
          <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Auto-create topics</span>
        </div>
      </div>

      {/* Batching */}
      <button className="flex items-center gap-1.5 text-[12.5px]"
        style={{ color: 'var(--app-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => setBatchOpen(o => !o)}>
        {batchOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Batching
      </button>
      {batchOpen && (
        <div className="grid grid-cols-3 gap-3 pl-3" style={{ borderLeft: '2px solid var(--app-border)' }}>
          <AppInput label="Count" type="number" placeholder="0 (off)" value={s.batchCount} onChange={e => set('batchCount', e.target.value)} />
          <AppInput label="Byte size" type="number" placeholder="0 (off)" value={s.batchByteSize} onChange={e => set('batchByteSize', e.target.value)} />
          <AppInput label="Period" placeholder="5s" value={s.batchPeriod} onChange={e => set('batchPeriod', e.target.value)} />
        </div>
      )}

      {/* TLS */}
      <button className="flex items-center gap-1.5 text-[12.5px]"
        style={{ color: 'var(--app-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => setTlsOpen(o => !o)}>
        {tlsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} TLS
      </button>
      {tlsOpen && (
        <div className="pl-3" style={{ borderLeft: '2px solid var(--app-border)' }}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={s.tlsEnabled} onChange={e => set('tlsEnabled', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
            <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable TLS</span>
          </label>
        </div>
      )}

      {/* SASL */}
      <button className="flex items-center gap-1.5 text-[12.5px]"
        style={{ color: 'var(--app-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => setSaslOpen(o => !o)}>
        {saslOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} SASL authentication
      </button>
      {saslOpen && (
        <div className="space-y-3 pl-3" style={{ borderLeft: '2px solid var(--app-border)' }}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={s.saslEnabled} onChange={e => set('saslEnabled', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
            <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable SASL</span>
          </label>
          {s.saslEnabled && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[13px] font-medium block mb-1" style={{ color: 'var(--app-text-1)' }}>Mechanism</label>
                <select value={s.saslMechanism} onChange={e => set('saslMechanism', e.target.value)} style={selectStyle}>
                  <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                  <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
                  <option value="PLAIN">PLAIN</option>
                </select>
              </div>
              <AppInput label="Username" value={s.saslUsername} onChange={e => set('saslUsername', e.target.value)} />
              <AppInput label="Password" type="password" value={s.saslPassword} onChange={e => set('saslPassword', e.target.value)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
