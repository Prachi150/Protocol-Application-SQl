import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AppAlert, IconBtn, Spinner } from '../ui/app-ui';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';

// Strip "[pipelineName] " prefix added by the backend in "all" mode.
function extractPipeline(rawLine) {
  const m = rawLine.match(/^\[([^\]]+)\] ([\s\S]*)/);
  return m ? { pipeline: m[1], line: m[2] } : { pipeline: '', line: rawLine };
}

// Logfmt parser: key=value or key="quoted value" → plain object
function parseLogfmt(line) {
  const obj = {};
  const re = /([\w@][\w@-]*)=("(?:[^"\\]|\\.)*"|[^\s]*)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"'))
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    obj[m[1]] = val;
  }
  return (obj.time || obj.level || obj.msg) ? obj : null;
}

function timeShort(iso) {
  if (!iso) return '';
  const m = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : iso.slice(0, 19);
}

const LEVEL_COLOR = {
  ERROR: 'var(--app-danger)',
  WARN:  'var(--app-warning)',
  INFO:  'var(--app-text-3)',
  DEBUG: 'var(--app-text-3)',
};

// showPipeline: whether the pipeline column is visible (only in "all" mode)
function cols(showPipeline) {
  return showPipeline ? '72px 44px 100px 140px 1fr' : '72px 44px 140px 1fr';
}

function LogRow({ rawLine, showPipeline }) {
  const { pipeline, line } = extractPipeline(rawLine);
  const p = parseLogfmt(line);

  if (!p) {
    return (
      <div style={{ padding: '2px 0', color: 'var(--app-text-3)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {rawLine}
      </div>
    );
  }

  const level    = (p.level || 'info').toUpperCase();
  const lc       = LEVEL_COLOR[level] || 'var(--app-text-3)';
  const msgColor = level === 'INFO' || level === 'DEBUG' ? 'var(--app-text-1)' : lc;
  const path     = p.path || '';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols(showPipeline),
      gap: 10,
      padding: '2px 0',
      borderTop: '1px solid var(--app-border)',
      alignItems: 'baseline',
    }}>
      <span style={{ color: 'var(--app-text-3)', whiteSpace: 'nowrap' }} title={p.time}>
        {timeShort(p.time)}
      </span>
      <span style={{ color: lc, fontWeight: 600 }}>{level}</span>
      {showPipeline && (
        <span style={{ color: 'var(--app-accent-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pipeline}>
          {pipeline}
        </span>
      )}
      <span style={{ color: 'var(--app-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
        {path}
      </span>
      <span style={{ color: msgColor, wordBreak: 'break-word' }}>{p.msg || ''}</span>
    </div>
  );
}

function HeaderRow({ showPipeline }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols(showPipeline),
      gap: 10,
      padding: '4px 0 6px',
      position: 'sticky',
      top: 0,
      zIndex: 1,
      background: 'var(--app-bg)',
      borderBottom: '1px solid var(--app-border)',
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--app-text-3)',
    }}>
      <span>Time</span>
      <span>Level</span>
      {showPipeline && <span>Pipeline</span>}
      <span>Path</span>
      <span>Message</span>
    </div>
  );
}

export default function LogsTab({ pipelines }) {
  const { getAuthHeaders } = useAuth();
  const [selected, setSelected]       = useState('all');
  const [logs, setLogs]               = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const logsEndRef = useRef(null);

  const showPipeline = selected === 'all';

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${getApiEndpoint('REDPANDA.LOGS')}?pipeline=${selected}&lines=200`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok) setLogs(data.logs);
      else setError(data.error || 'Failed to fetch logs');
    } catch (e) {
      setError('Network error: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [selected, getAuthHeaders]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchLogs, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  return (
    <div className="space-y-3 mt-4">
      <div className="flex items-center gap-3">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-48 h-9 text-[13px]"
            style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}>
            <SelectItem value="all">All Pipelines</SelectItem>
            {(pipelines ?? []).map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <IconBtn onClick={fetchLogs} disabled={loading} title="Refresh logs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </IconBtn>

        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          <span className="text-[13px]" style={{ color: 'var(--app-text-2)' }}>Auto-refresh (5 s)</span>
        </label>
      </div>

      {error && <AppAlert severity="error">{error}</AppAlert>}

      <div className="h-[520px] overflow-y-auto rounded-lg px-3 pt-0 pb-3 font-mono text-[11px] leading-[1.6]"
        style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}>
        {logs.length === 0 && !loading
          ? <div className="flex items-center justify-center h-full" style={{ color: 'var(--app-text-3)' }}>No log entries found.</div>
          : <>
              <HeaderRow showPipeline={showPipeline} />
              {logs.map((line, i) => <LogRow key={i} rawLine={line} showPipeline={showPipeline} />)}
            </>
        }
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
