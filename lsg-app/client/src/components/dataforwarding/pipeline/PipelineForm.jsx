import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AppInput, AppButton, AppAlert, SectionLabel, Panel, PanelHeader, PanelBody, Spinner } from '../../ui/app-ui';
import { Save, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { getApiEndpoint } from '../../../config/api';
import { generatePipelineYaml } from './yamlGenerator';
import InputSection, { defaultInput } from './InputSection';
import ProcessorsSection from './ProcessorsSection';
import MqttOutput, { defaultMqtt } from './output/MqttOutput';
import HttpOutput, { defaultHttp } from './output/HttpOutput';
import KafkaOutput, { defaultKafka } from './output/KafkaOutput';

const DEFAULT_STATE = (name = '') => ({
  meta: { name, description: '' },
  input: { ...defaultInput, consumerGroup: name ? `lsg-forwarder-${name}` : '' },
  processors: [
    { type: 'mapping', mapping: 'meta mqtt_topic = meta("kafka_topic").replace_all(".", "/")' },
    { type: 'log', level: 'INFO', message: 'Fwd → ${! meta("mqtt_topic") } | ${! content().string() }' },
  ],
  output: {
    type: 'mqtt',
    mqtt: { ...defaultMqtt },
    http: { ...defaultHttp },
    kafka: { ...defaultKafka },
  },
});

const tabStyle = "rounded-none border-b-2 border-transparent px-4 py-2.5 text-[13px] font-medium data-[state=active]:border-[var(--app-accent)] data-[state=active]:text-[var(--app-accent-text)] data-[state=active]:bg-transparent bg-transparent";

export default function PipelineForm({ initialName, onDeployed }) {
  const { getAuthHeaders } = useAuth();
  const [formState, setFormState] = useState(() => DEFAULT_STATE(initialName || ''));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tab, setTab] = useState('input');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  const isEdit = !!initialName;
  const yamlPreview = generatePipelineYaml(formState);

  const set = (key, val) => setFormState(s => ({ ...s, [key]: val }));
  const setOutput = (key, val) => setFormState(s => ({
    ...s,
    output: { ...s.output, [key]: val },
  }));

  // Auto-fill consumer group when name changes
  useEffect(() => {
    if (!isEdit && formState.meta.name) {
      setFormState(s => ({
        ...s,
        input: { ...s.input, consumerGroup: `lsg-forwarder-${s.meta.name}` },
        output: {
          ...s.output,
          mqtt: { ...s.output.mqtt, clientId: `lsg-forwarder-${s.meta.name}` },
        },
      }));
    }
  }, [formState.meta.name, isEdit]);

  const validate = useCallback(async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await fetch(getApiEndpoint('REDPANDA.PIPELINE_VALIDATE'), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yamlPreview }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch (e) {
      setValidationResult({ valid: false, output: e.message });
    } finally {
      setValidating(false);
    }
  }, [yamlPreview, getAuthHeaders]);

  const deploy = async () => {
    setError(null);
    setSuccess(null);
    const { name } = formState.meta;
    if (!name.trim()) { setError('Pipeline name is required.'); setTab('input'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) { setError('Name must be alphanumeric with hyphens/underscores.'); setTab('input'); return; }

    setSaving(true);
    try {
      const url = isEdit
        ? `${getApiEndpoint('REDPANDA.PIPELINE')}/${name}`
        : getApiEndpoint('REDPANDA.PIPELINE');
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: yamlPreview }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.output || 'Pipeline deployed successfully.');
        onDeployed?.();
      } else {
        const msg = data.error || 'Deploy failed.';
        setError(data.details ? `${msg}\n\n${data.details}` : msg);
      }
    } catch (e) {
      setError('Network error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const outputTabs = [
    ['mqtt', 'MQTT'],
    ['http', 'HTTP'],
    ['kafka', 'Kafka'],
  ];

  return (
    <div className="space-y-4">
      {/* Pipeline name + description */}
      <div className="grid grid-cols-2 gap-3">
        <AppInput
          label="Pipeline name"
          placeholder="e.g. ioadmin-mqtt"
          value={formState.meta.name}
          onChange={e => set('meta', { ...formState.meta, name: e.target.value })}
          helperText="Alphanumeric, hyphens and underscores only"
          disabled={isEdit}
        />
        <AppInput
          label="Description (optional)"
          placeholder="Forwards sensor data to IoAdmin MQTT"
          value={formState.meta.description}
          onChange={e => set('meta', { ...formState.meta, description: e.target.value })}
        />
      </div>

      {/* Section tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto p-0 gap-0 rounded-none border-b bg-transparent" style={{ borderColor: 'var(--app-border)' }}>
          {[['input', 'Input'], ['processors', 'Processors'], ['output', 'Output']].map(([v, l]) => (
            <TabsTrigger key={v} value={v} className={tabStyle} style={{ color: 'var(--app-text-2)' }}>{l}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="input" className="mt-4">
          <InputSection
            value={formState.input}
            onChange={val => set('input', val)}
          />
        </TabsContent>

        <TabsContent value="processors" className="mt-4">
          <ProcessorsSection
            value={formState.processors}
            onChange={val => set('processors', val)}
          />
        </TabsContent>

        <TabsContent value="output" className="mt-4">
          <div className="mb-4">
            <SectionLabel>Output type</SectionLabel>
            <div className="flex gap-3">
              {outputTabs.map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value={v}
                    checked={formState.output.type === v}
                    onChange={() => setOutput('type', v)}
                    style={{ accentColor: 'var(--app-accent)' }}
                  />
                  <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>{l}</span>
                </label>
              ))}
            </div>
          </div>

          {formState.output.type === 'mqtt'  && <MqttOutput  value={formState.output.mqtt}  onChange={v => setOutput('mqtt',  v)} />}
          {formState.output.type === 'http'  && <HttpOutput  value={formState.output.http}  onChange={v => setOutput('http',  v)} />}
          {formState.output.type === 'kafka' && <KafkaOutput value={formState.output.kafka} onChange={v => setOutput('kafka', v)} />}
        </TabsContent>
      </Tabs>

      {/* YAML Preview */}
      <div>
        <button
          className="flex items-center gap-1.5 text-[12.5px] mb-2"
          style={{ color: 'var(--app-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          onClick={() => setPreviewOpen(o => !o)}
        >
          {previewOpen ? <EyeOff size={13} /> : <Eye size={13} />}
          {previewOpen ? 'Hide' : 'Show'} generated YAML
        </button>
        {previewOpen && (
          <pre
            className="rounded-lg p-3 text-[12px] leading-[1.7] overflow-x-auto"
            style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)', color: 'var(--app-text-2)', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            {yamlPreview}
          </pre>
        )}
      </div>

      {/* Validation result */}
      {validationResult && (
        <AppAlert severity={validationResult.valid ? 'success' : 'error'}>
          {validationResult.valid ? 'YAML is valid.' : 'Validation errors:'}
          {validationResult.output && (
            <pre className="mt-1 text-[11px] whitespace-pre-wrap">{validationResult.output}</pre>
          )}
        </AppAlert>
      )}

      {error   && <AppAlert severity="error"><pre className="text-[11px] whitespace-pre-wrap">{error}</pre></AppAlert>}
      {success && <AppAlert severity="success"><pre className="text-[11px] whitespace-pre-wrap">{success}</pre></AppAlert>}

      {/* Actions */}
      <div className="flex gap-2">
        <AppButton variant="outline" onClick={validate} disabled={validating}>
          {validating ? <><Spinner size={13} /> Validating…</> : 'Validate YAML'}
        </AppButton>
        <AppButton onClick={deploy} disabled={saving}>
          {saving ? <><Spinner size={13} /> Deploying…</> : <><Save size={14} /> {isEdit ? 'Update Pipeline' : 'Deploy Pipeline'}</>}
        </AppButton>
      </div>
    </div>
  );
}
