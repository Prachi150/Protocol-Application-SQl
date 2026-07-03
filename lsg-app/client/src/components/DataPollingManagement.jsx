import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Square, Download, RefreshCw, RotateCcw,
  Github, Trash2, ExternalLink, CheckCircle2, AlertCircle, Clock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getApiEndpoint, getProtocolEndpoint } from '../config/api';
import { useLayout } from './layout/Layout';
import {
  StatusBadge, AppAlert, AppButton, IconBtn, PageSpinner,
} from './ui/app-ui';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import ProtocolConfigDialog from './ProtocolConfigDialog';

const ANSI_FG = {
  '30': '#1e1e1e', '31': '#e06c75', '32': '#98c379', '33': '#e5c07b',
  '34': '#61afef', '35': '#c678dd', '36': '#56b6c2', '37': '#abb2bf',
  '90': '#5c6370', '91': '#e06c75', '92': '#98c379', '93': '#e5c07b',
  '94': '#61afef', '95': '#c678dd', '96': '#56b6c2', '97': '#ffffff',
};

const ANSI_RE = /\x1B\[([0-9;]*)m/g;

function AnsiLine({ text }) {
  const parts = [];
  let style = {};
  let last = 0;
  let match;
  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(text)) !== null) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), style: { ...style } });
    for (const code of match[1].split(';').map(Number)) {
      if (code === 0) style = {};
      else if (code === 1) style.fontWeight = 'bold';
      else if (ANSI_FG[String(code)]) style.color = ANSI_FG[String(code)];
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), style: { ...style } });
  return (
    <div style={{ color: '#d4d4d4', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.6, fontSize: 11 }}>
      {parts.map((p, i) => <span key={i} style={p.style}>{p.text}</span>)}
    </div>
  );
}

const DataPollingManagement = () => {
  const [protocols, setProtocols] = useState({});
  const [registry, setRegistry] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({
    open: false, title: '', message: '', action: null, protocolName: '', actionType: '',
  });
  const [configDialog, setConfigDialog] = useState({ open: false, protocol: null });
  const [logsDialog, setLogsDialog] = useState({ open: false, protocol: null, logs: '', loading: false });
  const [progressModal, setProgressModal] = useState({
    open: false, appName: '', mode: '', status: '', step: '', logs: [], error: '',
  });
  const pollRef = useRef(null);
  const logsEndRef = useRef(null);

  const { getAuthHeaders } = useAuth();
  const { registerRefresh } = useLayout();

  const fetchProtocols = useCallback(async () => {
    try {
      setRefreshing(true);
      const [protocolsRes, registryRes] = await Promise.all([
        fetch(getApiEndpoint('POLLING.PROTOCOLS'), { headers: getAuthHeaders() }),
        fetch(getApiEndpoint('REGISTRY.BASE'), { headers: getAuthHeaders() }),
      ]);
      const protocolsData = await protocolsRes.json();
      if (protocolsRes.ok) {
        setProtocols(protocolsData.protocols);
        setError(null);
      } else {
        setError(protocolsData.message || 'Failed to fetch protocols');
      }
      if (registryRes.ok) {
        const registryData = await registryRes.json();
        setRegistry(registryData.apps || {});
      }
    } catch (err) {
      setError('Error fetching protocols');
      console.error('Error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { fetchProtocols(); }, [fetchProtocols]);
  useEffect(() => { registerRefresh(fetchProtocols); }, [registerRefresh, fetchProtocols]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progressModal.logs]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const startInstallPolling = useCallback((protocolName) => {
    stopPolling();
    const doPoll = async () => {
      try {
        const res = await fetch(getProtocolEndpoint(protocolName, 'status'), { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.status === 'installing') {
          setProgressModal(prev => ({ ...prev, step: data.step || '', logs: data.logs || [] }));
        } else if (data.status === 'completed') {
          stopPolling();
          setProgressModal(prev => ({ ...prev, status: 'completed', step: 'finished', logs: data.logs || prev.logs }));
          setActionLoading(prev => ({ ...prev, [protocolName]: false }));
          fetchProtocols();
        } else if (data.status === 'failed') {
          stopPolling();
          setProgressModal(prev => ({ ...prev, status: 'failed', error: data.error || 'Installation failed', logs: data.logs || prev.logs }));
          setActionLoading(prev => ({ ...prev, [protocolName]: false }));
        }
      } catch { /* ignore poll errors */ }
    };
    doPoll();
    pollRef.current = setInterval(doPoll, 2000);
  }, [getAuthHeaders, fetchProtocols]);

  useEffect(() => {
    if (!progressModal.open || progressModal.status !== 'running') return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') startInstallPolling(progressModal.appName);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [progressModal.open, progressModal.status, progressModal.appName, startInstallPolling]);

  const startUninstallPolling = useCallback((protocolName) => {
    stopPolling();
    const doPoll = async () => {
      try {
        const res = await fetch(getProtocolEndpoint(protocolName, 'uninstall-status'), { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.status === 'uninstalling') {
          setProgressModal(prev => ({ ...prev, step: data.step || '', logs: data.logs || [] }));
        } else if (data.status === 'completed') {
          stopPolling();
          setProgressModal(prev => ({ ...prev, status: 'completed', step: 'finished', logs: data.logs || prev.logs }));
          setActionLoading(prev => ({ ...prev, [protocolName]: false }));
          fetchProtocols();
        } else if (data.status === 'failed') {
          stopPolling();
          setProgressModal(prev => ({ ...prev, status: 'failed', error: data.error || 'Uninstallation failed', logs: data.logs || prev.logs }));
          setActionLoading(prev => ({ ...prev, [protocolName]: false }));
        }
      } catch { /* ignore poll errors */ }
    };
    doPoll();
    pollRef.current = setInterval(doPoll, 2000);
  }, [getAuthHeaders, fetchProtocols]);

  const showSnackbar = (message, severity = 'success') => {
    setToast({ message, severity });
    setTimeout(() => setToast(null), 5000);
  };

  const handleConfirmAction = (protocolName, actionType) => {
    const actionMessages = {
      start:     { title: 'Start Protocol',     message: `Are you sure you want to start the ${protocolName} protocol?` },
      stop:      { title: 'Stop Protocol',      message: `Are you sure you want to stop the ${protocolName} protocol?` },
      restart:   { title: 'Restart Protocol',   message: `Are you sure you want to restart the ${protocolName} protocol?` },
      install:   { title: 'Install Protocol',   message: `Are you sure you want to install the ${protocolName} protocol?` },
      uninstall: { title: 'Uninstall Protocol', message: `Are you sure you want to uninstall the ${protocolName} protocol? This action cannot be undone.` },
    };
    setConfirmDialog({
      open: true,
      title: actionMessages[actionType].title,
      message: actionMessages[actionType].message,
      protocolName,
      actionType,
      action: () => handleProtocolAction(protocolName, actionType),
    });
  };

  const handleCloseConfirmDialog = () => setConfirmDialog(prev => ({ ...prev, open: false }));

  const handleConfirm = async () => {
    const { action } = confirmDialog;
    handleCloseConfirmDialog();
    if (action) await action();
  };

  const handleProtocolAction = async (protocolName, action) => {
    setActionLoading(prev => ({ ...prev, [protocolName]: true }));

    if (action === 'install') {
      setProgressModal({ open: true, appName: protocolName, mode: 'install', status: 'running', step: 'starting', logs: [], error: '' });
      let asyncInstall = false;
      try {
        const response = await fetch(getApiEndpoint('POLLING.INSTALL'), {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ protocol: protocolName, version: 'latest' }),
        });
        if (response.status === 202) {
          asyncInstall = true;
          startInstallPolling(protocolName);
          return;
        }
        const data = await response.json();
        stopPolling();
        if (response.ok) {
          setProgressModal(prev => ({ ...prev, status: 'completed', step: 'finished', logs: data.logs || prev.logs }));
          await fetchProtocols();
        } else {
          setProgressModal(prev => ({ ...prev, status: 'failed', error: data.error || 'Installation failed', logs: data.logs || prev.logs }));
        }
      } catch (err) {
        stopPolling();
        setProgressModal(prev => ({ ...prev, status: 'failed', error: err.message }));
      } finally {
        if (!asyncInstall) setActionLoading(prev => ({ ...prev, [protocolName]: false }));
      }
      return;
    }

    if (action === 'uninstall') {
      setProgressModal({ open: true, appName: protocolName, mode: 'uninstall', status: 'running', step: 'starting', logs: [], error: '' });
      try {
        const response = await fetch(getProtocolEndpoint(protocolName), {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
        if (response.status === 202) {
          startUninstallPolling(protocolName);
          return;
        }
        const data = await response.json();
        if (response.ok) {
          setProgressModal(prev => ({ ...prev, status: 'completed', step: 'finished', logs: prev.logs }));
          await fetchProtocols();
        } else {
          setProgressModal(prev => ({ ...prev, status: 'failed', error: data.error || 'Uninstall failed' }));
        }
      } catch (err) {
        setProgressModal(prev => ({ ...prev, status: 'failed', error: err.message }));
      } finally {
        setActionLoading(prev => ({ ...prev, [protocolName]: false }));
      }
      return;
    }

    try {
      const response = await fetch(getProtocolEndpoint(protocolName, action), {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const actionText = action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarted';
        showSnackbar(`Successfully ${actionText} ${protocolName} protocol app`);
        await fetchProtocols();
      } else {
        const data = await response.json();
        throw new Error(data.message || data.error || `Failed to ${action} protocol`);
      }
    } catch (err) {
      showSnackbar(err.message, 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [protocolName]: false }));
    }
  };

  const getStatusVariant = (protocol) => {
    if (protocol.running) return 'success';
    if (protocol.installed) return 'warning';
    return 'danger';
  };

  const getStatusText = (protocol) => {
    if (protocol.running) return 'Running';
    if (protocol.installed) return 'Stopped';
    return 'Not Installed';
  };

  const handleOpenLogs = async (protocolName) => {
    setLogsDialog({ open: true, protocol: protocolName, logs: '', loading: true });
    try {
      const response = await fetch(getProtocolEndpoint(protocolName, 'logs') + '?lines=100', {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      setLogsDialog(prev => ({ ...prev, logs: data.logs || 'No logs available', loading: false }));
    } catch (err) {
      setLogsDialog(prev => ({ ...prev, logs: 'Error fetching logs: ' + err.message, loading: false }));
    }
  };

  function formatUptime(isoString) {
    const secs = Math.floor((Date.now() - new Date(isoString)) / 1000);
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60) % 60;
    const h = Math.floor(secs / 3600) % 24;
    const d = Math.floor(secs / 86400);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  const renderProtocolCard = (name, protocol) => {
    const regEntry = protocol.registry || registry[protocol.appName] || null;
    const isLoading = actionLoading[name];

    return (
      <div
        key={name}
        className="rounded-md border border-[var(--app-border)] p-4 flex flex-col gap-3"
        style={{ background: 'var(--app-surface)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[14px] font-semibold leading-snug" style={{ color: 'var(--app-text-1)' }}>
            {regEntry?.displayName || protocol.appName}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {regEntry?.version && <StatusBadge variant="accent">v{regEntry.version}</StatusBadge>}
            <StatusBadge variant={getStatusVariant(protocol)} dot>
              {getStatusText(protocol)}
            </StatusBadge>
          </div>
        </div>

        {/* Description */}
        {protocol.description && (
          <p className="text-[12.5px]" style={{ color: 'var(--app-text-2)' }}>
            {protocol.description}
          </p>
        )}

        {/* Tags */}
        <div className="flex items-center gap-2 flex-wrap">
          {regEntry?.runtime && <StatusBadge variant="neutral">{regEntry.runtime}</StatusBadge>}
          {regEntry?.port && (
            <StatusBadge variant="neutral">:{regEntry.port}</StatusBadge>
          )}
          {protocol.running && regEntry?.startedAt && (
            <StatusBadge variant="success">
              <Clock size={11} />
              {formatUptime(regEntry.startedAt)}
            </StatusBadge>
          )}
        </div>

        {/* Repo */}
        {protocol.repo && (
          <div className="flex items-center gap-1.5">
            <Github size={12} style={{ color: 'var(--app-text-3)' }} />
            <span className="text-[12px] font-mono truncate" style={{ color: 'var(--app-text-2)' }}>
              {protocol.repo}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-1 mt-auto pt-3 border-t border-[var(--app-border)]">
          {regEntry?.uiEnabled && regEntry?.uiPath && (
            <IconBtn title={`Open ${regEntry.displayName || protocol.appName} UI`} onClick={() => window.open(regEntry.uiPath, '_blank', 'noopener,noreferrer')}>
              <ExternalLink size={13} />
            </IconBtn>
          )}

          {protocol.installed ? (
            <>
              {protocol.running ? (
                <IconBtn variant="danger" title="Stop Protocol" disabled={isLoading} onClick={() => handleConfirmAction(name, 'stop')}>
                  {isLoading ? <RefreshCw size={13} className="animate-spin" /> : <Square size={13} />}
                </IconBtn>
              ) : (
                <IconBtn variant="success" title="Start Protocol" disabled={isLoading} onClick={() => handleConfirmAction(name, 'start')}>
                  {isLoading ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                </IconBtn>
              )}
              <IconBtn variant="warning" title="Restart Protocol" disabled={isLoading} onClick={() => handleConfirmAction(name, 'restart')}>
                <RotateCcw size={13} />
              </IconBtn>
              <IconBtn variant="danger" title="Uninstall Protocol" disabled={isLoading} onClick={() => handleConfirmAction(name, 'uninstall')}>
                <Trash2 size={13} />
              </IconBtn>
            </>
          ) : (
            <IconBtn title="Install Protocol" disabled={isLoading} onClick={() => handleConfirmAction(name, 'install')}>
              {isLoading ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
            </IconBtn>
          )}
        </div>
      </div>
    );
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      {error && <AppAlert severity="error">{error}</AppAlert>}
      {toast && <AppAlert severity={toast.severity}>{toast.message}</AppAlert>}

      {Object.keys(protocols).length === 0 ? (
        <p className="text-[13px] italic text-center py-8" style={{ color: 'var(--app-text-3)' }}>
          No protocol apps available.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(protocols).map(([name, protocol]) => renderProtocolCard(name, protocol))}
        </div>
      )}

      {/* Confirm Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => !open && handleCloseConfirmDialog()}>
        <DialogContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}>
          <DialogHeader>
            <DialogTitle className="text-[15px]">{confirmDialog.title}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] py-2" style={{ color: 'var(--app-text-2)' }}>
            {confirmDialog.message}
          </p>
          <DialogFooter className="gap-2">
            <AppButton variant="outline" onClick={handleCloseConfirmDialog}>Cancel</AppButton>
            <AppButton onClick={handleConfirm}>Confirm</AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs Dialog */}
      <Dialog open={logsDialog.open} onOpenChange={(open) => !open && setLogsDialog(prev => ({ ...prev, open: false }))}>
        <DialogContent
          className="max-w-2xl"
          style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}
        >
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[15px]">Logs — {logsDialog.protocol}</DialogTitle>
              <AppButton variant="outline" onClick={() => logsDialog.protocol && handleOpenLogs(logsDialog.protocol)} disabled={logsDialog.loading}>
                <RefreshCw size={13} className={logsDialog.loading ? 'animate-spin' : ''} />
                Refresh
              </AppButton>
            </div>
          </DialogHeader>
          {logsDialog.loading ? (
            <div className="flex justify-center py-8">
              <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--app-text-3)' }} />
            </div>
          ) : (
            <pre
              className="rounded-md p-3 overflow-auto max-h-96 text-[12px] font-mono whitespace-pre-wrap break-all"
              style={{ background: '#1e1e1e', color: '#d4d4d4' }}
            >
              {logsDialog.logs}
            </pre>
          )}
          <DialogFooter>
            <AppButton variant="outline" onClick={() => setLogsDialog(prev => ({ ...prev, open: false }))}>
              Close
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProtocolConfigDialog
        open={configDialog.open}
        onClose={() => setConfigDialog({ open: false, protocol: null })}
        protocol={configDialog.protocol}
        getAuthHeaders={getAuthHeaders}
      />

      {/* Install / Uninstall progress modal */}
      <Dialog
        open={progressModal.open}
        onOpenChange={(open) => {
          if (!open && progressModal.status !== 'running') {
            stopPolling();
            setProgressModal(prev => ({ ...prev, open: false }));
          }
        }}
      >
        <DialogContent
          className="max-w-2xl"
          style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              {progressModal.status === 'running' && <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--app-accent)' }} />}
              {progressModal.status === 'completed' && <CheckCircle2 size={16} style={{ color: 'var(--app-success)' }} />}
              {progressModal.status === 'failed' && <AlertCircle size={16} style={{ color: 'var(--app-danger)' }} />}
              {progressModal.mode === 'install' ? 'Installing' : 'Uninstalling'} {progressModal.appName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {progressModal.step && progressModal.status === 'running' && (
              <StatusBadge variant="accent">{progressModal.step.replace(/_/g, ' ')}</StatusBadge>
            )}
            {progressModal.status === 'failed' && progressModal.error && (
              <AppAlert severity="error">{progressModal.error}</AppAlert>
            )}
            {progressModal.status === 'completed' && (
              <AppAlert severity="success">
                {progressModal.mode === 'install' ? 'Installation' : 'Uninstallation'} completed successfully.
              </AppAlert>
            )}
            <div
              className="rounded-md border border-[var(--app-border)] p-3 max-h-96 overflow-y-auto"
              style={{ background: '#1e1e1e' }}
            >
              {progressModal.logs.length === 0 ? (
                <p className="text-[12px] font-mono" style={{ color: '#5c6370' }}>
                  {progressModal.status === 'running' ? 'Waiting for output…' : 'No output captured.'}
                </p>
              ) : (
                progressModal.logs.map((line, i) => <AnsiLine key={i} text={line} />)
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

          <DialogFooter>
            <AppButton
              variant="outline"
              onClick={() => { stopPolling(); setProgressModal(prev => ({ ...prev, open: false })); }}
              disabled={progressModal.status === 'running'}
            >
              Close
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataPollingManagement;
