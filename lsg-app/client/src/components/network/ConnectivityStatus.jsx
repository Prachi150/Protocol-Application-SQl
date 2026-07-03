import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Wifi, Globe, Gauge, Router, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';
import {
  Panel, PanelHeader, PanelBody, DataRow, MonoValue,
  StatusBadge, PageSpinner, AppButton,
} from '../ui/app-ui';

const ConnectivityStatus = ({ setError }) => {
  const { getAuthHeaders } = useAuth();
  const [connectivity, setConnectivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const isMounted = useRef(true);
  const isInitialMount = useRef(true);

  const checkConnectivity = useCallback(async () => {
    if (!isMounted.current) return;
    setChecking(true);
    try {
      const response = await fetch(getApiEndpoint('NETWORK.CONNECTIVITY'), { headers: getAuthHeaders() });
      if (!isMounted.current) return;
      if (!response.ok) throw new Error('Failed to check connectivity');
      const data = await response.json();
      if (!isMounted.current) return;
      setConnectivity(data.data);
      setLoading(false);
    } catch (err) {
      if (!isMounted.current) return;
      setError('Failed to check connectivity: ' + err.message);
      setLoading(false);
    } finally {
      if (isMounted.current) setChecking(false);
    }
  }, [getAuthHeaders, setError]);

  useEffect(() => {
    isMounted.current = true;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      checkConnectivity();
    }
    return () => { isMounted.current = false; };
  }, [checkConnectivity]);

  if (loading) return <PageSpinner />;

  const c = connectivity;

  const checks = [
    { key: 'dns',  icon: Globe,  label: 'DNS Check',  ok: c?.checks?.dns,  detail: c?.details?.dns  || 'DNS resolution check' },
    { key: 'http', icon: Wifi,   label: 'HTTP Check',  ok: c?.checks?.http, detail: c?.details?.http || 'HTTP connection check' },
    { key: 'ping', icon: Gauge,  label: 'Ping Check',  ok: c?.checks?.ping, detail: c?.details?.ping || 'Network ping test' },
  ];

  return (
    <div className="space-y-4">
      {/* Header + action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--app-text-1)' }}>
            Internet Connectivity Status
          </h2>
          <StatusBadge variant={c?.connected ? 'success' : 'danger'} dot>
            {c?.connected ? 'Connected' : 'Disconnected'}
          </StatusBadge>
        </div>
        <AppButton variant="outline" onClick={checkConnectivity} disabled={checking}>
          <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
          {checking ? 'Checking…' : 'Check Now'}
        </AppButton>
      </div>

      {/* Check cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {checks.map(({ key, icon: Icon, label, ok, detail }) => (
          <Panel key={key}>
            <PanelHeader
              icon={Icon}
              iconColor={ok ? 'success' : 'danger'}
              title={label}
              right={<StatusBadge variant={ok ? 'success' : 'danger'} dot>{ok ? 'Pass' : 'Fail'}</StatusBadge>}
            />
            <PanelBody>
              <p className="text-[13px]" style={{ color: 'var(--app-text-2)' }}>{detail}</p>
              {key === 'ping' && c?.latency && (
                <div className="mt-2">
                  <StatusBadge variant="accent">Latency: {c.latency}ms</StatusBadge>
                </div>
              )}
            </PanelBody>
          </Panel>
        ))}
      </div>

      {/* Route information */}
      <Panel>
        <PanelHeader icon={Router} iconColor="accent" title="Route Information" />
        <PanelBody>
          {c?.details?.route ? (
            <div className="space-y-3">
              <DataRow label="Interface">
                <MonoValue>{c.details.route.interface}</MonoValue>
              </DataRow>
              <DataRow label="Route" last>
                <MonoValue className="break-all text-right text-[12px]">{c.details.route.route}</MonoValue>
              </DataRow>
            </div>
          ) : (
            <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>No route information available.</p>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
};

export default ConnectivityStatus;
