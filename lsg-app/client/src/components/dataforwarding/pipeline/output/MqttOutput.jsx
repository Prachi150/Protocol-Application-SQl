import React from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { AppInput, AppButton, IconBtn, SectionLabel, AppDivider } from '../../../ui/app-ui';

export const defaultMqtt = {
  urls: ['tcp://${MASTER_MQTT_HOST}:${MASTER_MQTT_PORT}'],
  topic: '${! meta("mqtt_topic") }',
  clientId: 'lsg-forwarder',
  qos: '1',
  keepalive: '30',
  connectTimeout: '10s',
  writeTimeout: '30s',
  maxInFlight: '64',
  retained: false,
  user: '${MASTER_MQTT_USERNAME}',
  password: '${MASTER_MQTT_PASSWORD}',
  credsMode: 'ioadmin',
  customHost: '', customPort: '1883', customUser: '', customPassword: '',
  tlsEnabled: false, tlsSkipVerify: false, tlsRootCasFile: '',
  willEnabled: false, willTopic: '', willPayload: '', willQos: '1', willRetained: false,
};

const selectStyle = {
  padding: '8px 12px', borderRadius: 8, fontSize: 13.5,
  background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)',
  color: 'var(--app-text-1)', width: '100%',
};

export default function MqttOutput({ value, onChange }) {
  const [tlsOpen, setTlsOpen]   = React.useState(false);
  const [willOpen, setWillOpen] = React.useState(false);
  const s = value;
  const set = (key, val) => onChange({ ...s, [key]: val });

  const setUrl = (i, v) => { const next = [...s.urls]; next[i] = v; set('urls', next); };
  const addUrl    = () => set('urls', [...s.urls, '']);
  const removeUrl = (i) => set('urls', s.urls.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {/* Broker URLs */}
      <div>
        <SectionLabel>Broker URL(s)</SectionLabel>
        <div className="space-y-2">
          {s.urls.map((u, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1">
                <AppInput placeholder="tcp://broker:1883" value={u} onChange={e => setUrl(i, e.target.value)} />
              </div>
              {s.urls.length > 1 && (
                <IconBtn variant="danger" title="Remove" onClick={() => removeUrl(i)}><Trash2 size={13} /></IconBtn>
              )}
            </div>
          ))}
        </div>
        <AppButton variant="ghost" className="mt-2 text-[12.5px] px-0" onClick={addUrl}>
          <Plus size={13} /> Add URL
        </AppButton>
      </div>

      <AppDivider />

      <div className="grid grid-cols-2 gap-3">
        <AppInput label="Topic" placeholder='${! meta("mqtt_topic") }' value={s.topic} onChange={e => set('topic', e.target.value)} />
        <AppInput label="Client ID" value={s.clientId} onChange={e => set('clientId', e.target.value)} />
        <div>
          <label className="text-[13px] font-medium block mb-1" style={{ color: 'var(--app-text-1)' }}>QoS</label>
          <select value={s.qos} onChange={e => set('qos', e.target.value)} style={selectStyle}>
            <option value="0">0 — At most once</option>
            <option value="1">1 — At least once</option>
            <option value="2">2 — Exactly once</option>
          </select>
        </div>
        <AppInput label="Keepalive (s)" type="number" value={s.keepalive} onChange={e => set('keepalive', e.target.value)} />
        <AppInput label="Connect timeout" placeholder="10s" value={s.connectTimeout} onChange={e => set('connectTimeout', e.target.value)} />
        <AppInput label="Write timeout" placeholder="30s" value={s.writeTimeout} onChange={e => set('writeTimeout', e.target.value)} />
        <AppInput label="Max in-flight" type="number" value={s.maxInFlight} onChange={e => set('maxInFlight', e.target.value)} />
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="mqtt-retained" checked={s.retained} onChange={e => set('retained', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
          <label htmlFor="mqtt-retained" className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Retained</label>
        </div>
      </div>

      <AppDivider />

      {/* Credentials */}
      <div>
        <SectionLabel>Credentials</SectionLabel>
        <div className="flex gap-4 mb-3">
          {[['ioadmin', 'Use IoAdmin (MASTER_MQTT_*)'], ['custom', 'Custom credentials']].map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={val} checked={s.credsMode === val} onChange={() => set('credsMode', val)} style={{ accentColor: 'var(--app-accent)' }} />
              <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>{label}</span>
            </label>
          ))}
        </div>
        {s.credsMode === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <AppInput label="Host" placeholder="broker.example.com" value={s.customHost} onChange={e => set('customHost', e.target.value)} />
            <AppInput label="Port" type="number" value={s.customPort} onChange={e => set('customPort', e.target.value)} />
            <AppInput label="Username" value={s.customUser} onChange={e => set('customUser', e.target.value)} />
            <AppInput label="Password" type="password" value={s.customPassword} onChange={e => set('customPassword', e.target.value)} />
          </div>
        )}
      </div>

      {/* TLS */}
      <button className="flex items-center gap-1.5 text-[12.5px]"
        style={{ color: 'var(--app-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => setTlsOpen(o => !o)}>
        {tlsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} TLS settings
      </button>
      {tlsOpen && (
        <div className="space-y-3 pl-3" style={{ borderLeft: '2px solid var(--app-border)' }}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={s.tlsEnabled} onChange={e => set('tlsEnabled', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
            <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable TLS</span>
          </label>
          {s.tlsEnabled && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={s.tlsSkipVerify} onChange={e => set('tlsSkipVerify', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
                <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Skip certificate verification</span>
              </label>
              <AppInput label="Root CA file (path on device)" placeholder="/etc/ssl/certs/ca.pem" value={s.tlsRootCasFile} onChange={e => set('tlsRootCasFile', e.target.value)} />
            </div>
          )}
        </div>
      )}

      {/* Last Will */}
      <button className="flex items-center gap-1.5 text-[12.5px]"
        style={{ color: 'var(--app-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => setWillOpen(o => !o)}>
        {willOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Last will message
      </button>
      {willOpen && (
        <div className="space-y-3 pl-3" style={{ borderLeft: '2px solid var(--app-border)' }}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={s.willEnabled} onChange={e => set('willEnabled', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
            <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable last will</span>
          </label>
          {s.willEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <AppInput label="Topic" value={s.willTopic} onChange={e => set('willTopic', e.target.value)} />
              <AppInput label="Payload" value={s.willPayload} onChange={e => set('willPayload', e.target.value)} />
              <div>
                <label className="text-[13px] font-medium block mb-1" style={{ color: 'var(--app-text-1)' }}>QoS</label>
                <select value={s.willQos} onChange={e => set('willQos', e.target.value)} style={selectStyle}>
                  <option value="0">0</option><option value="1">1</option><option value="2">2</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" checked={s.willRetained} onChange={e => set('willRetained', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
                <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Retained</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
