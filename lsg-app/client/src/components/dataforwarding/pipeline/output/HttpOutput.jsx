import React from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { AppInput, AppButton, IconBtn, SectionLabel, AppDivider } from '../../../ui/app-ui';

export const defaultHttp = {
  url: '',
  verb: 'POST',
  headers: [{ key: 'Content-Type', value: 'application/json' }],
  timeout: '10s',
  retries: '3',
  retryPeriod: '5s',
  maxRetryBackoff: '300s',
  maxInFlight: '64',
  followRedirects: true,
  backoffOn: '429',
  dropOn: '',
  authType: 'none',
  basicUser: '', basicPassword: '',
  bearerToken: '',
  oauth2ClientId: '', oauth2ClientSecret: '', oauth2TokenUrl: '',
  tlsEnabled: false, tlsSkipVerify: false, tlsRootCasFile: '',
  batchCount: '0', batchByteSize: '0', batchPeriod: '',
};

const selectStyle = {
  padding: '8px 12px', borderRadius: 8, fontSize: 13.5,
  background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)',
  color: 'var(--app-text-1)', width: '100%',
};

export default function HttpOutput({ value, onChange }) {
  const [tlsOpen, setTlsOpen]     = React.useState(false);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const s = value;
  const set = (key, val) => onChange({ ...s, [key]: val });

  const setHeader = (i, key, v) => {
    const next = s.headers.map((h, idx) => idx === i ? { ...h, [key]: v } : h);
    set('headers', next);
  };
  const addHeader    = () => set('headers', [...s.headers, { key: '', value: '' }]);
  const removeHeader = (i) => set('headers', s.headers.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <AppInput label="URL" placeholder="https://ingest.example.com/data" value={s.url} onChange={e => set('url', e.target.value)} />
        </div>
        <div>
          <label className="text-[13px] font-medium block mb-1" style={{ color: 'var(--app-text-1)' }}>Method</label>
          <select value={s.verb} onChange={e => set('verb', e.target.value)} style={selectStyle}>
            {['POST', 'PUT', 'PATCH', 'GET'].map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <AppDivider />

      {/* Headers */}
      <div>
        <SectionLabel>Headers</SectionLabel>
        <div className="space-y-2">
          {s.headers.map((h, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1"><AppInput placeholder="Header name" value={h.key} onChange={e => setHeader(i, 'key', e.target.value)} /></div>
              <div className="flex-1"><AppInput placeholder="Value" value={h.value} onChange={e => setHeader(i, 'value', e.target.value)} /></div>
              <IconBtn variant="danger" title="Remove" onClick={() => removeHeader(i)}><Trash2 size={13} /></IconBtn>
            </div>
          ))}
        </div>
        <AppButton variant="ghost" className="mt-2 text-[12.5px] px-0" onClick={addHeader}>
          <Plus size={13} /> Add header
        </AppButton>
      </div>

      <AppDivider />

      {/* Retry & timeout */}
      <div className="grid grid-cols-3 gap-3">
        <AppInput label="Timeout" placeholder="10s" value={s.timeout} onChange={e => set('timeout', e.target.value)} />
        <AppInput label="Retries" type="number" value={s.retries} onChange={e => set('retries', e.target.value)} />
        <AppInput label="Retry period" placeholder="5s" value={s.retryPeriod} onChange={e => set('retryPeriod', e.target.value)} />
        <AppInput label="Max retry backoff" placeholder="300s" value={s.maxRetryBackoff} onChange={e => set('maxRetryBackoff', e.target.value)} />
        <AppInput label="Max in-flight" type="number" value={s.maxInFlight} onChange={e => set('maxInFlight', e.target.value)} />
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" checked={s.followRedirects} onChange={e => set('followRedirects', e.target.checked)} style={{ accentColor: 'var(--app-accent)' }} />
          <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Follow redirects</span>
        </div>
        <AppInput label="Backoff on (status codes)" placeholder="429" value={s.backoffOn} onChange={e => set('backoffOn', e.target.value)} />
        <AppInput label="Drop on (status codes)" placeholder="400,404" value={s.dropOn} onChange={e => set('dropOn', e.target.value)} />
      </div>

      <AppDivider />

      {/* Auth */}
      <div>
        <SectionLabel>Authentication</SectionLabel>
        <div className="mb-3">
          <label className="text-[13px] font-medium block mb-1" style={{ color: 'var(--app-text-1)' }}>Auth type</label>
          <select value={s.authType} onChange={e => set('authType', e.target.value)} style={{ ...selectStyle, width: 'auto', minWidth: 180 }}>
            <option value="none">None</option>
            <option value="basic">HTTP Basic</option>
            <option value="bearer">Bearer token</option>
            <option value="oauth2">OAuth 2.0</option>
          </select>
        </div>
        {s.authType === 'basic' && (
          <div className="grid grid-cols-2 gap-3">
            <AppInput label="Username" value={s.basicUser} onChange={e => set('basicUser', e.target.value)} />
            <AppInput label="Password" type="password" value={s.basicPassword} onChange={e => set('basicPassword', e.target.value)} />
          </div>
        )}
        {s.authType === 'bearer' && (
          <AppInput label="Token" placeholder="eyJ..." value={s.bearerToken} onChange={e => set('bearerToken', e.target.value)}
            helperText="Injected as Authorization: Bearer <token>" />
        )}
        {s.authType === 'oauth2' && (
          <div className="grid grid-cols-3 gap-3">
            <AppInput label="Client ID" value={s.oauth2ClientId} onChange={e => set('oauth2ClientId', e.target.value)} />
            <AppInput label="Client secret" type="password" value={s.oauth2ClientSecret} onChange={e => set('oauth2ClientSecret', e.target.value)} />
            <AppInput label="Token URL" placeholder="https://auth.example.com/token" value={s.oauth2TokenUrl} onChange={e => set('oauth2TokenUrl', e.target.value)} />
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

      {/* Batching */}
      <button className="flex items-center gap-1.5 text-[12.5px]"
        style={{ color: 'var(--app-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => setBatchOpen(o => !o)}>
        {batchOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Batching
      </button>
      {batchOpen && (
        <div className="grid grid-cols-3 gap-3 pl-3" style={{ borderLeft: '2px solid var(--app-border)' }}>
          <AppInput label="Batch count" type="number" placeholder="0 (off)" value={s.batchCount} onChange={e => set('batchCount', e.target.value)} />
          <AppInput label="Batch byte size" type="number" placeholder="0 (off)" value={s.batchByteSize} onChange={e => set('batchByteSize', e.target.value)} />
          <AppInput label="Batch period" placeholder="5s" value={s.batchPeriod} onChange={e => set('batchPeriod', e.target.value)} />
        </div>
      )}
    </div>
  );
}
