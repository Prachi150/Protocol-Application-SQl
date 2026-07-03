import React from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { AppInput, AppButton, IconBtn, SectionLabel, AppDivider } from '../../ui/app-ui';

const DEFAULT_INPUT = {
  brokers: ['localhost:9092'],
  topics: [{ value: '^devicesIn\\..+\\.data$', regexp: true }],
  consumerGroup: '',
  startOffset: 'latest',
  checkpointLimit: '1024',
  commitPeriod: '5s',
  fetchMaxBytes: '50MiB',
  sessionTimeout: '1m',
  heartbeatInterval: '3s',
  tlsEnabled: false,
  saslEnabled: false,
  saslMechanism: 'SCRAM-SHA-256',
  saslUsername: '',
  saslPassword: '',
};

export const defaultInput = DEFAULT_INPUT;

export default function InputSection({ value, onChange }) {
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const s = value;

  const set = (key, val) => onChange({ ...s, [key]: val });

  const setBroker = (i, v) => {
    const next = [...s.brokers];
    next[i] = v;
    set('brokers', next);
  };
  const addBroker    = () => set('brokers', [...s.brokers, '']);
  const removeBroker = (i) => set('brokers', s.brokers.filter((_, idx) => idx !== i));

  const setTopic = (i, key, v) => {
    const next = s.topics.map((t, idx) => idx === i ? { ...t, [key]: v } : t);
    set('topics', next);
  };
  const addTopic    = () => set('topics', [...s.topics, { value: '', regexp: false }]);
  const removeTopic = (i) => set('topics', s.topics.filter((_, idx) => idx !== i));

  const selectStyle = {
    padding: '8px 12px', borderRadius: 8, fontSize: 13.5,
    background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)',
    color: 'var(--app-text-1)', width: '100%',
  };

  return (
    <div className="space-y-4">
      {/* Seed Brokers */}
      <div>
        <SectionLabel>Seed Brokers</SectionLabel>
        <div className="space-y-2">
          {s.brokers.map((b, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1">
                <AppInput
                  placeholder="localhost:9092"
                  value={b}
                  onChange={e => setBroker(i, e.target.value)}
                />
              </div>
              {s.brokers.length > 1 && (
                <IconBtn variant="danger" title="Remove" onClick={() => removeBroker(i)}>
                  <Trash2 size={13} />
                </IconBtn>
              )}
            </div>
          ))}
        </div>
        <AppButton variant="ghost" className="mt-2 text-[12.5px] px-0" onClick={addBroker}>
          <Plus size={13} /> Add broker
        </AppButton>
      </div>

      <AppDivider />

      {/* Topics */}
      <div>
        <SectionLabel>Topics</SectionLabel>
        <div className="space-y-2">
          {s.topics.map((t, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1">
                <AppInput
                  placeholder="^devicesIn\\..*\\.data$  or  my-topic"
                  value={t.value}
                  onChange={e => setTopic(i, 'value', e.target.value)}
                />
              </div>
              <label className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap" style={{ color: 'var(--app-text-2)' }}>
                <input
                  type="checkbox"
                  checked={t.regexp}
                  onChange={e => setTopic(i, 'regexp', e.target.checked)}
                  style={{ accentColor: 'var(--app-accent)' }}
                />
                Regexp
              </label>
              {s.topics.length > 1 && (
                <IconBtn variant="danger" title="Remove" onClick={() => removeTopic(i)}>
                  <Trash2 size={13} />
                </IconBtn>
              )}
            </div>
          ))}
        </div>
        <AppButton variant="ghost" className="mt-2 text-[12.5px] px-0" onClick={addTopic}>
          <Plus size={13} /> Add topic
        </AppButton>
      </div>

      <AppDivider />

      {/* Core fields */}
      <div className="grid grid-cols-2 gap-3">
        <AppInput
          label="Consumer group"
          placeholder="lsg-forwarder-<name>"
          value={s.consumerGroup}
          onChange={e => set('consumerGroup', e.target.value)}
        />
        <div>
          <label className="text-[13px] font-medium block mb-1" style={{ color: 'var(--app-text-1)' }}>
            Start offset
          </label>
          <select value={s.startOffset} onChange={e => set('startOffset', e.target.value)} style={selectStyle}>
            <option value="latest">latest</option>
            <option value="earliest">earliest</option>
            <option value="committed">committed</option>
          </select>
        </div>
      </div>

      {/* Advanced */}
      <button
        className="flex items-center gap-1.5 text-[12.5px]"
        style={{ color: 'var(--app-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => setAdvancedOpen(o => !o)}
      >
        {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Advanced settings
      </button>

      {advancedOpen && (
        <div className="space-y-3 pl-3" style={{ borderLeft: '2px solid var(--app-border)' }}>
          <div className="grid grid-cols-2 gap-3">
            <AppInput label="Checkpoint limit" value={s.checkpointLimit} onChange={e => set('checkpointLimit', e.target.value)} />
            <AppInput label="Commit period" placeholder="5s" value={s.commitPeriod} onChange={e => set('commitPeriod', e.target.value)} />
            <AppInput label="Fetch max bytes" placeholder="50MiB" value={s.fetchMaxBytes} onChange={e => set('fetchMaxBytes', e.target.value)} />
            <AppInput label="Session timeout" placeholder="1m" value={s.sessionTimeout} onChange={e => set('sessionTimeout', e.target.value)} />
            <AppInput label="Heartbeat interval" placeholder="3s" value={s.heartbeatInterval} onChange={e => set('heartbeatInterval', e.target.value)} />
          </div>

          <AppDivider />

          {/* TLS */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={s.tlsEnabled} onChange={e => set('tlsEnabled', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
            <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable TLS</span>
          </label>

          {/* SASL */}
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
