import React from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { AppButton, IconBtn, SectionLabel } from '../../ui/app-ui';

const PROCESSOR_TYPES = ['mapping', 'log', 'filter'];

const defaultProcessor = (type) => {
  if (type === 'mapping') return { type, mapping: 'meta mqtt_topic = meta("kafka_topic").replace_all(".", "/")' };
  if (type === 'log')     return { type, level: 'INFO', message: 'Fwd → ${! meta("mqtt_topic") } | ${! content().string() }' };
  if (type === 'filter')  return { type, condition: 'true' };
  return { type };
};

const selectStyle = {
  padding: '6px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)',
  color: 'var(--app-text-1)',
};

const textareaStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, lineHeight: 1.6,
  background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)',
  color: 'var(--app-text-1)', outline: 'none', resize: 'vertical',
};

function ProcessorCard({ proc, index, total, onChange, onRemove, onMove }) {
  const set = (key, val) => onChange({ ...proc, [key]: val });

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--app-border)' }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--app-elevated)', borderBottom: '1px solid var(--app-border)' }}>
        <select value={proc.type} onChange={e => onChange(defaultProcessor(e.target.value))} style={{ ...selectStyle, fontSize: 12.5 }}>
          {PROCESSOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex-1" />
        <IconBtn title="Move up"   disabled={index === 0}          onClick={() => onMove(index, -1)}><ChevronUp   size={13} /></IconBtn>
        <IconBtn title="Move down" disabled={index === total - 1}  onClick={() => onMove(index,  1)}><ChevronDown size={13} /></IconBtn>
        <IconBtn variant="danger" title="Remove processor" onClick={onRemove}><Trash2 size={13} /></IconBtn>
      </div>

      <div className="p-3 space-y-2">
        {proc.type === 'mapping' && (
          <div>
            <label className="text-[12px] block mb-1" style={{ color: 'var(--app-text-3)' }}>
              Bloblang expression — <code>root = this</code> passes the message unchanged
            </label>
            <textarea
              rows={4}
              value={proc.mapping}
              onChange={e => set('mapping', e.target.value)}
              style={textareaStyle}
            />
          </div>
        )}

        {proc.type === 'log' && (
          <div className="flex gap-3">
            <div style={{ minWidth: 120 }}>
              <label className="text-[12px] block mb-1" style={{ color: 'var(--app-text-3)' }}>Level</label>
              <select value={proc.level} onChange={e => set('level', e.target.value)} style={selectStyle}>
                {['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'].map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[12px] block mb-1" style={{ color: 'var(--app-text-3)' }}>
                Message — supports <code>{'${! expr }'}</code> interpolation
              </label>
              <input
                className="w-full px-3 py-2 rounded-lg text-[13px] font-mono outline-none"
                style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}
                value={proc.message}
                onChange={e => set('message', e.target.value)}
              />
            </div>
          </div>
        )}

        {proc.type === 'filter' && (
          <div>
            <label className="text-[12px] block mb-1" style={{ color: 'var(--app-text-3)' }}>
              Bloblang condition — message dropped when <code>false</code>
            </label>
            <textarea
              rows={2}
              value={proc.condition}
              onChange={e => set('condition', e.target.value)}
              style={textareaStyle}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProcessorsSection({ value, onChange }) {
  const processors = value || [];

  const addProcessor = (type) => {
    onChange([...processors, defaultProcessor(type)]);
  };

  const updateProcessor = (i, updated) => {
    onChange(processors.map((p, idx) => idx === i ? updated : p));
  };

  const removeProcessor = (i) => {
    onChange(processors.filter((_, idx) => idx !== i));
  };

  const moveProcessor = (i, dir) => {
    const next = [...processors];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {processors.length === 0 && (
        <p className="text-[13px]" style={{ color: 'var(--app-text-3)' }}>
          No processors. Messages pass through unmodified.
        </p>
      )}

      {processors.map((p, i) => (
        <ProcessorCard
          key={i}
          proc={p}
          index={i}
          total={processors.length}
          onChange={updated => updateProcessor(i, updated)}
          onRemove={() => removeProcessor(i)}
          onMove={moveProcessor}
        />
      ))}

      <div className="flex gap-2 flex-wrap">
        {PROCESSOR_TYPES.map(t => (
          <AppButton key={t} variant="outline" className="text-[12.5px]" onClick={() => addProcessor(t)}>
            <Plus size={13} /> {t}
          </AppButton>
        ))}
      </div>
    </div>
  );
}
