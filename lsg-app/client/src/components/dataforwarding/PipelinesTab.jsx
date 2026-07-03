import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Code, FormInput, AlertTriangle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Panel, PanelHeader, PanelBody, AppAlert, AppButton, AppButton as Btn,
  IconBtn, Spinner, SectionLabel,
} from '../ui/app-ui';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';
import PipelineForm from './pipeline/PipelineForm';
import { parseYamlToFormState } from './pipeline/yamlGenerator';

const textareaStyle = {
  width: '100%', padding: '10px 14px',
  fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, lineHeight: 1.7,
  background: 'var(--app-bg)', border: '1px solid var(--app-border)',
  color: 'var(--app-text-2)', outline: 'none', resize: 'vertical',
  borderRadius: 8, minHeight: 480,
};

function YamlEditor({ initialContent, initialName, onDeployed }) {
  const { getAuthHeaders } = useAuth();
  const [content, setContent]           = useState(initialContent || '');
  const [saving, setSaving]             = useState(false);
  const [validating, setValidating]     = useState(false);
  const [validResult, setValidResult]   = useState(null);
  const [error, setError]               = useState(null);
  const [success, setSuccess]           = useState(null);
  const [name, setName]                 = useState(initialName || '');
  const isEdit = !!initialName;

  // Debounced validation
  useEffect(() => {
    if (!content.trim()) return;
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(getApiEndpoint('REDPANDA.PIPELINE_VALIDATE'), {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const data = await res.json();
        setValidResult(data);
      } catch { /* silent */ }
    }, 900);
    return () => clearTimeout(t);
  }, [content, getAuthHeaders]);

  const deploy = async () => {
    setError(null);
    setSuccess(null);
    if (!isEdit && !name.trim()) { setError('Pipeline name is required.'); return; }
    setSaving(true);
    try {
      const pName = isEdit ? initialName : name;
      const url   = isEdit
        ? `${getApiEndpoint('REDPANDA.PIPELINE')}/${pName}`
        : getApiEndpoint('REDPANDA.PIPELINE');
      const res   = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pName, content }),
      });
      const data  = await res.json();
      if (res.ok) { setSuccess(data.output || 'Pipeline deployed.'); onDeployed?.(); }
      else {
        const msg = data.error || 'Deploy failed.';
        setError(data.details ? `${msg}\n\n${data.details}` : msg);
      }
    } catch (e) {
      setError('Network error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {!isEdit && (
        <div style={{ maxWidth: 300 }}>
          <input
            className="w-full px-3 py-2 rounded-lg text-[13.5px] outline-none font-mono"
            style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}
            placeholder="Pipeline name (alphanumeric, hyphens)"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
      )}

      <div style={{ position: 'relative' }}>
        {validResult && (
          <div className="absolute top-2 right-3 z-10">
            <span className="text-[11px] px-2 py-0.5 rounded"
              style={{
                background: validResult.valid ? 'var(--app-success-sub)' : 'var(--app-danger-sub)',
                color:      validResult.valid ? 'var(--app-success)'     : 'var(--app-danger)',
              }}>
              {validResult.valid ? '✓ Valid' : '✗ Errors'}
            </span>
          </div>
        )}
        <textarea
          value={content}
          onChange={e => { setContent(e.target.value); setValidResult(null); }}
          style={textareaStyle}
          spellCheck={false}
        />
      </div>

      {validResult && !validResult.valid && validResult.output && (
        <AppAlert severity="error">
          <pre className="text-[11px] whitespace-pre-wrap">{validResult.output}</pre>
        </AppAlert>
      )}
      {error   && <AppAlert severity="error"><pre className="text-[11px] whitespace-pre-wrap">{error}</pre></AppAlert>}
      {success && <AppAlert severity="success"><pre className="text-[11px] whitespace-pre-wrap">{success}</pre></AppAlert>}

      <AppButton onClick={deploy} disabled={saving}>
        {saving ? <><Spinner size={13} /> Deploying…</> : isEdit ? 'Update Pipeline' : 'Deploy Pipeline'}
      </AppButton>
    </div>
  );
}

export default function PipelinesTab({ editingPipeline, onEditClear, onDeployed }) {
  const { getAuthHeaders } = useAuth();
  const [mode, setMode]           = useState('guided'); // 'guided' | 'yaml'
  const [loadedYaml, setLoadedYaml]   = useState(null);
  const [loadError, setLoadError]     = useState(null);
  const [loading, setLoading]         = useState(false);
  const [guidedFallback, setGuidedFallback] = useState(null); // 'unsupported'

  useEffect(() => {
    if (!editingPipeline) {
      setLoadedYaml(null);
      setGuidedFallback(null);
      setMode('guided');
      return;
    }

    setLoading(true);
    setLoadError(null);
    setMode('yaml'); // default to YAML when editing

    fetch(`${getApiEndpoint('REDPANDA.PIPELINE')}/${editingPipeline}`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setLoadedYaml(data.content);
        setLoading(false);
      })
      .catch(e => { setLoadError(e.message); setLoading(false); });
  }, [editingPipeline, getAuthHeaders]);

  const tryGuided = () => {
    const result = parseYamlToFormState(loadedYaml, editingPipeline);
    if (result.ok) {
      setMode('guided');
      setGuidedFallback(null);
    } else {
      setGuidedFallback(result.reason);
    }
  };

  const handleDeployed = () => { onDeployed?.(); onEditClear?.(); };

  const tabStyle = "rounded-none border-b-2 border-transparent px-4 py-2.5 text-[13px] font-medium data-[state=active]:border-[var(--app-accent)] data-[state=active]:text-[var(--app-accent-text)] data-[state=active]:bg-transparent bg-transparent";

  return (
    <div className="mt-4 space-y-4">
      {/* Editing banner */}
      {editingPipeline && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg" style={{ background: 'var(--app-accent-sub)', border: '1px solid var(--app-accent-border)' }}>
          <span className="text-[13px]" style={{ color: 'var(--app-accent-text)' }}>
            Editing pipeline: <strong className="font-mono">{editingPipeline}</strong>
          </span>
          <button
            className="text-[12px] ml-auto"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--app-accent-text)' }}
            onClick={() => { onEditClear?.(); setLoadedYaml(null); setMode('guided'); }}
          >
            ✕ Cancel edit
          </button>
          {mode === 'yaml' && (
            <AppButton variant="outline" className="text-[12px] py-1" onClick={tryGuided}>
              Try Guided form
            </AppButton>
          )}
        </div>
      )}

      {guidedFallback && (
        <AppAlert severity="warning">
          <div className="flex gap-2 items-start">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>Cannot open in guided mode: {guidedFallback}. Editing in YAML mode.</span>
          </div>
        </AppAlert>
      )}

      {/* Mode toggle (only for new pipelines — editing always determined by load) */}
      {!editingPipeline && (
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--app-elevated)', width: 'fit-content' }}>
          {[['guided', <><FormInput size={13} /> Guided</>, ], ['yaml', <><Code size={13} /> YAML</>]].map(([v, label]) => (
            <button key={v} onClick={() => setMode(v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
              style={{
                background: mode === v ? 'var(--app-surface)' : 'transparent',
                color:      mode === v ? 'var(--app-accent-text)' : 'var(--app-text-2)',
                border:     mode === v ? '1px solid var(--app-border)' : '1px solid transparent',
              }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="py-8 flex justify-center"><Spinner size={24} /></div>}
      {loadError && <AppAlert severity="error">{loadError}</AppAlert>}

      {!loading && (
        <>
          {mode === 'guided' && (
            <Panel>
              <PanelHeader icon={Plus} iconColor="accent" title={editingPipeline ? `Edit — ${editingPipeline}` : 'New Pipeline'} />
              <PanelBody>
                <PipelineForm
                  initialName={editingPipeline || undefined}
                  onDeployed={handleDeployed}
                />
              </PanelBody>
            </Panel>
          )}

          {mode === 'yaml' && (
            <Panel>
              <PanelHeader icon={Code} iconColor="accent" title={editingPipeline ? `Edit YAML — ${editingPipeline}` : 'New Pipeline (YAML)'} />
              <PanelBody>
                <p className="text-[13px] mb-3" style={{ color: 'var(--app-text-2)' }}>
                  Write a full Redpanda Connect pipeline YAML. Validation runs automatically as you type.
                </p>
                <YamlEditor
                  initialContent={loadedYaml || ''}
                  initialName={editingPipeline || undefined}
                  onDeployed={handleDeployed}
                />
              </PanelBody>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
