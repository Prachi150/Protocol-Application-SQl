import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Clock, Power, Upload, RefreshCw, ChevronDown, ChevronUp, Trash2, Edit2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';
import { useLayout } from '../layout/Layout';
import {
  Panel, PanelHeader, PanelBody, DataRow, MonoValue,
  StatusBadge, AppAlert, AppButton, AppInput, IconBtn,
} from '../ui/app-ui';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select as RadixSelect,
  SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import TimeConfigurationDialog from './TimeConfigurationDialog';

const toDatetimeLocal = (date = new Date()) => {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const nativeInputCls = [
  'w-full h-9 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)]',
  'px-3 text-[13px] text-[var(--app-text-1)]',
  'focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

const RemoteManagement = () => {
  const { getAuthHeaders } = useAuth();
  const { registerRefresh } = useLayout();

  const [timeSettingsLoading, setTimeSettingsLoading] = useState(true);
  const [vpnStatusLoading, setVpnStatusLoading] = useState(true);
  const [restartSchedulesLoading, setRestartSchedulesLoading] = useState(true);

  const [timeSettings, setTimeSettings] = useState(null);
  const [availableTimezones, setAvailableTimezones] = useState([]);
  const [restartSchedules, setRestartSchedules] = useState({ oneTime: [], recurring: [] });
  const [openRestartDialog, setOpenRestartDialog] = useState(false);
  const [restartType, setRestartType] = useState('immediate');
  const [scheduledDateTime, setScheduledDateTime] = useState(() => toDatetimeLocal());
  const [allowActiveUsers, setAllowActiveUsers] = useState(false);
  const [recurringScheduleType, setRecurringScheduleType] = useState('daily');
  const [dailyTime, setDailyTime] = useState('22:00');
  const [weeklyDay, setWeeklyDay] = useState('1');
  const [weeklyTime, setWeeklyTime] = useState('22:00');
  const [toast, setToast] = useState(null);
  const [vpnSettings, setVpnSettings] = useState({
    isEnabled: false,
    hasProfile: false,
    profileName: null,
    lastConnected: null,
    globalRouting: false,
    routingInfo: { hasRoutePull: false, message: '' },
    serviceStatus: '',
    serviceLogs: '',
    configPermissions: { permissions: '', ownership: '' },
    vpnIp: null,
  });
  const [vpnConfigDialog, setVpnConfigDialog] = useState({
    open: false, signedUrl: '', profileName: '', mode: 'upload', ovpnContent: '', fileName: '',
  });
  const [timeDialogOpen, setTimeDialogOpen] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);

  const vpnPollingIntervalRef = useRef(null);

  const resetScheduleForm = () => {
    setRestartType('immediate');
    setScheduledDateTime(toDatetimeLocal());
    setAllowActiveUsers(false);
    setRecurringScheduleType('daily');
    setDailyTime('22:00');
    setWeeklyTime('22:00');
    setWeeklyDay('1');
  };

  const showSnackbar = useCallback((message, severity = 'success') => {
    setToast({ message, severity });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const fetchTimeSettings = useCallback(async () => {
    try {
      setTimeSettingsLoading(true);
      const response = await fetch(getApiEndpoint('REMOTE.TIME'), { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch time settings');
      const data = await response.json();
      setTimeSettings(data);
    } catch (error) {
      showSnackbar(error.message, 'error');
    } finally {
      setTimeSettingsLoading(false);
    }
  }, [getAuthHeaders, showSnackbar]);

  const fetchTimezones = useCallback(async () => {
    try {
      const response = await fetch(getApiEndpoint('REMOTE.TIME_ZONES'), { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch timezones');
      const data = await response.json();
      setAvailableTimezones(data.timezones);
    } catch (error) {
      showSnackbar(error.message, 'error');
    }
  }, [getAuthHeaders, showSnackbar]);

  const fetchRestartSchedules = useCallback(async () => {
    try {
      setRestartSchedulesLoading(true);
      const response = await fetch(getApiEndpoint('REMOTE.RESTART'), { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch restart schedules');
      const data = await response.json();
      setRestartSchedules(data);
    } catch (error) {
      showSnackbar(error.message, 'error');
    } finally {
      setRestartSchedulesLoading(false);
    }
  }, [getAuthHeaders, showSnackbar]);

  const fetchVpnStatus = useCallback(async () => {
    try {
      setVpnStatusLoading(true);
      const response = await fetch(getApiEndpoint('REMOTE.VPN.STATUS'), { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Failed to fetch VPN status');
      const data = await response.json();
      setVpnSettings(prev => ({ ...prev, ...data }));
    } catch (error) {
      showSnackbar(error.message, 'error');
    } finally {
      setVpnStatusLoading(false);
    }
  }, [getAuthHeaders, showSnackbar]);

  const refreshAll = useCallback(() => {
    fetchTimeSettings();
    fetchVpnStatus();
    fetchRestartSchedules();
  }, [fetchTimeSettings, fetchVpnStatus, fetchRestartSchedules]);

  useEffect(() => {
    fetchTimeSettings();
    fetchVpnStatus();
  }, [fetchTimeSettings, fetchVpnStatus]);

  useEffect(() => {
    fetchTimezones();
    fetchRestartSchedules();
  }, [fetchTimezones, fetchRestartSchedules]);

  useEffect(() => { registerRefresh(refreshAll); }, [registerRefresh, refreshAll]);

  useEffect(() => {
    return () => {
      if (vpnPollingIntervalRef.current) {
        clearInterval(vpnPollingIntervalRef.current);
        vpnPollingIntervalRef.current = null;
      }
    };
  }, []);

  const handleTimeSettingsUpdate = async (settings) => {
    try {
      const response = await fetch(getApiEndpoint('REMOTE.TIME'), {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datetime: settings.datetime || timeSettings?.datetime,
          timezone: settings.timezone || timeSettings?.timezone,
          ntp: {
            enabled: settings.ntp?.enabled ?? timeSettings?.ntp?.enabled ?? false,
            servers: settings.ntp?.servers || timeSettings?.ntp?.servers || [],
          },
        }),
      });
      if (!response.ok) throw new Error('Failed to update time settings');
      showSnackbar('Time settings updated successfully');
      fetchTimeSettings();
    } catch (error) {
      showSnackbar(error.message, 'error');
    }
  };

  const handleVpnToggle = async () => {
    try {
      if (vpnPollingIntervalRef.current) {
        clearInterval(vpnPollingIntervalRef.current);
        vpnPollingIntervalRef.current = null;
      }
      const response = await fetch(getApiEndpoint('REMOTE.VPN.TOGGLE'), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: !vpnSettings.isEnabled }),
      });
      if (!response.ok) throw new Error('Failed to toggle VPN');
      showSnackbar(`VPN ${!vpnSettings.isEnabled ? 'enabled' : 'disabled'} successfully`);
      await fetchVpnStatus();
      if (!vpnSettings.isEnabled) {
        let count = 0;
        vpnPollingIntervalRef.current = setInterval(async () => {
          count++;
          await fetchVpnStatus();
          if (count >= 6) {
            clearInterval(vpnPollingIntervalRef.current);
            vpnPollingIntervalRef.current = null;
          }
        }, 5000);
      }
    } catch (error) {
      showSnackbar(error.message, 'error');
    }
  };

  const handleVpnFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      setVpnConfigDialog(prev => ({
        ...prev,
        ovpnContent: content,
        fileName: file.name,
        profileName: prev.profileName || file.name.replace(/\.ovpn$/i, ''),
      }));
    };
    reader.readAsText(file);
  };

  const handleVpnConfigSubmit = async () => {
    try {
      const isUpload = vpnConfigDialog.mode === 'upload';
      const endpoint = isUpload ? getApiEndpoint('REMOTE.VPN.UPLOAD') : getApiEndpoint('REMOTE.VPN.CONFIG');
      const payload = isUpload
        ? { ovpnContent: vpnConfigDialog.ovpnContent, profileName: vpnConfigDialog.profileName }
        : { signedUrl: vpnConfigDialog.signedUrl, profileName: vpnConfigDialog.profileName };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to configure VPN');
      }
      showSnackbar('VPN profile configured successfully');
      setVpnConfigDialog({ open: false, signedUrl: '', profileName: '', mode: 'upload', ovpnContent: '', fileName: '' });
      await fetchVpnStatus();
    } catch (error) {
      showSnackbar(error.message, 'error');
    }
  };

  const handleRestartSubmit = async () => {
    try {
      const payload = { type: restartType };
      switch (restartType) {
        case 'immediate':
          payload.force = true;
          break;
        case 'scheduled':
          payload.datetime = new Date(scheduledDateTime).toISOString();
          payload.allowActiveUsers = allowActiveUsers;
          break;
        case 'recurring': {
          const scheduleValue = recurringScheduleType === 'daily'
            ? dailyTime
            : `${weeklyDay}@${weeklyTime}`;
          payload.schedule = { type: recurringScheduleType, value: scheduleValue };
          break;
        }
        default:
          throw new Error('Invalid restart type');
      }
      const response = await fetch(getApiEndpoint('REMOTE.RESTART'), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed to schedule restart');
      showSnackbar('Restart scheduled successfully');
      setOpenRestartDialog(false);
      resetScheduleForm();
      fetchRestartSchedules();
    } catch (error) {
      showSnackbar(error.message, 'error');
    }
  };

  const handleCancelRestart = async (id) => {
    try {
      const response = await fetch(getApiEndpoint('REMOTE.RESTART') + `/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error('Failed to cancel restart');
      showSnackbar('Restart cancelled successfully');
      fetchRestartSchedules();
    } catch (error) {
      showSnackbar(error.message, 'error');
    }
  };

  const getVpnStatusFromServiceStatus = (serviceStatus) => {
    if (!serviceStatus) return 'disconnected';
    if (serviceStatus.includes('Active: active (running)')) {
      if (serviceStatus.includes('Initialization Sequence Completed')) return 'connected';
      return 'connecting';
    }
    if (serviceStatus.includes('Active: inactive')) return 'disconnected';
    if (serviceStatus.includes('Active: failed')) return 'error';
    return 'unknown';
  };

  const handleGlobalRoutingToggle = async () => {
    const isCurrentlyEnabled = !vpnSettings.routingInfo?.message?.toLowerCase().includes('disabled');
    try {
      const response = await fetch(getApiEndpoint('REMOTE.VPN.ROUTING'), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: !isCurrentlyEnabled }),
      });
      if (!response.ok) throw new Error('Failed to update global routing');
      showSnackbar(`Global routing ${!isCurrentlyEnabled ? 'enabled' : 'disabled'} successfully`);
      await fetchVpnStatus();
    } catch (error) {
      showSnackbar(error.message, 'error');
    }
  };

  const formatCurrentTime = () => {
    if (!timeSettings?.datetime) return 'Loading...';
    return new Date(timeSettings.datetime).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  const formatDateTime = (dateTime) => {
    if (!dateTime) return 'N/A';
    return new Date(dateTime).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  const formatRecurringSchedule = (type, value) => {
    if (!type || !value) return 'Invalid schedule';
    try {
      switch (type.toLowerCase()) {
        case 'daily': {
          const [h, m] = value.split(':').map(Number);
          const t = new Date(); t.setHours(h, m, 0, 0);
          return `Daily – ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
        }
        case 'weekly': {
          const parts = value.split(/[@\s]+/);
          if (parts.length >= 2) {
            const dayNum = parseInt(parts[0]);
            const [wh, wm] = parts[1].split(':').map(Number);
            const wt = new Date(); wt.setHours(wh, wm, 0, 0);
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return `Weekly on ${days[dayNum] ?? `Day ${dayNum}`} – ${wt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
          }
          return `Weekly – ${value}`;
        }
        default:
          return `${type} – ${value}`;
      }
    } catch {
      return `${type} – ${value}`;
    }
  };

  const vpnStatus = getVpnStatusFromServiceStatus(vpnSettings.serviceStatus);
  const vpnVariant = vpnStatus === 'connected' ? 'success' : vpnStatus === 'connecting' ? 'warning' : vpnStatus === 'error' ? 'danger' : 'default';
  const isConnecting = vpnStatus === 'connecting';

  return (
    <div className="space-y-4">
      {toast && (
        <AppAlert severity={toast.severity} className="mb-2">
          {toast.message}
        </AppAlert>
      )}

      {/* VPN Management */}
      <Panel>
        <PanelHeader
          icon={Shield}
          iconColor="accent"
          title="VPN Management"
          subtitle={
            vpnStatusLoading
              ? 'Loading...'
              : <StatusBadge variant={vpnVariant} dot>{vpnStatus.charAt(0).toUpperCase() + vpnStatus.slice(1)}</StatusBadge>
          }
          right={
            <AppButton
              variant="outline"
              onClick={() => setVpnConfigDialog({ open: true, signedUrl: '', profileName: '', mode: 'upload', ovpnContent: '', fileName: '' })}
              disabled={vpnStatusLoading}
            >
              <Upload size={13} />
              Configure VPN
            </AppButton>
          }
        />
        <PanelBody>
          {vpnStatusLoading ? (
            <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>Loading VPN status…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Connection Settings */}
                <div className="rounded-md border border-[var(--app-border)] p-3 space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>
                    Connection Settings
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Enable VPN</span>
                    <Switch
                      checked={vpnSettings.isEnabled}
                      onCheckedChange={handleVpnToggle}
                      disabled={!vpnSettings.hasProfile || isConnecting}
                    />
                  </div>
                  {vpnSettings.hasProfile && (
                    <div className="flex items-center justify-between">
                      <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Global Routing</span>
                      <Switch
                        checked={!vpnSettings.routingInfo?.message?.toLowerCase().includes('disabled')}
                        onCheckedChange={handleGlobalRoutingToggle}
                        disabled={!vpnSettings.isEnabled}
                      />
                    </div>
                  )}
                </div>

                {/* Connection Details */}
                <div className="rounded-md border border-[var(--app-border)] p-3 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>
                    Connection Details
                  </p>
                  {vpnSettings.hasProfile && (
                    <DataRow label="Profile">
                      <MonoValue>{vpnSettings.profileName || 'client.ovpn'}</MonoValue>
                    </DataRow>
                  )}
                  {vpnSettings.routingInfo?.message && (
                    <DataRow label="Routing">
                      <span className="text-[13px] text-right" style={{ color: 'var(--app-text-1)' }}>
                        {vpnSettings.routingInfo.message}
                      </span>
                    </DataRow>
                  )}
                  {vpnStatus === 'connected' && (
                    <DataRow label="VPN IP" last>
                      <MonoValue>{vpnSettings.vpnIp || 'N/A'}</MonoValue>
                    </DataRow>
                  )}
                  {!vpnSettings.hasProfile && (
                    <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>No profile configured.</p>
                  )}
                </div>
              </div>

              {/* Service Logs accordion */}
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
                    readOnly
                    value={vpnSettings.serviceLogs}
                    rows={8}
                    className="w-full p-3 text-[12px] font-mono resize-none focus:outline-none border-t border-[var(--app-border)]"
                    style={{ color: 'var(--app-text-1)', background: 'var(--app-bg)' }}
                  />
                )}
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* System Time Settings */}
      <Panel>
        <PanelHeader
          icon={Clock}
          iconColor="accent"
          title="System Time Settings"
          right={
            <div className="flex items-center gap-2">
              <AppButton variant="ghost" onClick={fetchTimeSettings} disabled={timeSettingsLoading}>
                <RefreshCw size={13} className={timeSettingsLoading ? 'animate-spin' : ''} />
              </AppButton>
              <AppButton variant="outline" onClick={() => setTimeDialogOpen(true)} disabled={timeSettingsLoading}>
                <Edit2 size={13} />
                Configure
              </AppButton>
            </div>
          }
        />
        <PanelBody>
          {timeSettingsLoading ? (
            <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>Loading time settings…</p>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                <p className="text-[11px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--app-text-3)' }}>
                  Current System Time
                </p>
                <p className="text-[15px] font-mono font-semibold" style={{ color: 'var(--app-text-1)' }}>
                  {formatCurrentTime()}
                </p>
                <p className="text-[12px] mt-1" style={{ color: 'var(--app-text-2)' }}>
                  Timezone: {timeSettings?.timezone || 'Not configured'}
                </p>
              </div>
              <DataRow label="NTP Status">
                <StatusBadge variant={timeSettings?.ntp?.enabled ? 'success' : 'danger'} dot>
                  {timeSettings?.ntp?.enabled ? 'Enabled' : 'Disabled'}
                </StatusBadge>
              </DataRow>
              {timeSettings?.ntp?.enabled && timeSettings.ntp.servers?.length > 0 && (
                <DataRow label="NTP Servers" last>
                  <MonoValue className="text-right text-[12px] break-all">{timeSettings.ntp.servers.join(', ')}</MonoValue>
                </DataRow>
              )}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* System Restart Management */}
      <Panel>
        <PanelHeader
          icon={Power}
          iconColor="accent"
          title="System Restart Management"
          subtitle="Schedule system restarts"
          right={
            <AppButton
              variant="outline"
              onClick={() => { resetScheduleForm(); setOpenRestartDialog(true); }}
              disabled={restartSchedulesLoading}
            >
              <Clock size={13} />
              Schedule Restart
            </AppButton>
          }
        />
        <PanelBody>
          {restartSchedulesLoading ? (
            <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>Loading schedules…</p>
          ) : (
            <div className="space-y-5">
              {/* One-time restarts */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--app-text-3)' }}>
                  Scheduled One-time Restarts
                </p>
                {restartSchedules.oneTime.length > 0 ? (
                  <div className="space-y-2">
                    {restartSchedules.oneTime.map((schedule) => (
                      <div key={schedule.id} className="flex items-start justify-between p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>One-time Restart</span>
                            <StatusBadge variant="accent">One-time</StatusBadge>
                          </div>
                          <p className="text-[12px]" style={{ color: 'var(--app-text-1)' }}>
                            Scheduled: {formatDateTime(schedule.datetime)}
                          </p>
                          <p className="text-[12px]" style={{ color: 'var(--app-text-2)' }}>
                            Allow Active Users: {schedule.allowActiveUsers ? 'Yes' : 'No'}
                          </p>
                        </div>
                        <IconBtn onClick={() => handleCancelRestart(schedule.id)} variant="danger">
                          <Trash2 size={13} />
                        </IconBtn>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] italic text-center py-3" style={{ color: 'var(--app-text-3)' }}>
                    No one-time restarts scheduled.
                  </p>
                )}
              </div>

              {/* Recurring restarts */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--app-text-3)' }}>
                  Recurring Restart Schedules
                </p>
                {restartSchedules.recurring.length > 0 ? (
                  <div className="space-y-2">
                    {restartSchedules.recurring.map((schedule) => (
                      <div key={schedule.id} className="flex items-start justify-between p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>Recurring Restart</span>
                            <StatusBadge variant="warning">Recurring</StatusBadge>
                          </div>
                          <p className="text-[12px]" style={{ color: 'var(--app-text-1)' }}>
                            {formatRecurringSchedule(schedule.type, schedule.value)}
                          </p>
                        </div>
                        <IconBtn onClick={() => handleCancelRestart(schedule.id)} variant="danger">
                          <Trash2 size={13} />
                        </IconBtn>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] italic text-center py-3" style={{ color: 'var(--app-text-3)' }}>
                    No recurring restart schedules configured.
                  </p>
                )}
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* Restart Schedule Dialog */}
      <Dialog open={openRestartDialog} onOpenChange={setOpenRestartDialog}>
        <DialogContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Clock size={16} style={{ color: 'var(--app-accent)' }} />
              Schedule System Restart
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                Restart Type
              </label>
              <RadixSelect value={restartType} onValueChange={setRestartType}>
                <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                  <SelectItem value="immediate" className="text-[13px]">Immediate</SelectItem>
                  <SelectItem value="scheduled" className="text-[13px]">Scheduled One-time</SelectItem>
                  <SelectItem value="recurring" className="text-[13px]">Recurring</SelectItem>
                </SelectContent>
              </RadixSelect>
            </div>

            {restartType === 'scheduled' && (
              <div className="space-y-3 p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                <div>
                  <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                    Restart Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    className={nativeInputCls}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Allow Active Users</span>
                  <Switch checked={allowActiveUsers} onCheckedChange={setAllowActiveUsers} />
                </div>
              </div>
            )}

            {restartType === 'recurring' && (
              <div className="space-y-3 p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                <div>
                  <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                    Schedule Type
                  </label>
                  <RadixSelect value={recurringScheduleType} onValueChange={setRecurringScheduleType}>
                    <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                      <SelectItem value="daily" className="text-[13px]">Daily</SelectItem>
                      <SelectItem value="weekly" className="text-[13px]">Weekly</SelectItem>
                    </SelectContent>
                  </RadixSelect>
                </div>

                {recurringScheduleType === 'daily' && (
                  <div>
                    <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                      Restart Time
                    </label>
                    <input
                      type="time"
                      value={dailyTime}
                      onChange={(e) => setDailyTime(e.target.value)}
                      className={nativeInputCls}
                    />
                  </div>
                )}

                {recurringScheduleType === 'weekly' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                        Day of Week
                      </label>
                      <RadixSelect value={weeklyDay} onValueChange={setWeeklyDay}>
                        <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => (
                            <SelectItem key={i} value={String(i)} className="text-[13px]">{day}</SelectItem>
                          ))}
                        </SelectContent>
                      </RadixSelect>
                    </div>
                    <div>
                      <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                        Restart Time
                      </label>
                      <input
                        type="time"
                        value={weeklyTime}
                        onChange={(e) => setWeeklyTime(e.target.value)}
                        className={nativeInputCls}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <AppButton variant="outline" onClick={() => setOpenRestartDialog(false)}>Cancel</AppButton>
            <AppButton onClick={handleRestartSubmit}>Schedule Restart</AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VPN Config Dialog */}
      <Dialog
        open={vpnConfigDialog.open}
        onOpenChange={(open) => setVpnConfigDialog(prev => ({ ...prev, open }))}
      >
        <DialogContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Shield size={16} style={{ color: 'var(--app-accent)' }} />
              Configure VPN
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <AppButton
                variant={vpnConfigDialog.mode === 'upload' ? 'default' : 'outline'}
                onClick={() => setVpnConfigDialog(prev => ({ ...prev, mode: 'upload' }))}
              >
                <Upload size={13} />
                Upload File
              </AppButton>
              <AppButton
                variant={vpnConfigDialog.mode === 'url' ? 'default' : 'outline'}
                onClick={() => setVpnConfigDialog(prev => ({ ...prev, mode: 'url' }))}
              >
                From URL
              </AppButton>
            </div>

            {vpnConfigDialog.mode === 'upload' ? (
              <div>
                <label className="flex flex-col items-center justify-center w-full py-8 border-2 border-dashed rounded-md cursor-pointer transition-colors border-[var(--app-border)] hover:border-[var(--app-accent)]">
                  <Upload size={20} className="mb-2" style={{ color: 'var(--app-text-3)' }} />
                  <span className="text-[13px]" style={{ color: vpnConfigDialog.fileName ? 'var(--app-accent)' : 'var(--app-text-2)' }}>
                    {vpnConfigDialog.fileName || 'Choose .ovpn file'}
                  </span>
                  <input type="file" className="hidden" accept=".ovpn,.conf" onChange={handleVpnFileSelect} />
                </label>
                {vpnConfigDialog.fileName && (
                  <p className="text-[12px] mt-1" style={{ color: 'var(--app-text-3)' }}>
                    File loaded: {vpnConfigDialog.fileName} ({Math.round(vpnConfigDialog.ovpnContent.length / 1024 * 10) / 10} KB)
                  </p>
                )}
              </div>
            ) : (
              <AppInput
                label="Configuration URL"
                value={vpnConfigDialog.signedUrl}
                onChange={(e) => setVpnConfigDialog(prev => ({ ...prev, signedUrl: e.target.value }))}
                helperText="Enter the signed URL for the VPN configuration file"
              />
            )}

            <AppInput
              label="Profile Name"
              value={vpnConfigDialog.profileName}
              onChange={(e) => setVpnConfigDialog(prev => ({ ...prev, profileName: e.target.value }))}
              helperText="Enter a name for this VPN profile"
            />
          </div>

          <DialogFooter className="gap-2">
            <AppButton variant="outline" onClick={() => setVpnConfigDialog(prev => ({ ...prev, open: false }))}>
              Cancel
            </AppButton>
            <AppButton
              onClick={handleVpnConfigSubmit}
              disabled={
                !vpnConfigDialog.profileName ||
                (vpnConfigDialog.mode === 'upload' ? !vpnConfigDialog.ovpnContent : !vpnConfigDialog.signedUrl)
              }
            >
              Configure
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Time Configuration Dialog */}
      <TimeConfigurationDialog
        open={timeDialogOpen}
        onClose={() => setTimeDialogOpen(false)}
        timeSettings={timeSettings}
        availableTimezones={availableTimezones}
        onTimeSettingsUpdate={handleTimeSettingsUpdate}
        onFetchTimeSettings={fetchTimeSettings}
      />
    </div>
  );
};

export default RemoteManagement;
