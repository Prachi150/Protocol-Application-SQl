import React, { useState, useEffect, useCallback } from 'react';
import {
  Wifi, Shield, Clock, RotateCcw, KeyRound, Puzzle, Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getApiEndpoint } from '../config/api';
import { useLayout } from './layout/Layout';
import {
  PageContainer, Panel, PanelHeader, PanelBody, DataRow,
  MonoValue, StatusBadge, PageSpinner, AppAlert,
} from './ui/app-ui';

const getHumanReadableSchedule = (pattern) => {
  try {
    const parts = pattern.split(' ');
    if (parts.length !== 5) return pattern;
    const [minute, hour, day, month, dayOfWeek] = parts;
    if (minute === '*' && hour === '*' && day === '*' && month === '*' && dayOfWeek === '*') return 'Every minute';
    if (minute === '0' && hour === '*' && day === '*' && month === '*' && dayOfWeek === '*') return 'Every hour';
    if (minute === '0' && hour === '0' && day === '*' && month === '*' && dayOfWeek === '*') return 'Daily at midnight';
    if (minute !== '*' && hour !== '*') {
      const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
      if (day === '*' && month === '*') {
        if (dayOfWeek === '*') return `Daily at ${timeStr}`;
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        if (dayOfWeek.includes(',')) {
          return `Every ${dayOfWeek.split(',').map(d => days[parseInt(d)]).join(' & ')} at ${timeStr}`;
        }
        return `Every ${days[parseInt(dayOfWeek)]} at ${timeStr}`;
      }
    }
    return pattern;
  } catch {
    return pattern;
  }
};

const Overview = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { getAuthHeaders } = useAuth();
  const { registerRefresh } = useLayout();

  const fetchOverview = useCallback(async () => {
    try {
      const response = await fetch(getApiEndpoint('SYSTEM.OVERVIEW'), { headers: getAuthHeaders() });
      const result = await response.json();
      if (response.ok) {
        setData(result);
        setError(null);
      } else {
        throw new Error(result.message || `Server error: ${response.status}`);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch overview data.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { registerRefresh(fetchOverview); }, [registerRefresh, fetchOverview]);

  if (loading && !data) return <PageSpinner />;

  const net = data?.network;
  const fw  = data?.firewall;
  const tm  = data?.time;
  const vpn = data?.vpn;
  const proto = data?.protocols;
  const fwd = data?.dataForwarding;
  const sched = data?.scheduling;

  const oneTimeSchedules  = sched?.restartSchedules?.filter(s => !s.recurring || s.pattern.includes('once')) ?? [];
  const recurringSchedules = sched?.restartSchedules?.filter(s => s.recurring && !s.pattern.includes('once')) ?? [];
  const upcoming = sched?.restartSchedules?.[0];

  return (
    <PageContainer>
      {error && <AppAlert severity="error">{error}</AppAlert>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Network */}
        <Panel>
          <PanelHeader
            icon={Wifi}
            iconColor="accent"
            title="Network Status"
            right={
              <StatusBadge variant={net?.internetConnected ? 'success' : 'danger'} dot>
                {net?.internetConnected ? 'Connected' : 'Disconnected'}
              </StatusBadge>
            }
          />
          <PanelBody>
            {net?.interfaces?.slice(0, 2).map((iface, idx, arr) => (
              <DataRow key={iface.name} label={iface.name} last={idx === arr.length - 1 && !net.interfaces.length > 2}>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {iface.addresses.map(a => (
                    <MonoValue key={a.address}>{a.address}</MonoValue>
                  ))}
                </div>
              </DataRow>
            ))}
            <DataRow label="Total Interfaces" last>
              <MonoValue>{net?.interfaces?.length ?? 0}</MonoValue>
            </DataRow>
          </PanelBody>
        </Panel>

        {/* Firewall */}
        <Panel>
          <PanelHeader icon={Shield} iconColor="accent" title="Firewall Status" />
          <PanelBody>
            <DataRow label="Status">
              <StatusBadge variant={fw?.enabled ? 'success' : 'danger'} dot>
                {fw?.enabled ? 'Enabled' : 'Disabled'}
              </StatusBadge>
            </DataRow>
            {fw?.enabled && (
              <DataRow label="Active Rules" last>
                <MonoValue>{fw.rulesCount ?? 0}</MonoValue>
              </DataRow>
            )}
            {!fw?.enabled && <DataRow label="Active Rules" last><MonoValue>—</MonoValue></DataRow>}
          </PanelBody>
        </Panel>

        {/* System Time */}
        <Panel>
          <PanelHeader icon={Clock} iconColor="accent" title="System Time" />
          <PanelBody>
            <DataRow label="NTP Status">
              <StatusBadge variant={tm?.ntpEnabled ? 'success' : 'warning'} dot>
                {tm?.ntpEnabled ? 'Enabled' : 'Manual'}
              </StatusBadge>
            </DataRow>
            <DataRow label="Current Time">
              <MonoValue>
                {tm?.currentTime
                  ? new Date(tm.currentTime).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
                  : 'N/A'}
              </MonoValue>
            </DataRow>
            <DataRow label="Timezone" last>
              <MonoValue>{tm?.timezone ?? 'N/A'}</MonoValue>
            </DataRow>
          </PanelBody>
        </Panel>

        {/* Restart Schedules */}
        <Panel>
          <PanelHeader icon={RotateCcw} iconColor="accent" title="Restart Schedules" />
          <PanelBody>
            <DataRow label="One-time">
              <MonoValue>{oneTimeSchedules.length}</MonoValue>
            </DataRow>
            <DataRow label="Recurring">
              <MonoValue>{recurringSchedules.length}</MonoValue>
            </DataRow>
            {upcoming && (
              <DataRow label="Next scheduled" last>
                <StatusBadge variant="accent">{getHumanReadableSchedule(upcoming.pattern)}</StatusBadge>
              </DataRow>
            )}
            {!upcoming && <DataRow label="Next scheduled" last><MonoValue>None</MonoValue></DataRow>}
          </PanelBody>
        </Panel>

        {/* VPN */}
        <Panel>
          <PanelHeader icon={KeyRound} iconColor="accent" title="VPN Status" />
          <PanelBody>
            <DataRow label="Configuration">
              <StatusBadge variant={vpn?.configured ? 'success' : 'danger'} dot>
                {vpn?.configured ? 'Configured' : 'Not configured'}
              </StatusBadge>
            </DataRow>
            {vpn?.configured && (
              <DataRow label="Connection">
                <StatusBadge variant={vpn?.enabled ? 'success' : 'warning'} dot>
                  {vpn?.enabled ? 'Active' : 'Inactive'}
                </StatusBadge>
              </DataRow>
            )}
            {vpn?.vpnIp && (
              <DataRow label="VPN IP">
                <MonoValue>{vpn.vpnIp}</MonoValue>
              </DataRow>
            )}
            {vpn?.lastConnected && (
              <DataRow label="Last connected" last>
                <MonoValue>
                  {new Date(vpn.lastConnected).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                </MonoValue>
              </DataRow>
            )}
            {!vpn?.lastConnected && <DataRow label="Last connected" last><MonoValue>—</MonoValue></DataRow>}
          </PanelBody>
        </Panel>

        {/* Protocol Apps */}
        <Panel>
          <PanelHeader icon={Puzzle} iconColor="accent" title="Protocol Apps" />
          <PanelBody>
            <DataRow label="Installed">
              <MonoValue>{proto?.installed ?? 0}</MonoValue>
            </DataRow>
            <DataRow label="Running">
              <MonoValue>{proto?.running ?? 0}</MonoValue>
            </DataRow>
            {proto?.details?.length > 0 && (
              <DataRow label="Active apps" last>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {proto.details.map(p => (
                    <StatusBadge key={p.name} variant={p.running ? 'success' : 'neutral'}>
                      {p.name}
                    </StatusBadge>
                  ))}
                </div>
              </DataRow>
            )}
            {!proto?.details?.length && <DataRow label="Active apps" last><MonoValue>None</MonoValue></DataRow>}
          </PanelBody>
        </Panel>

      </div>

      {/* Data Forwarding — full width */}
      <Panel>
        <PanelHeader icon={Upload} iconColor="accent" title="Data Forwarding" />
        <PanelBody>
          <DataRow label="Redpanda Broker">
            <StatusBadge variant={fwd?.brokerRunning ? 'success' : 'neutral'} dot>
              {fwd?.brokerRunning ? 'Running' : 'Stopped'}
            </StatusBadge>
          </DataRow>
          <DataRow label="Active Pipelines" last>
            {fwd?.pipelines?.length
              ? <div className="flex flex-wrap gap-1.5 justify-end">
                  {fwd.pipelines.map(name => (
                    <StatusBadge key={name} variant="accent">{name}</StatusBadge>
                  ))}
                </div>
              : <MonoValue>None</MonoValue>
            }
          </DataRow>
        </PanelBody>
      </Panel>

    </PageContainer>
  );
};

export default Overview;
