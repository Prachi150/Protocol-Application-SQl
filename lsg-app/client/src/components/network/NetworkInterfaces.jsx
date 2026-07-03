import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Wifi, Monitor, Network, KeyRound, Settings, Globe, Router, Plus, X, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint } from '../../config/api';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select as RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Panel, PanelBody, StatusBadge, MonoValue, PageSpinner, AppButton, AppInput, IconBtn,
} from '../ui/app-ui';

const NetworkInterfaces = ({ setError }) => {
  const { getAuthHeaders } = useAuth();
  const [interfaces, setInterfaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedInterface, setSelectedInterface] = useState(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isMounted = useRef(true);
  const isInitialMount = useRef(true);

  const [config, setConfig] = useState({
    ipv4: { method: 'auto', address: '', netmask: '', gateway: '', setAsDefaultRoute: false },
    ipv6: { method: 'auto', address: '', prefixLength: '', gateway: '' },
    dns: { method: 'auto', servers: [''] },
    wireless: { ssid: '', security: 'none', password: '' },
    state: { up: true },
  });

  const fetchInterfaces = useCallback(async () => {
    if (!isMounted.current) return;
    try {
      const response = await fetch(getApiEndpoint('NETWORK.INTERFACES'), { headers: getAuthHeaders() });
      if (!isMounted.current) return;
      if (!response.ok) throw new Error('Failed to fetch interfaces');
      const data = await response.json();
      if (!isMounted.current) return;
      setInterfaces(data.data);
      setLoading(false);
    } catch (err) {
      if (!isMounted.current) return;
      setError('Failed to load network interfaces: ' + err.message);
      setLoading(false);
    }
  }, [getAuthHeaders, setError]);

  useEffect(() => {
    isMounted.current = true;
    if (isInitialMount.current) { isInitialMount.current = false; fetchInterfaces(); }
    return () => { isMounted.current = false; };
  }, [fetchInterfaces]);

  const getInterfaceState = (iface) => {
    if (!iface?.name) return 'down';
    if (iface.name.startsWith('tun')) return (iface.addresses?.length > 0 && iface.routes?.length > 0) ? 'up' : 'down';
    return iface.state || 'down';
  };

  const isActive = (iface) => getInterfaceState(iface) === 'up';

  const getInterfaceType = (type, name) => {
    if (name?.startsWith('tun')) return 'VPN Tunnel';
    if (name === 'lo') return 'Loopback';
    return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Unknown';
  };

  const getInterfaceIcon = (type, name) => {
    if (name?.startsWith('tun')) return KeyRound;
    if (type === 'wireless') return Wifi;
    if (type === 'ethernet') return Monitor;
    return Network;
  };

  const handleConfigureInterface = (iface) => {
    setSelectedInterface(iface);
    setConfig({
      ipv4: { method: iface.ipv4?.method || 'auto', address: iface.ipv4?.address || '', netmask: iface.ipv4?.netmask || '', gateway: iface.ipv4?.gateway || '', setAsDefaultRoute: iface.isDefaultRoute || false },
      ipv6: { method: iface.ipv6?.method || 'auto', address: iface.ipv6?.address || '', prefixLength: iface.ipv6?.prefixLength || '', gateway: iface.ipv6?.gateway || '' },
      dns: { method: iface.dns?.method || 'auto', servers: iface.dns?.servers || [''] },
      wireless: { ssid: iface.additionalInfo?.ssid || '', security: iface.additionalInfo?.security || 'none', password: '' },
      state: { up: getInterfaceState(iface) === 'up' },
    });
    setConfigDialogOpen(true);
  };

  const handleSaveConfig = async () => {
    try {
      const body = { ipv4: config.ipv4, state: config.state.up ? 'up' : 'down' };
      if (selectedInterface?.type === 'wireless' && config.wireless.ssid) body.wireless = config.wireless;
      const response = await fetch(`${getApiEndpoint('NETWORK.INTERFACES')}/${selectedInterface.name}`, {
        method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body),
      });
      if (!response.ok) { const e = await response.json(); throw new Error(e.error || 'Failed to update'); }
      setConfigDialogOpen(false);
      setTimeout(fetchInterfaces, 500);
    } catch (err) { setError('Failed to update interface: ' + err.message); }
  };

  const setDns = (servers) => setConfig(c => ({ ...c, dns: { ...c.dns, servers } }));

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-3">
      {interfaces.map((iface) => {
        const IfaceIcon = getInterfaceIcon(iface.type, iface.name);
        const active = isActive(iface);
        return (
          <Panel key={iface.name}>
            <PanelBody>
              {/* Interface header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <IfaceIcon size={16} style={{ color: active ? 'var(--app-accent)' : 'var(--app-text-3)' }} />
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--app-text-1)' }}>{iface.name}</span>
                  <StatusBadge variant="neutral">{getInterfaceType(iface.type, iface.name)}</StatusBadge>
                  <StatusBadge variant={active ? 'success' : 'neutral'} dot>{active ? 'Active' : 'Inactive'}</StatusBadge>
                  {iface.isDefaultRoute && <StatusBadge variant="accent">Default Route</StatusBadge>}
                  {iface.type === 'ethernet' && iface.carrier != null && (
                    <StatusBadge variant={iface.carrier ? 'success' : 'warning'}>{iface.carrier ? 'Cable Connected' : 'No Cable'}</StatusBadge>
                  )}
                </div>
                <AppButton variant="outline" onClick={() => handleConfigureInterface(iface)}>
                  <Settings size={13} />Configure
                </AppButton>
              </div>

              <div className="h-px mb-3" style={{ background: 'var(--app-border)' }} />

              {/* Meta: MAC + gateway */}
              {(iface.addresses?.[0]?.mac && iface.addresses[0].mac !== '00:00:00:00:00:00') || iface.gateway ? (
                <div className="flex flex-wrap gap-4 mb-3 text-[12.5px]">
                  {iface.addresses?.[0]?.mac && iface.addresses[0].mac !== '00:00:00:00:00:00' && (
                    <span style={{ color: 'var(--app-text-2)' }}>MAC: <MonoValue>{iface.addresses[0].mac}</MonoValue></span>
                  )}
                  {iface.gateway && (
                    <span style={{ color: 'var(--app-text-2)' }}>Gateway: <MonoValue>{iface.gateway}</MonoValue></span>
                  )}
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* IP Addresses */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Globe size={12} style={{ color: 'var(--app-text-3)' }} />
                    <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>IP Addresses</span>
                  </div>
                  {iface.addresses.length === 0 ? (
                    <p className="text-[12.5px] italic" style={{ color: 'var(--app-text-3)' }}>No IP addresses configured</p>
                  ) : (
                    <div className="space-y-1.5">
                      {iface.addresses.map((addr, idx) => (
                        <div key={idx} className="px-2.5 py-1.5 rounded-lg text-[12.5px]" style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <StatusBadge variant={addr.family === 'IPv4' ? 'accent' : 'neutral'}>{addr.family}</StatusBadge>
                            {addr.internal && <StatusBadge variant="neutral">Internal</StatusBadge>}
                          </div>
                          <div>
                            <span style={{ color: 'var(--app-text-2)' }}>Address: </span><MonoValue>{addr.address}</MonoValue>
                            <span className="ml-3" style={{ color: 'var(--app-text-2)' }}>Netmask: </span><MonoValue>{addr.netmask}</MonoValue>
                          </div>
                          {addr.subnet && (
                            <div className="mt-0.5">
                              <span style={{ color: 'var(--app-text-2)' }}>Subnet: </span><MonoValue>{addr.subnet}</MonoValue>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Routes */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Router size={12} style={{ color: 'var(--app-text-3)' }} />
                    <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>Routes</span>
                  </div>
                  {iface.routes.length === 0 ? (
                    <p className="text-[12.5px] italic" style={{ color: 'var(--app-text-3)' }}>No routes configured</p>
                  ) : (
                    <div className="space-y-1">
                      {iface.routes.slice(0, 3).map((route, idx) => (
                        <div key={idx} className="px-2.5 py-1 rounded-lg" style={{ background: 'var(--app-bg)', border: '1px solid var(--app-border)' }}>
                          <MonoValue className="text-[11.5px] break-all">{route}</MonoValue>
                        </div>
                      ))}
                      {iface.routes.length > 3 && (
                        <p className="text-[11.5px] italic" style={{ color: 'var(--app-text-3)' }}>+{iface.routes.length - 3} more routes…</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Wireless info */}
                {Object.keys(iface.additionalInfo || {}).length > 0 && (
                  <div className="md:col-span-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Wifi size={12} style={{ color: 'var(--app-text-3)' }} />
                      <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>Wireless</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(iface.additionalInfo).map(([k, v]) => (
                        <StatusBadge key={k} variant="neutral">{k}: {v}</StatusBadge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </PanelBody>
          </Panel>
        );
      })}

      {/* Config dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedInterface?.type === 'wireless' ? <Wifi size={16} /> : <Settings size={16} />}
              Configure {selectedInterface?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Interface state */}
            <div className="px-4 py-3 rounded-lg" style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border)' }}>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-[13.5px] font-medium" style={{ color: 'var(--app-text-1)' }}>Interface Enabled</p>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--app-text-3)' }}>Enable or disable this network interface</p>
                </div>
                <Switch checked={config.state.up} onCheckedChange={v => setConfig(c => ({ ...c, state: { up: v } }))} />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* IPv4 */}
              <div className="p-4 rounded-lg space-y-3" style={{ border: '1px solid var(--app-border)' }}>
                <h3 className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--app-text-1)' }}>
                  <Globe size={13} style={{ color: 'var(--app-accent-text)' }} />IPv4 Configuration
                </h3>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium" style={{ color: 'var(--app-text-2)' }}>Method</label>
                  <RadixSelect value={config.ipv4.method} onValueChange={v => setConfig(c => ({ ...c, ipv4: { ...c.ipv4, method: v } }))}>
                    <SelectTrigger className="h-8 text-[13px]" style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}>
                      <SelectItem value="auto">Automatic (DHCP)</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </RadixSelect>
                </div>
                {config.ipv4.method === 'manual' && (
                  <div className="space-y-2">
                    <AppInput placeholder="192.168.1.100" label="IP Address" value={config.ipv4.address} onChange={e => setConfig(c => ({ ...c, ipv4: { ...c.ipv4, address: e.target.value } }))} />
                    <AppInput placeholder="255.255.255.0" label="Subnet Mask" value={config.ipv4.netmask} onChange={e => setConfig(c => ({ ...c, ipv4: { ...c.ipv4, netmask: e.target.value } }))} />
                    <AppInput placeholder="192.168.1.1" label="Gateway" value={config.ipv4.gateway} onChange={e => setConfig(c => ({ ...c, ipv4: { ...c.ipv4, gateway: e.target.value } }))} />
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={config.ipv4.setAsDefaultRoute}
                        onChange={e => setConfig(c => ({ ...c, ipv4: { ...c.ipv4, setAsDefaultRoute: e.target.checked } }))}
                        className="rounded"
                      />
                      <span className="text-[12px]" style={{ color: 'var(--app-text-2)' }}>Set as default route</span>
                    </label>
                  </div>
                )}
                {config.ipv4.method === 'auto' && (
                  <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'var(--app-accent-sub)', color: 'var(--app-accent-text)' }}>
                    IP address and gateway will be obtained automatically via DHCP.
                  </p>
                )}
              </div>

              {/* IPv6 */}
              <div className="p-4 rounded-lg space-y-3" style={{ border: '1px solid var(--app-border)' }}>
                <h3 className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--app-text-1)' }}>
                  <Globe size={13} style={{ color: 'var(--app-accent-text)' }} />IPv6 Configuration
                </h3>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-medium" style={{ color: 'var(--app-text-2)' }}>Method</label>
                  <RadixSelect value={config.ipv6.method} onValueChange={v => setConfig(c => ({ ...c, ipv6: { ...c.ipv6, method: v } }))}>
                    <SelectTrigger className="h-8 text-[13px]" style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}>
                      <SelectItem value="auto">Automatic (SLAAC/DHCPv6)</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </RadixSelect>
                </div>
                {config.ipv6.method === 'manual' && (
                  <div className="space-y-2">
                    <AppInput placeholder="2001:db8::1" label="IPv6 Address" value={config.ipv6.address} onChange={e => setConfig(c => ({ ...c, ipv6: { ...c.ipv6, address: e.target.value } }))} />
                    <AppInput placeholder="64" label="Prefix Length" value={config.ipv6.prefixLength} onChange={e => setConfig(c => ({ ...c, ipv6: { ...c.ipv6, prefixLength: e.target.value } }))} />
                    <AppInput placeholder="2001:db8::1" label="Gateway" value={config.ipv6.gateway} onChange={e => setConfig(c => ({ ...c, ipv6: { ...c.ipv6, gateway: e.target.value } }))} />
                  </div>
                )}
                {config.ipv6.method === 'auto' && (
                  <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'var(--app-accent-sub)', color: 'var(--app-accent-text)' }}>
                    IPv6 will be configured automatically via router advertisements or DHCPv6.
                  </p>
                )}
              </div>
            </div>

            {/* DNS */}
            <div className="p-4 rounded-lg space-y-3" style={{ border: '1px solid var(--app-border)' }}>
              <h3 className="text-[13px] font-semibold" style={{ color: 'var(--app-text-1)' }}>DNS Configuration</h3>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium" style={{ color: 'var(--app-text-2)' }}>Method</label>
                <RadixSelect value={config.dns.method} onValueChange={v => setConfig(c => ({ ...c, dns: { ...c.dns, method: v } }))}>
                  <SelectTrigger className="h-8 text-[13px]" style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}>
                    <SelectItem value="auto">Automatic (from DHCP)</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </RadixSelect>
              </div>
              {config.dns.method === 'manual' && (
                <div className="space-y-2">
                  <label className="text-[12px] font-medium" style={{ color: 'var(--app-text-2)' }}>DNS Servers</label>
                  {config.dns.servers.map((server, i) => (
                    <div key={i} className="flex gap-2">
                      <AppInput
                        placeholder={i === 0 ? '8.8.8.8' : '8.8.4.4'}
                        value={server}
                        onChange={e => { const s = [...config.dns.servers]; s[i] = e.target.value; setDns(s); }}
                        className="flex-1"
                      />
                      {config.dns.servers.length > 1 && (
                        <IconBtn onClick={() => setDns(config.dns.servers.filter((_, j) => j !== i))} title="Remove">
                          <X size={12} />
                        </IconBtn>
                      )}
                    </div>
                  ))}
                  <AppButton variant="outline" onClick={() => setDns([...config.dns.servers, ''])}>
                    <Plus size={13} />Add DNS Server
                  </AppButton>
                </div>
              )}
            </div>

            {/* Wireless */}
            {selectedInterface?.type === 'wireless' && (
              <div className="p-4 rounded-lg space-y-3" style={{ border: `1px solid var(--app-accent)`, background: 'var(--app-accent-sub)' }}>
                <h3 className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--app-text-1)' }}>
                  <Wifi size={13} style={{ color: 'var(--app-accent-text)' }} />Wireless Configuration
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <AppInput label="Network Name (SSID)" placeholder="MyWiFiNetwork" value={config.wireless.ssid} onChange={e => setConfig(c => ({ ...c, wireless: { ...c.wireless, ssid: e.target.value } }))} />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium" style={{ color: 'var(--app-text-2)' }}>Security Type</label>
                    <RadixSelect value={config.wireless.security} onValueChange={v => setConfig(c => ({ ...c, wireless: { ...c.wireless, security: v } }))}>
                      <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}>
                        <SelectItem value="none">None (Open)</SelectItem>
                        <SelectItem value="wpa-psk">WPA-PSK</SelectItem>
                        <SelectItem value="wpa2-psk">WPA2-PSK (recommended)</SelectItem>
                        <SelectItem value="wpa3-psk">WPA3-PSK (most secure)</SelectItem>
                      </SelectContent>
                    </RadixSelect>
                  </div>
                  {config.wireless.security !== 'none' && (
                    <div className="md:col-span-2 relative">
                      <AppInput
                        label="Network Password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter network password"
                        value={config.wireless.password}
                        onChange={e => setConfig(c => ({ ...c, wireless: { ...c.wireless, password: e.target.value } }))}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-[34px]"
                        style={{ color: 'var(--app-text-3)' }}
                      >
                        {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4 gap-2">
            <AppButton variant="outline" onClick={() => setConfigDialogOpen(false)}>Cancel</AppButton>
            <AppButton onClick={handleSaveConfig}>Save Configuration</AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NetworkInterfaces;
