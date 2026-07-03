import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, Search, ChevronUp, ChevronDown } from 'lucide-react';
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

const FirewallManagement = ({ setError }) => {
  const { getAuthHeaders } = useAuth();
  const [status, setStatus] = useState(null);
  const [rules, setRules] = useState([]);
  const [filteredRules, setFilteredRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addRuleDialogOpen, setAddRuleDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('number');
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(0);
  const rowsPerPage = 10;
  const isMounted = useRef(true);
  const isInitialMount = useRef(true);

  const [newRules, setNewRules] = useState([{
    action: 'allow', direction: 'in', protocol: 'tcp', port: '', from: 'any', to: 'any', ipVersion: 'ipv4',
  }]);

  const fetchFirewallData = useCallback(async () => {
    if (!isMounted.current) return;
    const headers = getAuthHeaders();
    try {
      const [statusRes, rulesRes] = await Promise.all([
        fetch(getApiEndpoint('NETWORK.FIREWALL.STATUS'), { headers }),
        fetch(getApiEndpoint('NETWORK.FIREWALL.RULES'), { headers }),
      ]);
      if (!isMounted.current) return;
      if (!statusRes.ok || !rulesRes.ok) throw new Error('Failed to fetch firewall data');
      const [statusData, rulesData] = await Promise.all([statusRes.json(), rulesRes.json()]);
      if (!isMounted.current) return;
      setStatus(statusData.data);
      setRules(rulesData.data);
      setLoading(false);
    } catch (err) {
      if (!isMounted.current) return;
      setError('Failed to load firewall data: ' + err.message);
      setLoading(false);
    }
  }, [getAuthHeaders, setError]);

  useEffect(() => {
    isMounted.current = true;
    if (isInitialMount.current) { isInitialMount.current = false; fetchFirewallData(); }
    return () => { isMounted.current = false; };
  }, [fetchFirewallData]);

  useEffect(() => {
    let filtered = rules.filter(rule => {
      const q = searchQuery.toLowerCase();
      return rule.action.toLowerCase().includes(q) || rule.direction.toLowerCase().includes(q) ||
        (rule.proto?.toLowerCase().includes(q)) || (rule.port?.toString().includes(q)) ||
        rule.from.toLowerCase().includes(q) || rule.ipVersion.toLowerCase().includes(q) ||
        rule.number.toString().includes(q);
    });
    filtered.sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (sortField === 'number') { av = parseInt(av); bv = parseInt(bv); }
      else if (sortField === 'port') { av = parseInt(av) || 0; bv = parseInt(bv) || 0; }
      else if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      return av < bv ? (sortDirection === 'asc' ? -1 : 1) : av > bv ? (sortDirection === 'asc' ? 1 : -1) : 0;
    });
    setFilteredRules(filtered);
    setPage(0);
  }, [rules, searchQuery, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };

  const handleFirewallToggle = async () => {
    const newState = !status?.enabled;
    try {
      const res = await fetch(getApiEndpoint(newState ? 'NETWORK.FIREWALL.ENABLE' : 'NETWORK.FIREWALL.DISABLE'), {
        method: 'POST', headers: getAuthHeaders(),
      });
      if (res.ok) { setStatus(p => ({ ...p, enabled: newState })); fetchFirewallData(); }
      else { const e = await res.json(); throw new Error(e.message || 'Failed to toggle firewall'); }
    } catch (err) { setError(err.message); }
  };

  const handleAddRule = async () => {
    try {
      const res = await fetch(getApiEndpoint('NETWORK.FIREWALL.RULES'), {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ rules: newRules.map(r => ({ action: r.action, direction: r.direction, from: r.from || 'any', to: r.to || 'any', port: r.port, proto: r.protocol === 'any' ? null : r.protocol, ipVersion: r.ipVersion })) }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to add rules'); }
      setAddRuleDialogOpen(false);
      setTimeout(fetchFirewallData, 2000);
    } catch (err) { setError('Failed to add firewall rules: ' + err.message); }
  };

  const handleDeleteRule = async (ruleNum) => {
    try {
      const res = await fetch(`${getApiEndpoint('NETWORK.FIREWALL.RULES')}/${ruleNum}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to delete firewall rule');
      setTimeout(fetchFirewallData, 2000);
    } catch (err) { setError('Failed to delete firewall rule: ' + err.message); }
  };

  const ruleChange = (idx, field, value) => setNewRules(r => r.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  const paginated = filteredRules.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const totalPages = Math.ceil(filteredRules.length / rowsPerPage);

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      {/* Status + controls */}
      <Panel>
        <PanelBody>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--app-text-3)' }} />
                <input
                  placeholder="Search rules…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg text-[13px] outline-none w-56"
                  style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}
                  onFocus={e => e.target.style.borderColor = 'var(--app-accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--app-border-mid)'}
                />
              </div>
              <AppButton onClick={() => setAddRuleDialogOpen(true)}>
                <Plus size={13} />Add Rule
              </AppButton>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <span className="text-[13px]" style={{ color: 'var(--app-text-2)' }}>Firewall</span>
              <Switch checked={status?.enabled ?? false} onCheckedChange={handleFirewallToggle} />
              <StatusBadge variant={status?.enabled ? 'success' : 'neutral'} dot>
                {status?.enabled ? 'Enabled' : 'Disabled'}
              </StatusBadge>
            </label>
          </div>
        </PanelBody>
      </Panel>

      {/* Rules table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--app-border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ background: 'var(--app-elevated)', borderBottom: '1px solid var(--app-border)' }}>
                {[['number', 'No'], ['action', 'Action'], ['direction', 'Direction'], ['proto', 'Protocol'], ['port', 'Port'], ['from', 'From'], ['ipVersion', 'IP Version']].map(([field, label]) => (
                  <th
                    key={field}
                    className="px-3 py-2.5 text-left font-semibold cursor-pointer select-none"
                    style={{ color: 'var(--app-text-2)' }}
                    onClick={() => handleSort(field)}
                  >
                    <span className="flex items-center gap-1">{label}<SortIcon field={field} /></span>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-left font-semibold" style={{ color: 'var(--app-text-2)' }}>Delete</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-[13px]" style={{ color: 'var(--app-text-3)' }}>
                    No firewall rules found.
                  </td>
                </tr>
              ) : paginated.map((rule) => (
                <tr
                  key={rule.number}
                  className="transition-colors duration-[100ms]"
                  style={{ borderBottom: '1px solid var(--app-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--app-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <td className="px-3 py-2"><MonoValue>{rule.number}</MonoValue></td>
                  <td className="px-3 py-2">
                    <StatusBadge variant={rule.action === 'allow' ? 'success' : 'danger'}>
                      {rule.action === 'allow' ? 'Allowed' : 'Denied'}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge variant={rule.direction?.toLowerCase() === 'in' ? 'success' : rule.direction?.toLowerCase() === 'out' ? 'warning' : 'neutral'}>
                      {rule.direction?.toUpperCase() || 'ANY'}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2">
                    {rule.proto
                      ? <StatusBadge variant="accent">{rule.proto.toUpperCase()}</StatusBadge>
                      : <span style={{ color: 'var(--app-text-3)' }}>ANY</span>}
                  </td>
                  <td className="px-3 py-2"><MonoValue>{rule.port || 'ANY'}</MonoValue></td>
                  <td className="px-3 py-2" style={{ maxWidth: 150 }}>
                    <MonoValue className="block truncate" title={rule.from}>{rule.from}</MonoValue>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge variant={rule.ipVersion === 'ipv4' ? 'accent' : 'neutral'}>
                      {rule.ipVersion.toUpperCase()}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2">
                    <IconBtn variant="danger" onClick={() => handleDeleteRule(rule.number)} title="Delete rule">
                      <Trash2 size={13} />
                    </IconBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 text-[12.5px]" style={{ borderTop: '1px solid var(--app-border)', background: 'var(--app-elevated)' }}>
            <span style={{ color: 'var(--app-text-2)' }}>
              {page * rowsPerPage + 1}–{Math.min((page + 1) * rowsPerPage, filteredRules.length)} of {filteredRules.length} rules
            </span>
            <div className="flex items-center gap-1">
              <AppButton variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-7 px-2 text-[12px]">Prev</AppButton>
              <AppButton variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="h-7 px-2 text-[12px]">Next</AppButton>
            </div>
          </div>
        )}
      </div>

      {/* Add rule dialog */}
      <Dialog open={addRuleDialogOpen} onOpenChange={setAddRuleDialogOpen}>
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}
        >
          <DialogHeader>
            <DialogTitle>Add New Firewall Rules</DialogTitle>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            {newRules.map((rule, idx) => (
              <div key={idx} className="relative p-4 rounded-lg space-y-3" style={{ border: '1px solid var(--app-border)', background: 'var(--app-elevated)' }}>
                {idx > 0 && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <StatusBadge variant="accent">Rule {idx + 1}</StatusBadge>
                  </div>
                )}
                {newRules.length > 1 && (
                  <IconBtn
                    className="absolute bottom-2 right-2"
                    onClick={() => setNewRules(r => r.filter((_, i) => i !== idx))}
                    title="Remove"
                  >
                    <Trash2 size={12} style={{ color: 'var(--app-danger)' }} />
                  </IconBtn>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { field: 'action', label: 'Action', options: [['allow', 'Allow'], ['deny', 'Deny']] },
                    { field: 'direction', label: 'Direction', options: [['in', 'Inbound'], ['out', 'Outbound']] },
                    { field: 'protocol', label: 'Protocol', options: [['any', 'Any'], ['tcp', 'TCP'], ['udp', 'UDP'], ['icmp', 'ICMP']] },
                    { field: 'ipVersion', label: 'IP Version', options: [['ipv4', 'IPv4'], ['ipv6', 'IPv6']] },
                  ].map(({ field, label, options }) => (
                    <div key={field} className="flex flex-col gap-1">
                      <label className="text-[12px] font-medium" style={{ color: 'var(--app-text-2)' }}>{label}</label>
                      <RadixSelect value={rule[field]} onValueChange={v => ruleChange(idx, field, v)}>
                        <SelectTrigger className="h-8 text-[12.5px]" style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}>
                          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                        </SelectContent>
                      </RadixSelect>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2" style={{ paddingRight: newRules.length > 1 ? 36 : 0 }}>
                  <AppInput label="Port" placeholder="80 or 80-443" value={rule.port} onChange={e => ruleChange(idx, 'port', e.target.value)} />
                  <AppInput label="From (Source)" placeholder="IP or 'any'" value={rule.from} onChange={e => ruleChange(idx, 'from', e.target.value)} />
                  <AppInput label="To (Destination)" placeholder="IP or 'any'" value={rule.to} onChange={e => ruleChange(idx, 'to', e.target.value)} />
                </div>
              </div>
            ))}

            <AppButton
              variant="outline"
              onClick={() => setNewRules(r => [...r, { action: 'allow', direction: 'in', protocol: 'tcp', port: '', from: 'any', to: 'any', ipVersion: 'ipv4' }])}
            >
              <Plus size={13} />Add Another Rule
            </AppButton>
          </div>

          <DialogFooter className="mt-4 gap-2">
            <AppButton variant="outline" onClick={() => setAddRuleDialogOpen(false)}>Cancel</AppButton>
            <AppButton onClick={handleAddRule}>Save Rules</AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FirewallManagement;
