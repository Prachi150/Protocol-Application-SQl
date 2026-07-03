import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Database } from 'lucide-react';
import { Panel, PanelHeader, PanelBody, MonoValue, StatusBadge, AppAlert, IconBtn, Spinner } from '../ui/app-ui';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function relativeTime(epochMs) {
  if (!epochMs) return '—';
  const diff = Date.now() - epochMs;
  if (diff < 0)          return 'just now';
  if (diff < 60_000)     return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtFull(epochMs) {
  if (!epochMs) return '';
  return new Date(epochMs).toLocaleString();
}

const COL = '2fr 56px 64px 100px 110px 120px 1fr 72px';

function HeaderRow() {
  return (
    <div className="grid gap-3 px-3 py-2 text-[11px] uppercase tracking-wide sticky top-0 z-10"
      style={{ gridTemplateColumns: COL, color: 'var(--app-text-3)', background: 'var(--app-elevated)', borderBottom: '1px solid var(--app-border)' }}>
      <span>Topic</span>
      <span>Parts</span>
      <span>Replicas</span>
      <span>Retained</span>
      <span>End Offset</span>
      <span>Last Message</span>
      <span>Consumer Groups</span>
      <span>Lag</span>
    </div>
  );
}

function TopicRow({ topic }) {
  const lastActive = relativeTime(topic.lastMessageAt);
  const isRecent   = topic.lastMessageAt && (Date.now() - topic.lastMessageAt) < 300_000; // < 5 min

  return (
    <div className="grid gap-3 px-3 py-2 items-center text-[12.5px]"
      style={{ gridTemplateColumns: COL, borderTop: '1px solid var(--app-border)' }}>
      <MonoValue className="truncate" title={topic.name}>{topic.name}</MonoValue>
      <span style={{ color: 'var(--app-text-2)' }}>{topic.partitions}</span>
      <span style={{ color: 'var(--app-text-2)' }}>{topic.replicas}</span>
      <span style={{ color: 'var(--app-text-1)', fontVariantNumeric: 'tabular-nums' }}>{fmt(topic.retainedMessages)}</span>
      <span style={{ color: 'var(--app-text-3)', fontVariantNumeric: 'tabular-nums', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5 }}>{fmt(topic.highWatermark)}</span>
      <span
        title={fmtFull(topic.lastMessageAt)}
        style={{ color: isRecent ? 'var(--app-success)' : 'var(--app-text-3)', cursor: topic.lastMessageAt ? 'default' : undefined }}
      >
        {lastActive}
      </span>
      <div className="flex flex-wrap gap-1">
        {topic.consumers.length === 0
          ? <span style={{ color: 'var(--app-text-3)' }}>—</span>
          : topic.consumers.map(c => (
              <StatusBadge key={c.group} variant={c.lag > 0 ? 'warning' : 'success'} title={`lag: ${c.lag}, members: ${c.members}`}>
                {c.group}
              </StatusBadge>
            ))
        }
      </div>
      <span style={{ color: topic.totalLag > 0 ? 'var(--app-warning)' : 'var(--app-text-3)', fontVariantNumeric: 'tabular-nums' }}>
        {topic.totalLag > 0 ? topic.totalLag : '—'}
      </span>
    </div>
  );
}

export default function TopicsTab() {
  const { getAuthHeaders } = useAuth();
  const [topics, setTopics]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(getApiEndpoint('REDPANDA.TOPICS'), { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok) setTopics(data.topics ?? []);
      else setError(data.error || 'Failed to fetch topics');
    } catch (e) {
      setError('Network error: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { fetchTopics(); }, [fetchTopics]);

  return (
    <div className="space-y-3 mt-4">
      <Panel>
        <PanelHeader
          icon={Database}
          iconColor="accent"
          title="Kafka Topics"
          right={
            <div className="flex items-center gap-2">
              {loading && <span className="text-[11px]" style={{ color: 'var(--app-text-3)' }}>fetching last messages…</span>}
              <IconBtn onClick={fetchTopics} disabled={loading} title="Refresh">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </IconBtn>
            </div>
          }
        />
        <PanelBody className="p-0">
          {error && <div className="p-3"><AppAlert severity="error">{error}</AppAlert></div>}
          {loading && topics.length === 0 && <div className="p-4 flex justify-center"><Spinner size={20} /></div>}
          {(!loading || topics.length > 0) && !error && (
            <>
              <HeaderRow />
              {topics.length === 0
                ? <p className="px-3 py-4 text-[13px]" style={{ color: 'var(--app-text-3)' }}>No topics found.</p>
                : topics.map(t => <TopicRow key={t.name} topic={t} />)
              }
            </>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
