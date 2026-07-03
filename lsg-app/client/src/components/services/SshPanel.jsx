import React, { useState, useCallback } from 'react';
import { Terminal, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { API_CONFIG } from '../../config/api';
import {
  Panel, PanelHeader, PanelBody, DataRow, StatusBadge, AppButton, AppInput,
} from '../ui/app-ui';
import { Switch } from '@/components/ui/switch';

const E = API_CONFIG.ENDPOINTS.SERVICES;

export default function SshPanel({ showSnackbar }) {
  const { getAuthHeaders } = useAuth();

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [port, setPort] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(E.SSH_STATUS, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch SSH status');
      const data = await res.json();
      setStatus(data);
      setPort(String(data.port));
    } catch (err) {
      showSnackbar(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, showSnackbar]);

  // Fetch on first render
  React.useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleToggle = async () => {
    try {
      const res = await fetch(E.SSH_TOGGLE, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle SSH');
      showSnackbar(`SSH ${!status.enabled ? 'enabled' : 'disabled'}`);
      await fetchStatus();
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  };

  const handleSavePort = async () => {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return showSnackbar('Port must be 1–65535', 'error');
    }
    setSaving(true);
    try {
      const res = await fetch(E.SSH_CONFIG, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: portNum }),
      });
      if (!res.ok) throw new Error('Failed to update SSH port');
      showSnackbar('SSH port updated — service restarted');
      await fetchStatus();
    } catch (err) {
      showSnackbar(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const running = status?.running ?? false;
  const enabled = status?.enabled ?? false;
  const runVariant = running ? 'success' : 'default';

  return (
    <Panel>
      <PanelHeader
        icon={Terminal}
        iconColor="accent"
        title="SSH Server"
        subtitle={
          loading ? 'Loading...' :
          <StatusBadge variant={runVariant} dot>{running ? 'Running' : 'Stopped'}</StatusBadge>
        }
        right={
          <AppButton variant="ghost" onClick={fetchStatus} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </AppButton>
        }
      />
      <PanelBody>
        {loading && !status ? (
          <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>Loading SSH status…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Enable/Disable */}
              <div className="rounded-md border border-[var(--app-border)] p-3 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>
                  Service Control
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable SSH</span>
                  <Switch checked={enabled} onCheckedChange={handleToggle} />
                </div>
                <DataRow label="Status" last>
                  <StatusBadge variant={enabled ? 'success' : 'danger'} dot>
                    {enabled ? 'Enabled' : 'Disabled'}
                  </StatusBadge>
                </DataRow>
              </div>

              {/* Port config */}
              <div className="rounded-md border border-[var(--app-border)] p-3 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>
                  Port Configuration
                </p>
                <AppInput
                  label="SSH Port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  helperText="Default: 22. Changing port restarts SSH automatically."
                />
                <AppButton onClick={handleSavePort} disabled={saving || !status}>
                  {saving ? 'Saving…' : 'Save Port'}
                </AppButton>
              </div>
            </div>

            <p className="text-[12px]" style={{ color: 'var(--app-text-3)' }}>
              Note: SFTP is provided by OpenSSH — no separate service needed.
            </p>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
