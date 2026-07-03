import React, { useState, useCallback } from 'react';
import { Clock, RefreshCw, Edit2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';
import {
  Panel, PanelHeader, PanelBody, DataRow, MonoValue, StatusBadge, AppButton,
} from '../ui/app-ui';
import TimeConfigurationDialog from '../remote/TimeConfigurationDialog';

export default function TimePanel({ showSnackbar }) {
  const { getAuthHeaders } = useAuth();

  const [loading, setLoading] = useState(true);
  const [timeSettings, setTimeSettings] = useState(null);
  const [timezones, setTimezones] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchTimeSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(getApiEndpoint('REMOTE.TIME'), { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch time settings');
      setTimeSettings(await res.json());
    } catch (err) {
      showSnackbar(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, showSnackbar]);

  const fetchTimezones = useCallback(async () => {
    try {
      const res = await fetch(getApiEndpoint('REMOTE.TIME_ZONES'), { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch timezones');
      const data = await res.json();
      setTimezones(data.timezones);
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  }, [getAuthHeaders, showSnackbar]);

  React.useEffect(() => {
    fetchTimeSettings();
    fetchTimezones();
  }, [fetchTimeSettings, fetchTimezones]);

  const handleTimeUpdate = async (settings) => {
    try {
      const res = await fetch(getApiEndpoint('REMOTE.TIME'), {
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
      if (!res.ok) throw new Error('Failed to update time settings');
      showSnackbar('Time settings updated successfully');
      fetchTimeSettings();
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  };

  const formatCurrentTime = () => {
    if (!timeSettings?.datetime) return 'Loading...';
    return new Date(timeSettings.datetime).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  return (
    <>
      <Panel>
        <PanelHeader
          icon={Clock}
          iconColor="accent"
          title="System Time Settings"
          right={
            <div className="flex items-center gap-2">
              <AppButton variant="ghost" onClick={fetchTimeSettings} disabled={loading}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </AppButton>
              <AppButton variant="outline" onClick={() => setDialogOpen(true)} disabled={loading}>
                <Edit2 size={13} /> Configure
              </AppButton>
            </div>
          }
        />
        <PanelBody>
          {loading ? (
            <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>Loading time settings…</p>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                <p className="text-[11px] font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--app-text-3)' }}>Current System Time</p>
                <p className="text-[15px] font-mono font-semibold" style={{ color: 'var(--app-text-1)' }}>{formatCurrentTime()}</p>
                <p className="text-[12px] mt-1" style={{ color: 'var(--app-text-2)' }}>Timezone: {timeSettings?.timezone || 'Not configured'}</p>
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

      <TimeConfigurationDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        timeSettings={timeSettings}
        availableTimezones={timezones}
        onTimeSettingsUpdate={handleTimeUpdate}
        onFetchTimeSettings={fetchTimeSettings}
      />
    </>
  );
}
