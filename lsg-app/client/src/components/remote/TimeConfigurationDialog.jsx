import React, { useState, useEffect } from 'react';
import { Clock, CloudLightning, CalendarDays, Minus, Plus } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  Select as RadixSelect,
  SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AppButton, AppInput, MonoValue, StatusBadge, DataRow } from '../ui/app-ui';

const inputCls = [
  'w-full h-9 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)]',
  'px-3 text-[13px] text-[var(--app-text-1)]',
  'focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]',
].join(' ');

const toDateInput = (date) => {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const toTimeInput = (date) => {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const TimeConfigurationDialog = ({
  open,
  onClose,
  timeSettings,
  availableTimezones,
  onTimeSettingsUpdate,
  onFetchTimeSettings,
}) => {
  const [localSettings, setLocalSettings] = useState({
    timezone: '',
    ntpEnabled: false,
    ntpServers: [],
    manualDateTime: new Date(),
    isManualTime: false,
  });

  useEffect(() => {
    if (timeSettings) {
      setLocalSettings({
        timezone: timeSettings.timezone || '',
        ntpEnabled: timeSettings.ntp?.enabled || false,
        ntpServers: timeSettings.ntp?.servers || [],
        manualDateTime: timeSettings.datetime ? new Date(timeSettings.datetime) : new Date(),
        isManualTime: false,
      });
    }
  }, [timeSettings, open]);

  const handleLocalChange = (field, value) => {
    setLocalSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleNtpServersChange = (serverString) => {
    const servers = serverString.split(',').map(s => s.trim()).filter(Boolean);
    handleLocalChange('ntpServers', servers);
  };

  const adjustDateTime = (field, delta) => {
    const newDate = new Date(localSettings.manualDateTime);
    if (field === 'hours') newDate.setHours(newDate.getHours() + delta);
    if (field === 'minutes') newDate.setMinutes(newDate.getMinutes() + delta);
    handleLocalChange('manualDateTime', newDate);
  };

  const handleSave = async () => {
    try {
      const updatePayload = {
        timezone: localSettings.timezone,
        ntp: { enabled: localSettings.ntpEnabled, servers: localSettings.ntpServers },
      };
      if (localSettings.isManualTime) {
        updatePayload.datetime = localSettings.manualDateTime.toISOString();
      }
      await onTimeSettingsUpdate(updatePayload);
      onClose();
      setTimeout(() => onFetchTimeSettings(), 1000);
    } catch (error) {
      console.error('Failed to save time settings:', error);
    }
  };

  const formatCurrentTime = () => {
    if (!timeSettings?.datetime) return 'Loading...';
    return new Date(timeSettings.datetime).toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}
      >
        <DialogHeader className="pb-3 border-b border-[var(--app-border)]">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Clock size={16} style={{ color: 'var(--app-accent)' }} />
            System Time Configuration
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Current Status */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--app-text-3)' }}>
              Current Status
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-md border border-[var(--app-border)] p-3" style={{ background: 'var(--app-bg)' }}>
                <p className="text-[11px] font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--app-text-3)' }}>
                  Date & Time
                </p>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--app-text-1)' }}>
                  {formatCurrentTime()}
                </p>
                <div className="mt-3 pt-3 border-t border-[var(--app-border)]">
                  <p className="text-[11px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--app-text-3)' }}>
                    Timezone
                  </p>
                  <MonoValue>{timeSettings?.timezone || 'Not set'}</MonoValue>
                </div>
              </div>

              <div className="rounded-md border border-[var(--app-border)] p-3" style={{ background: 'var(--app-bg)' }}>
                <p className="text-[11px] font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--app-text-3)' }}>
                  NTP Synchronization
                </p>
                <div className="flex items-center gap-2 mb-3">
                  <CloudLightning size={14} style={{ color: timeSettings?.ntp?.enabled ? 'var(--app-success)' : 'var(--app-text-3)' }} />
                  <StatusBadge variant={timeSettings?.ntp?.enabled ? 'success' : 'danger'} dot>
                    {timeSettings?.ntp?.enabled ? 'Enabled' : 'Disabled'}
                  </StatusBadge>
                </div>
                {timeSettings?.ntp?.enabled && timeSettings.ntp.servers?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide mb-1.5" style={{ color: 'var(--app-text-3)' }}>
                      Servers
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {timeSettings.ntp.servers.map((server, i) => (
                        <MonoValue key={i} className="text-[11px] px-1.5 py-0.5 rounded border border-[var(--app-border)]">
                          {server}
                        </MonoValue>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Configuration */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--app-text-3)' }}>
              Configuration
            </p>
            <div className="space-y-4">
              {/* Timezone select */}
              <div>
                <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                  Timezone
                </label>
                <RadixSelect value={localSettings.timezone} onValueChange={(v) => handleLocalChange('timezone', v)}>
                  <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' }}>
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                    {availableTimezones.map((zone) => (
                      <SelectItem key={zone} value={zone} className="text-[13px] font-mono">
                        {zone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </RadixSelect>
              </div>

              {/* NTP toggle */}
              <div className="flex items-center justify-between p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                <div className="flex items-center gap-2">
                  <CloudLightning size={14} style={{ color: 'var(--app-text-2)' }} />
                  <span className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>
                    Enable NTP Synchronization
                  </span>
                </div>
                <Switch
                  checked={localSettings.ntpEnabled}
                  onCheckedChange={(v) => handleLocalChange('ntpEnabled', v)}
                />
              </div>

              {/* NTP servers */}
              {localSettings.ntpEnabled && (
                <div>
                  <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                    NTP Servers
                  </label>
                  <textarea
                    value={localSettings.ntpServers.join(', ')}
                    onChange={(e) => handleNtpServersChange(e.target.value)}
                    rows={2}
                    placeholder="e.g., pool.ntp.org, time.google.com"
                    className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-[13px] font-mono resize-none focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                    style={{ color: 'var(--app-text-1)' }}
                  />
                  <p className="text-[11px] mt-1" style={{ color: 'var(--app-text-3)' }}>
                    Comma-separated NTP server addresses
                  </p>
                </div>
              )}

              {/* Manual time toggle */}
              <div className="rounded-md border border-[var(--app-border)] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2.5" style={{ background: 'var(--app-bg)' }}>
                  <div className="flex items-center gap-2">
                    <CalendarDays size={14} style={{ color: 'var(--app-text-2)' }} />
                    <span className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>
                      Set Time Manually
                    </span>
                  </div>
                  <Switch
                    checked={localSettings.isManualTime}
                    onCheckedChange={(v) => handleLocalChange('isManualTime', v)}
                  />
                </div>

                {localSettings.isManualTime && (
                  <div className="p-3 space-y-4 border-t border-[var(--app-border)]">
                    {/* Date + Time inputs */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                          Date
                        </label>
                        <input
                          type="date"
                          value={toDateInput(localSettings.manualDateTime)}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const [y, m, d] = e.target.value.split('-').map(Number);
                            const nd = new Date(localSettings.manualDateTime);
                            nd.setFullYear(y); nd.setMonth(m - 1); nd.setDate(d);
                            handleLocalChange('manualDateTime', nd);
                          }}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>
                          Time
                        </label>
                        <input
                          type="time"
                          value={toTimeInput(localSettings.manualDateTime)}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const [h, m] = e.target.value.split(':').map(Number);
                            const nd = new Date(localSettings.manualDateTime);
                            nd.setHours(h); nd.setMinutes(m);
                            handleLocalChange('manualDateTime', nd);
                          }}
                          className={inputCls}
                        />
                      </div>
                    </div>

                    {/* Quick adjustments */}
                    <div className="rounded-md border border-[var(--app-border)] p-3" style={{ background: 'var(--app-bg)' }}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--app-text-3)' }}>
                        Quick Adjustments
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {/* Hours */}
                        <div className="text-center">
                          <p className="text-[11px] mb-2" style={{ color: 'var(--app-text-3)' }}>Hours</p>
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => adjustDateTime('hours', -1)}
                              className="w-7 h-7 rounded flex items-center justify-center border border-[var(--app-border)] hover:bg-[var(--app-surface)] transition-colors"
                            >
                              <Minus size={11} />
                            </button>
                            <span className="text-[15px] font-mono font-semibold w-8 text-center" style={{ color: 'var(--app-accent)' }}>
                              {String(localSettings.manualDateTime.getHours()).padStart(2, '0')}
                            </span>
                            <button
                              type="button"
                              onClick={() => adjustDateTime('hours', 1)}
                              className="w-7 h-7 rounded flex items-center justify-center border border-[var(--app-border)] hover:bg-[var(--app-surface)] transition-colors"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </div>

                        {/* Minutes */}
                        <div className="text-center">
                          <p className="text-[11px] mb-2" style={{ color: 'var(--app-text-3)' }}>Minutes</p>
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => adjustDateTime('minutes', -1)}
                              className="w-7 h-7 rounded flex items-center justify-center border border-[var(--app-border)] hover:bg-[var(--app-surface)] transition-colors"
                            >
                              <Minus size={11} />
                            </button>
                            <span className="text-[15px] font-mono font-semibold w-8 text-center" style={{ color: 'var(--app-accent)' }}>
                              {String(localSettings.manualDateTime.getMinutes()).padStart(2, '0')}
                            </span>
                            <button
                              type="button"
                              onClick={() => adjustDateTime('minutes', 1)}
                              className="w-7 h-7 rounded flex items-center justify-center border border-[var(--app-border)] hover:bg-[var(--app-surface)] transition-colors"
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </div>

                        {/* Presets */}
                        <div className="md:col-span-2">
                          <p className="text-[11px] mb-2" style={{ color: 'var(--app-text-3)' }}>Quick Presets</p>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              { label: 'Now', fn: () => new Date() },
                              { label: '12:00 AM', fn: () => { const d = new Date(localSettings.manualDateTime); d.setHours(0, 0); return d; } },
                              { label: '12:00 PM', fn: () => { const d = new Date(localSettings.manualDateTime); d.setHours(12, 0); return d; } },
                              { label: '6:00 PM', fn: () => { const d = new Date(localSettings.manualDateTime); d.setHours(18, 0); return d; } },
                            ].map((preset) => (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => handleLocalChange('manualDateTime', preset.fn())}
                                className="px-2 py-1 text-[11px] rounded border transition-colors border-[var(--app-border)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)]"
                                style={{ color: 'var(--app-text-2)', background: 'var(--app-surface)' }}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Selected datetime preview */}
                    <div className="rounded-md border border-[var(--app-border)] p-3" style={{ borderColor: 'var(--app-accent)', background: 'color-mix(in srgb, var(--app-accent) 6%, transparent)' }}>
                      <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--app-accent)' }}>Selected Date & Time</p>
                      <p className="text-[14px] font-mono font-semibold" style={{ color: 'var(--app-text-1)' }}>
                        {localSettings.manualDateTime.toLocaleString('en-US', {
                          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                          hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
                        })}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-3 border-t border-[var(--app-border)]">
          <AppButton variant="outline" onClick={onClose}>Cancel</AppButton>
          <AppButton onClick={handleSave}>Save Changes</AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TimeConfigurationDialog;
