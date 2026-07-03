import React, { useState, useEffect, useCallback } from 'react';
import { Server, Router, RefreshCw, Play, Square, RotateCcw, Trash2, Edit2, Power, Users, Database } from 'lucide-react';
import {
  Panel, PanelHeader, PanelBody, DataRow, MonoValue,
  StatusDot, StatusBadge, AppAlert, IconBtn, AppButton, Spinner,
} from '../ui/app-ui';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';

export default function OverviewTab({ status, statusLoading, statusError, onRefresh, onEditPipeline }) {
  const { getAuthHeaders } = useAuth();
  const [actionLoading, setActionLoading] = React.useState({});
  const [brokerRestarting, setBrokerRestarting] = React.useState(false);
  const [actionErrors, setActionErrors] = React.useState({});

  const [consumers, setConsumers]         = useState(null);
  const [consumersLoading, setConsumersLoading] = useState(true);
  const [topics, setTopics]               = useState(null);
  const [topicsLoading, setTopicsLoading] = useState(true);

  const setLoading = (key, val) => setActionLoading(s => ({ ...s, [key]: val }));
  const setErr     = (key, val) => setActionErrors(s => ({ ...s, [key]: val }));

  const fetchConsumers = useCallback(async () => {
    setConsumersLoading(true);
    try {
      const res  = await fetch(getApiEndpoint('REDPANDA.CONSUMERS'), { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok) setConsumers(data);
    } catch { /* silent */ } finally { setConsumersLoading(false); }
  }, [getAuthHeaders]);

  const fetchTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const res  = await fetch(getApiEndpoint('REDPANDA.BROKER_TOPICS'), { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok) setTopics(data);
    } catch { /* silent */ } finally { setTopicsLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => { fetchConsumers(); }, [fetchConsumers]);
  useEffect(() => { fetchTopics(); },   [fetchTopics]);

  const pipelineAction = async (name, action) => {
    setLoading(name, true);
    setErr(name, null);
    try {
      const res  = await fetch(`${getApiEndpoint('REDPANDA.PIPELINE')}/${name}/action`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) setErr(name, data.error || 'Action failed.');
      else onRefresh();
    } catch (e) {
      setErr(name, e.message);
    } finally {
      setLoading(name, false);
    }
  };

  const removePipeline = async (name) => {
    if (!window.confirm(`Stop and remove pipeline "${name}"?`)) return;
    setLoading(`del-${name}`, true);
    try {
      const res  = await fetch(`${getApiEndpoint('REDPANDA.PIPELINE')}/${name}`, {
        method: 'DELETE', headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) setErr(name, data.error || 'Remove failed.');
      else onRefresh();
    } catch (e) {
      setErr(name, e.message);
    } finally {
      setLoading(`del-${name}`, false);
    }
  };

  const restartBroker = async () => {
    if (!window.confirm('Restart the Redpanda broker? This will interrupt all pipelines briefly.')) return;
    setBrokerRestarting(true);
    try {
      await fetch(getApiEndpoint('REDPANDA.BROKER_RESTART'), {
        method: 'POST', headers: getAuthHeaders(),
      });
      setTimeout(onRefresh, 3000);
    } catch (e) {
      alert('Failed to restart broker: ' + e.message);
    } finally {
      setBrokerRestarting(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      {statusError && <AppAlert severity="error">{statusError}</AppAlert>}

      {/* Top row: 3 info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Broker Card */}
        <Panel>
          <PanelHeader
            icon={Server}
            iconColor="accent"
            title="Redpanda Broker"
            right={
              <IconBtn variant="warning" title="Restart broker" onClick={restartBroker} disabled={brokerRestarting}>
                {brokerRestarting ? <Spinner size={13} /> : <Power size={13} />}
              </IconBtn>
            }
          />
          <PanelBody>
            {statusLoading ? <Spinner size={18} /> : <>
              <StatusDot active={status?.broker?.running} label={status?.broker?.running ? 'Running' : 'Stopped'} />
              {status?.broker?.version && (
                <p className="mt-2 text-[12px]" style={{ color: 'var(--app-text-3)' }}>
                  <MonoValue color="var(--app-text-3)">{status.broker.version}</MonoValue>
                </p>
              )}
            </>}
          </PanelBody>
        </Panel>

        {/* Consumer Groups Card */}
        <Panel>
          <PanelHeader
            icon={Users}
            iconColor="accent"
            title="Consumer Groups"
            right={
              <IconBtn onClick={fetchConsumers} disabled={consumersLoading} title="Refresh">
                <RefreshCw size={14} className={consumersLoading ? 'animate-spin' : ''} />
              </IconBtn>
            }
          />
          <PanelBody>
            {consumersLoading ? <Spinner size={18} /> : !consumers ? (
              <p className="text-[13px]" style={{ color: 'var(--app-text-3)' }}>Unavailable</p>
            ) : <>
              <div className="flex gap-3 mb-3">
                <div>
                  <div className="text-[22px] font-semibold leading-none" style={{ color: 'var(--app-text-1)' }}>{consumers.totalGroups}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--app-text-3)' }}>total groups</div>
                </div>
                <div>
                  <div className="text-[22px] font-semibold leading-none" style={{ color: 'var(--app-success)' }}>{consumers.stableGroups}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--app-text-3)' }}>stable</div>
                </div>
                <div>
                  <div className="text-[22px] font-semibold leading-none" style={{ color: consumers.totalLag > 0 ? 'var(--app-warning)' : 'var(--app-text-1)' }}>{consumers.totalLag}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--app-text-3)' }}>total lag</div>
                </div>
              </div>
              <div className="space-y-1 max-h-[80px] overflow-y-auto">
                {consumers.groups.map(g => (
                  <div key={g.name} className="flex items-center justify-between">
                    <MonoValue className="text-[11px] truncate max-w-[160px]">{g.name}</MonoValue>
                    <StatusBadge variant={g.state === 'Stable' ? 'success' : 'neutral'}>{g.state}</StatusBadge>
                  </div>
                ))}
              </div>
            </>}
          </PanelBody>
        </Panel>

        {/* Topics Summary Card */}
        <Panel>
          <PanelHeader
            icon={Database}
            iconColor="accent"
            title="Topics"
            right={
              <IconBtn onClick={fetchTopics} disabled={topicsLoading} title="Refresh">
                <RefreshCw size={14} className={topicsLoading ? 'animate-spin' : ''} />
              </IconBtn>
            }
          />
          <PanelBody>
            {topicsLoading ? <Spinner size={18} /> : !topics ? (
              <p className="text-[13px]" style={{ color: 'var(--app-text-3)' }}>Unavailable</p>
            ) : <>
              <div className="flex gap-3 mb-3">
                <div>
                  <div className="text-[22px] font-semibold leading-none" style={{ color: 'var(--app-text-1)' }}>{topics.totalTopics ?? 0}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--app-text-3)' }}>topics</div>
                </div>
                <div>
                  <div className="text-[22px] font-semibold leading-none" style={{ color: 'var(--app-text-1)' }}>{topics.totalPartitions ?? 0}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--app-text-3)' }}>partitions</div>
                </div>
              </div>
              <div className="space-y-1 max-h-[80px] overflow-y-auto">
                {(topics.topics ?? []).map(t => (
                  <div key={t.name} className="flex items-center justify-between">
                    <MonoValue className="text-[11px] truncate max-w-[190px]">{t.name}</MonoValue>
                    <StatusBadge variant="accent">{t.partitions}p</StatusBadge>
                  </div>
                ))}
              </div>
            </>}
          </PanelBody>
        </Panel>
      </div>

      {/* Active Pipelines — full width */}
      <Panel>
        <PanelHeader
          icon={Router}
          iconColor="accent"
          title="Active Pipelines"
          right={
            <IconBtn onClick={onRefresh} disabled={statusLoading} title="Refresh">
              <RefreshCw size={14} className={statusLoading ? 'animate-spin' : ''} />
            </IconBtn>
          }
        />
        <PanelBody>
          {statusLoading ? (
            <Spinner size={18} />
          ) : !status?.pipelines?.length ? (
            <p className="text-[13px]" style={{ color: 'var(--app-text-3)' }}>No pipelines deployed yet.</p>
          ) : (
            <div className="space-y-1">
              <div className="grid items-center gap-2 pb-2 text-[11px] uppercase tracking-wide"
                style={{ color: 'var(--app-text-3)', gridTemplateColumns: '1fr 80px 80px 132px' }}>
                <span>Name</span><span>Type</span><span>Status</span><span>Actions</span>
              </div>
              {status.pipelines.map(p => (
                <div key={p.name}>
                  <div className="grid items-center gap-2 py-1.5"
                    style={{ gridTemplateColumns: '1fr 80px 80px 132px', borderTop: '1px solid var(--app-border)' }}>
                    <MonoValue>{p.name}</MonoValue>
                    <StatusBadge variant="accent">{p.outputType}</StatusBadge>
                    <StatusBadge variant={p.status === 'active' ? 'success' : p.status === 'failed' ? 'danger' : 'neutral'}>
                      {p.status}
                    </StatusBadge>
                    <div className="flex gap-1">
                      <IconBtn title="Edit pipeline" onClick={() => onEditPipeline(p.name)}>
                        <Edit2 size={13} />
                      </IconBtn>
                      {p.status === 'active'
                        ? <IconBtn variant="danger"  title="Stop"    disabled={actionLoading[p.name]} onClick={() => pipelineAction(p.name, 'stop')}>
                            {actionLoading[p.name] ? <Spinner size={12} /> : <Square size={13} />}
                          </IconBtn>
                        : <IconBtn variant="success" title="Start"   disabled={actionLoading[p.name]} onClick={() => pipelineAction(p.name, 'start')}>
                            {actionLoading[p.name] ? <Spinner size={12} /> : <Play size={13} />}
                          </IconBtn>
                      }
                      <IconBtn variant="warning" title="Restart"  disabled={actionLoading[p.name]} onClick={() => pipelineAction(p.name, 'restart')}>
                        {actionLoading[p.name] ? <Spinner size={12} /> : <RotateCcw size={13} />}
                      </IconBtn>
                      <IconBtn variant="danger"  title="Remove pipeline" disabled={actionLoading[`del-${p.name}`]} onClick={() => removePipeline(p.name)}>
                        {actionLoading[`del-${p.name}`] ? <Spinner size={12} /> : <Trash2 size={13} />}
                      </IconBtn>
                    </div>
                  </div>
                  {actionErrors[p.name] && (
                    <p className="text-[12px] pb-1" style={{ color: 'var(--app-danger)' }}>{actionErrors[p.name]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
