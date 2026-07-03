import React, { useState, useCallback } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { API_CONFIG } from '../../config/api';
import {
  Panel, PanelHeader, PanelBody, DataRow, StatusBadge, AppButton, AppInput,
} from '../ui/app-ui';
import { Switch } from '@/components/ui/switch';

const E = API_CONFIG.ENDPOINTS.SERVICES;

export default function FtpPanel({ showSnackbar }) {
  const { getAuthHeaders } = useAuth();

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    port: '21',
    anonymousEnabled: false,
    localEnabled: true,
    writeEnabled: true,
    passvMinPort: '40000',
    passvMaxPort: '40100',
  });

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(E.FTP_STATUS, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch FTP status');
      const data = await res.json();
      setStatus(data);
      setForm({
        port: String(data.port),
        anonymousEnabled: data.anonymousEnabled,
        localEnabled: data.localEnabled,
        writeEnabled: data.writeEnabled,
        passvMinPort: String(data.passvMinPort),
        passvMaxPort: String(data.passvMaxPort),
      });
    } catch (err) {
      showSnackbar(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, showSnackbar]);

  React.useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleToggle = async () => {
    try {
      const res = await fetch(E.FTP_TOGGLE, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle FTP');
      showSnackbar(`FTP ${!status.enabled ? 'enabled' : 'disabled'}`);
      await fetchStatus();
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(E.FTP_CONFIG, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: parseInt(form.port, 10),
          anonymousEnabled: form.anonymousEnabled,
          localEnabled: form.localEnabled,
          writeEnabled: form.writeEnabled,
          passvMinPort: parseInt(form.passvMinPort, 10),
          passvMaxPort: parseInt(form.passvMaxPort, 10),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save FTP config');
      }
      showSnackbar('FTP configuration saved — service restarted');
      await fetchStatus();
    } catch (err) {
      showSnackbar(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));
  const toggle = (key) => (val) => setForm(prev => ({ ...prev, [key]: val }));

  const running = status?.running ?? false;
  const enabled = status?.enabled ?? false;

  return (
    <Panel>
      <PanelHeader
        icon={FolderOpen}
        iconColor="accent"
        title="FTP Server (vsftpd)"
        subtitle={
          loading ? 'Loading...' :
          <StatusBadge variant={running ? 'success' : 'default'} dot>{running ? 'Running' : 'Stopped'}</StatusBadge>
        }
        right={
          <AppButton variant="ghost" onClick={fetchStatus} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </AppButton>
        }
      />
      <PanelBody>
        {loading && !status ? (
          <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>Loading FTP status…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Service control */}
              <div className="rounded-md border border-[var(--app-border)] p-3 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>
                  Service Control
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable FTP</span>
                  <Switch checked={enabled} onCheckedChange={handleToggle} disabled={!status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Allow local users</span>
                  <Switch checked={form.localEnabled} onCheckedChange={toggle('localEnabled')} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Allow anonymous</span>
                  <Switch checked={form.anonymousEnabled} onCheckedChange={toggle('anonymousEnabled')} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable write access</span>
                  <Switch checked={form.writeEnabled} onCheckedChange={toggle('writeEnabled')} />
                </div>
              </div>

              {/* Port config */}
              <div className="rounded-md border border-[var(--app-border)] p-3 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>
                  Port Configuration
                </p>
                <AppInput label="FTP Port" type="number" value={form.port} onChange={set('port')} />
                <div className="grid grid-cols-2 gap-2">
                  <AppInput label="Passive Min Port" type="number" value={form.passvMinPort} onChange={set('passvMinPort')} />
                  <AppInput label="Passive Max Port" type="number" value={form.passvMaxPort} onChange={set('passvMaxPort')} />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <AppButton onClick={handleSave} disabled={saving || !status}>
                {saving ? 'Saving…' : 'Save Configuration'}
              </AppButton>
            </div>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
