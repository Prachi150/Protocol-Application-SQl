import React, { useState, useCallback, useRef } from 'react';
import { Shield, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';
import {
  Panel, PanelHeader, PanelBody, DataRow, MonoValue, StatusBadge, AppButton, AppInput,
} from '../ui/app-ui';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

function getVpnStatusFromServiceStatus(serviceStatus) {
  if (!serviceStatus) return 'disconnected';
  if (serviceStatus.includes('Active: active (running)')) {
    if (serviceStatus.includes('Initialization Sequence Completed')) return 'connected';
    return 'connecting';
  }
  if (serviceStatus.includes('Active: inactive')) return 'disconnected';
  if (serviceStatus.includes('Active: failed')) return 'error';
  return 'unknown';
}

export default function VpnPanel({ showSnackbar }) {
  const { getAuthHeaders } = useAuth();

  const [loading, setLoading] = useState(true);
  const [vpn, setVpn] = useState({
    isEnabled: false, hasProfile: false, profileName: null, lastConnected: null,
    globalRouting: false, routingInfo: { hasRoutePull: false, message: '' },
    serviceStatus: '', serviceLogs: '', configPermissions: {}, vpnIp: null,
  });
  const [configDialog, setConfigDialog] = useState({
    open: false, signedUrl: '', profileName: '', mode: 'upload', ovpnContent: '', fileName: '',
  });
  const [logsExpanded, setLogsExpanded] = useState(false);
  const pollingRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(getApiEndpoint('REMOTE.VPN.STATUS'), { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch VPN status');
      const data = await res.json();
      setVpn(prev => ({ ...prev, ...data }));
    } catch (err) {
      showSnackbar(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, showSnackbar]);

  React.useEffect(() => {
    fetchStatus();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchStatus]);

  const handleToggle = async () => {
    try {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      const res = await fetch(getApiEndpoint('REMOTE.VPN.TOGGLE'), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: !vpn.isEnabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle VPN');
      showSnackbar(`VPN ${!vpn.isEnabled ? 'enabled' : 'disabled'}`);
      await fetchStatus();
      if (!vpn.isEnabled) {
        let count = 0;
        pollingRef.current = setInterval(async () => {
          count++;
          await fetchStatus();
          if (count >= 6) { clearInterval(pollingRef.current); pollingRef.current = null; }
        }, 5000);
      }
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  };

  const handleGlobalRoutingToggle = async () => {
    const isEnabled = !vpn.routingInfo?.message?.toLowerCase().includes('disabled');
    try {
      const res = await fetch(getApiEndpoint('REMOTE.VPN.ROUTING'), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: !isEnabled }),
      });
      if (!res.ok) throw new Error('Failed to update global routing');
      showSnackbar(`Global routing ${!isEnabled ? 'enabled' : 'disabled'}`);
      await fetchStatus();
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setConfigDialog(prev => ({
        ...prev,
        ovpnContent: ev.target.result,
        fileName: file.name,
        profileName: prev.profileName || file.name.replace(/\.ovpn$/i, ''),
      }));
    };
    reader.readAsText(file);
  };

  const handleConfigSubmit = async () => {
    try {
      const isUpload = configDialog.mode === 'upload';
      const endpoint = isUpload ? getApiEndpoint('REMOTE.VPN.UPLOAD') : getApiEndpoint('REMOTE.VPN.CONFIG');
      const payload = isUpload
        ? { ovpnContent: configDialog.ovpnContent, profileName: configDialog.profileName }
        : { signedUrl: configDialog.signedUrl, profileName: configDialog.profileName };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to configure VPN');
      }
      showSnackbar('VPN profile configured successfully');
      setConfigDialog({ open: false, signedUrl: '', profileName: '', mode: 'upload', ovpnContent: '', fileName: '' });
      await fetchStatus();
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  };

  const vpnStatus = getVpnStatusFromServiceStatus(vpn.serviceStatus);
  const vpnVariant = vpnStatus === 'connected' ? 'success' : vpnStatus === 'connecting' ? 'warning' : vpnStatus === 'error' ? 'danger' : 'default';
  const isConnecting = vpnStatus === 'connecting';

  return (
    <>
      <Panel>
        <PanelHeader
          icon={Shield}
          iconColor="accent"
          title="VPN Management"
          subtitle={
            loading
              ? 'Loading...'
              : <StatusBadge variant={vpnVariant} dot>{vpnStatus.charAt(0).toUpperCase() + vpnStatus.slice(1)}</StatusBadge>
          }
          right={
            <AppButton
              variant="outline"
              onClick={() => setConfigDialog({ open: true, signedUrl: '', profileName: '', mode: 'upload', ovpnContent: '', fileName: '' })}
              disabled={loading}
            >
              <Upload size={13} />
              Configure VPN
            </AppButton>
          }
        />
        <PanelBody>
          {loading ? (
            <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>Loading VPN status…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border border-[var(--app-border)] p-3 space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>Connection Settings</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable VPN</span>
                    <Switch checked={vpn.isEnabled} onCheckedChange={handleToggle} disabled={!vpn.hasProfile || isConnecting} />
                  </div>
                  {vpn.hasProfile && (
                    <div className="flex items-center justify-between">
                      <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Global Routing</span>
                      <Switch
                        checked={!vpn.routingInfo?.message?.toLowerCase().includes('disabled')}
                        onCheckedChange={handleGlobalRoutingToggle}
                        disabled={!vpn.isEnabled}
                      />
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-[var(--app-border)] p-3 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>Connection Details</p>
                  {vpn.hasProfile && <DataRow label="Profile"><MonoValue>{vpn.profileName || 'client.ovpn'}</MonoValue></DataRow>}
                  {vpn.routingInfo?.message && (
                    <DataRow label="Routing">
                      <span className="text-[13px] text-right" style={{ color: 'var(--app-text-1)' }}>{vpn.routingInfo.message}</span>
                    </DataRow>
                  )}
                  {vpnStatus === 'connected' && <DataRow label="VPN IP" last><MonoValue>{vpn.vpnIp || 'N/A'}</MonoValue></DataRow>}
                  {!vpn.hasProfile && <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>No profile configured.</p>}
                </div>
              </div>
              <div className="rounded-md border border-[var(--app-border)] overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 text-[13px] font-medium transition-colors"
                  style={{ color: 'var(--app-text-1)', background: 'var(--app-surface)' }}
                  onClick={() => setLogsExpanded(p => !p)}
                >
                  <span>Service Logs</span>
                  {logsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {logsExpanded && (
                  <textarea
                    readOnly value={vpn.serviceLogs} rows={8}
                    className="w-full p-3 text-[12px] font-mono resize-none focus:outline-none border-t border-[var(--app-border)]"
                    style={{ color: 'var(--app-text-1)', background: 'var(--app-bg)' }}
                  />
                )}
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>

      <Dialog open={configDialog.open} onOpenChange={(open) => setConfigDialog(prev => ({ ...prev, open }))}>
        <DialogContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Shield size={16} style={{ color: 'var(--app-accent)' }} />
              Configure VPN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <AppButton variant={configDialog.mode === 'upload' ? 'default' : 'outline'} onClick={() => setConfigDialog(prev => ({ ...prev, mode: 'upload' }))}>
                <Upload size={13} /> Upload File
              </AppButton>
              <AppButton variant={configDialog.mode === 'url' ? 'default' : 'outline'} onClick={() => setConfigDialog(prev => ({ ...prev, mode: 'url' }))}>
                From URL
              </AppButton>
            </div>
            {configDialog.mode === 'upload' ? (
              <div>
                <label className="flex flex-col items-center justify-center w-full py-8 border-2 border-dashed rounded-md cursor-pointer transition-colors border-[var(--app-border)] hover:border-[var(--app-accent)]">
                  <Upload size={20} className="mb-2" style={{ color: 'var(--app-text-3)' }} />
                  <span className="text-[13px]" style={{ color: configDialog.fileName ? 'var(--app-accent)' : 'var(--app-text-2)' }}>
                    {configDialog.fileName || 'Choose .ovpn file'}
                  </span>
                  <input type="file" className="hidden" accept=".ovpn,.conf" onChange={handleFileSelect} />
                </label>
                {configDialog.fileName && (
                  <p className="text-[12px] mt-1" style={{ color: 'var(--app-text-3)' }}>
                    File loaded: {configDialog.fileName} ({Math.round(configDialog.ovpnContent.length / 1024 * 10) / 10} KB)
                  </p>
                )}
              </div>
            ) : (
              <AppInput
                label="Configuration URL"
                value={configDialog.signedUrl}
                onChange={(e) => setConfigDialog(prev => ({ ...prev, signedUrl: e.target.value }))}
                helperText="Enter the signed URL for the VPN configuration file"
              />
            )}
            <AppInput
              label="Profile Name"
              value={configDialog.profileName}
              onChange={(e) => setConfigDialog(prev => ({ ...prev, profileName: e.target.value }))}
              helperText="Enter a name for this VPN profile"
            />
          </div>
          <DialogFooter className="gap-2">
            <AppButton variant="outline" onClick={() => setConfigDialog(prev => ({ ...prev, open: false }))}>Cancel</AppButton>
            <AppButton
              onClick={handleConfigSubmit}
              disabled={!configDialog.profileName || (configDialog.mode === 'upload' ? !configDialog.ovpnContent : !configDialog.signedUrl)}
            >
              Configure
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
