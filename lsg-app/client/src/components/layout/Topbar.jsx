import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildApiUrl } from '../../config/api';

const PAGE_TITLES = {
  '/overview':   { title: 'System Overview',       sub: 'Real-time device status & health' },
  '/network':    { title: 'Network Management',    sub: 'Interfaces, firewall & connectivity' },
  '/remote':     { title: 'Remote Management',     sub: 'VPN, time & restart scheduling' },
  '/polling':    { title: 'Protocol Apps',         sub: 'Installed IoT protocol adapters' },
  '/forwarding': { title: 'Data Forwarding',       sub: 'Redpanda broker & pipeline config' },
  '/onboard':    { title: 'Onboarding',            sub: 'Device registration & platform link' },
};

function formatUptime(isoString) {
  const secs = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600) % 24;
  const d = Math.floor(secs / 86400);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Topbar({ onRefresh, refreshing }) {
  const location = useLocation();
  const { title, sub } = PAGE_TITLES[location.pathname] ?? { title: 'Dashboard', sub: '' };
  const [clock, setClock] = useState('');
  const [startedAt, setStartedAt] = useState(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch(buildApiUrl('/api/system/uptime'))
      .then(r => r.json())
      .then(d => { if (d.startedAt) setStartedAt(d.startedAt); })
      .catch(() => {});
  }, []);

  return (
    <header
      className="flex items-center justify-between flex-shrink-0 px-6"
      style={{ height: 64, minHeight: 64, background: 'var(--app-surface)', borderBottom: '1px solid var(--app-border)' }}
    >
      <div>
        <h1 className="text-[16px] font-semibold text-[var(--app-text-1)] leading-tight">{title}</h1>
        {sub && <p className="text-[12.5px] text-[var(--app-text-3)] font-mono mt-0.5">{sub}</p>}
      </div>

      <div className="flex items-center gap-3.5">
        {/* Online pill */}
        <div
          className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px]"
          style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--app-success)' }} />
          <span className="text-[var(--app-text-2)]">Device</span>
          <strong className="font-mono text-[12.5px] font-medium text-[var(--app-text-1)]">ioconnect-edge-01</strong>
        </div>

        {startedAt && (
          <>
            <div className="w-px h-6 flex-shrink-0" style={{ background: 'var(--app-border)' }} />
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[10px] uppercase tracking-[0.6px] text-[var(--app-text-3)]">Uptime</span>
              <span className="font-mono text-[12.5px] font-medium text-[var(--app-text-1)]">{formatUptime(startedAt)}</span>
            </div>
          </>
        )}

        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.6px] text-[var(--app-text-3)]">Local time</span>
          <span className="font-mono text-[12.5px] font-medium text-[var(--app-text-1)]">{clock}</span>
        </div>

        <div className="w-px h-6 flex-shrink-0" style={{ background: 'var(--app-border)' }} />

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors duration-[130ms] disabled:opacity-50"
            style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--app-elevated)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--app-surface)'}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
    </header>
  );
}
