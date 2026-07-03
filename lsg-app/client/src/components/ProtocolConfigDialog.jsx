import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Save, Plus, Trash2, Search, Edit2, X, RefreshCw, Info } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select as RadixSelect,
  SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AppAlert, AppButton, AppInput, IconBtn } from './ui/app-ui';

const API_BASE_URL = 'http://localhost:3001/api';

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

const cellInputCls = 'w-full h-7 rounded border border-[var(--app-border)] bg-[var(--app-surface)] px-1.5 text-[12px] text-[var(--app-text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]';
const cellSelectCls = 'w-full h-7 rounded border border-[var(--app-border)] bg-[var(--app-surface)] px-1 text-[12px] text-[var(--app-text-1)] focus:outline-none';

const CsvTableRow = React.memo(({ row, actualIndex, columns, onFieldChange, onRowDelete }) => (
  <tr className="border-b border-[var(--app-border)] hover:bg-[var(--app-bg)] transition-colors">
    {columns.map(({ field, type, options }) => (
      <td key={field} className="px-2 py-1">
        {type === 'select' ? (
          <select
            value={row[field] || ''}
            onChange={(e) => onFieldChange(actualIndex, field, e.target.value)}
            className={cellSelectCls}
          >
            <option value="" disabled>Select…</option>
            {options.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
            {row[field] && !options.find(opt => opt.value === row[field]) && (
              <option value={row[field]}>{row[field]} (Unknown)</option>
            )}
          </select>
        ) : (
          <input
            type={type}
            value={row[field] || ''}
            onChange={(e) => onFieldChange(actualIndex, field, e.target.value)}
            autoComplete="off"
            className={cellInputCls}
          />
        )}
      </td>
    ))}
    <td className="px-2 py-1 w-10">
      <IconBtn variant="danger" onClick={() => onRowDelete(actualIndex)}>
        <Trash2 size={12} />
      </IconBtn>
    </td>
  </tr>
));
CsvTableRow.displayName = 'CsvTableRow';

const ProtocolConfigDialog = ({ open, onClose, protocol, getAuthHeaders }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [csvConfig, setCsvConfig] = useState([]);
  const [sysParameters, setSysParameters] = useState({
    mqtt: { host: '', port: 1883, username: '', password: '', subTopics: [], qos: 0, keepalive: 60, clientId: '' },
    http: { host: '', port: 8000, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json' } },
    opcServer: '',
    interPollDelay: 100,
    modbusTimeout: 1000,
    connectRetryCount: 3,
    pollRetryCount: 3,
    connectRetryTime: 30000,
    pollConnectionType: 'persist',
    modbusType: 'tcp',
    posting: 'http',
  });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editingHeader, setEditingHeader] = useState(null);
  const [newHeaderKey, setNewHeaderKey] = useState('');
  const [newHeaderValue, setNewHeaderValue] = useState('');
  const [showAddHeader, setShowAddHeader] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const columns = useMemo(() => [
    { field: 'device', label: 'Device', type: 'text' },
    { field: 'slave', label: 'Slave', type: 'text' },
    { field: 'address', label: 'Address', type: 'text' },
    { field: 'tag', label: 'Tag', type: 'text' },
    { field: 'resolution', label: 'Resolution', type: 'number' },
    {
      field: 'datatype', label: 'Datatype', type: 'select',
      options: [
        { value: 'float', label: 'Float' }, { value: 'integer', label: 'Integer' },
        { value: 'string', label: 'String' }, { value: 'REAL', label: 'REAL' },
        { value: 'Boolean', label: 'Boolean' }, { value: 'DINT', label: 'DINT' },
        { value: 'INT', label: 'INT' }, { value: 'UINT', label: 'UINT' },
        { value: 'UDINT', label: 'UDINT' }, { value: 'BYTE', label: 'BYTE' },
        { value: 'WORD', label: 'WORD' }, { value: 'DWORD', label: 'DWORD' },
        { value: 'LREAL', label: 'LREAL' }, { value: 'STRING', label: 'STRING' },
        { value: 'WSTRING', label: 'WSTRING' },
      ],
    },
    { field: 'server', label: 'Server', type: 'text' },
    { field: 'lograte', label: 'Lograte', type: 'text' },
  ], []);

  const filteredConfig = useMemo(() => {
    if (!debouncedSearch) return csvConfig;
    return csvConfig.filter(row =>
      Object.values(row).some(v => String(v).toLowerCase().includes(debouncedSearch.toLowerCase()))
    );
  }, [csvConfig, debouncedSearch]);

  useEffect(() => { setPage(0); }, [debouncedSearch]);

  useEffect(() => {
    if (open && protocol) fetchConfig();
  }, [open, protocol]);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/polling/protocols/${protocol}/config`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (response.ok) {
        setCsvConfig(data.csv_config || []);
        setSysParameters(data.sys_parameters || {});
        setError(null);
      } else {
        throw new Error(data.message || 'Failed to fetch configuration');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const csvResponse = await fetch(`${API_BASE_URL}/polling/protocols/${protocol}/config/csv`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: csvConfig }),
      });
      if (!csvResponse.ok) throw new Error('Failed to save CSV configuration');

      const paramResponse = await fetch(`${API_BASE_URL}/polling/protocols/${protocol}/config/parameters`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(sysParameters),
      });
      if (!paramResponse.ok) throw new Error('Failed to save parameters configuration');

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = useCallback((index, field, value) => {
    setCsvConfig(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const handleRowDelete = useCallback((index) => {
    setCsvConfig(prev => prev.filter((_, i) => i !== index));
    const newTotal = csvConfig.length - 1;
    const maxPage = Math.ceil(newTotal / rowsPerPage) - 1;
    if (page > maxPage && maxPage >= 0) setPage(maxPage);
  }, [csvConfig.length, page, rowsPerPage]);

  const handleAddCsvRow = useCallback(() => {
    const newRow = { device: '', slave: '', address: '', tag: '', resolution: '1', datatype: 'REAL', server: '', lograte: '1000' };
    setCsvConfig(prev => [...prev, newRow]);
    const newTotal = csvConfig.length + 1;
    setPage(Math.ceil(newTotal / rowsPerPage) - 1);
  }, [csvConfig.length, rowsPerPage]);

  const handleSysParamChange = useCallback((section, field, value) => {
    if (section) {
      setSysParameters(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
    } else {
      setSysParameters(prev => ({ ...prev, [field]: value }));
    }
  }, []);

  const handleAddHeader = useCallback(() => {
    if (!newHeaderKey.trim() || !newHeaderValue.trim()) return;
    if (sysParameters.http.headers[newHeaderKey]) { setError(`Header "${newHeaderKey}" already exists`); return; }
    setSysParameters(prev => ({
      ...prev,
      http: { ...prev.http, headers: { ...prev.http.headers, [newHeaderKey.trim()]: newHeaderValue.trim() } },
    }));
    setNewHeaderKey(''); setNewHeaderValue(''); setShowAddHeader(false); setError(null);
  }, [newHeaderKey, newHeaderValue, sysParameters.http.headers]);

  const handleDeleteHeader = useCallback((key) => {
    setSysParameters(prev => {
      const nh = { ...prev.http.headers };
      delete nh[key];
      return { ...prev, http: { ...prev.http, headers: nh } };
    });
  }, []);

  const addQuickHeader = useCallback((key, value) => {
    if (!sysParameters.http.headers[key]) {
      setSysParameters(prev => ({
        ...prev,
        http: { ...prev.http, headers: { ...prev.http.headers, [key]: value } },
      }));
    }
  }, [sysParameters.http.headers]);

  const startIndex = page * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedConfig = filteredConfig.slice(startIndex, endIndex);

  const selectStyle = { background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] flex flex-col"
        style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}
      >
        <DialogHeader className="pb-3 border-b border-[var(--app-border)] flex-shrink-0">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-[15px]">Protocol Configuration</DialogTitle>
            {loading && <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--app-text-3)' }} />}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {error && <AppAlert severity="error" className="mb-3 mt-2">{error}</AppAlert>}
          {success && <AppAlert severity="success" className="mb-3 mt-2">Configuration saved successfully!</AppAlert>}

          <Tabs defaultValue="csv" className="mt-2">
            <TabsList className="mb-4" style={{ background: 'var(--app-bg)', borderColor: 'var(--app-border)' }}>
              <TabsTrigger value="csv" className="text-[13px]">CSV Configuration</TabsTrigger>
              <TabsTrigger value="params" className="text-[13px]">System Parameters</TabsTrigger>
            </TabsList>

            {/* ── CSV Config ── */}
            <TabsContent value="csv">
              {loading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--app-text-3)' }} />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>
                      CSV Configuration
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--app-text-3)' }} />
                        <input
                          type="text"
                          placeholder="Search…"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="h-8 pl-8 pr-3 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] text-[12px] text-[var(--app-text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)] w-44"
                        />
                      </div>
                      <AppButton variant="outline" onClick={handleAddCsvRow}>
                        <Plus size={13} />
                        Add Row
                      </AppButton>
                    </div>
                  </div>

                  <div className="rounded-md border border-[var(--app-border)] overflow-hidden">
                    <div className="overflow-auto" style={{ maxHeight: 380 }}>
                      <table className="w-full text-[12px]" style={{ minWidth: 780 }}>
                        <thead>
                          <tr className="border-b border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                            {columns.map(col => (
                              <th key={col.field} className="px-2 py-2 text-left font-semibold text-[11px] uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>
                                {col.label}
                              </th>
                            ))}
                            <th className="px-2 py-2 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedConfig.length === 0 ? (
                            <tr>
                              <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>
                                {filteredConfig.length === 0 ? 'No rows. Click "Add Row" to begin.' : 'No rows match your search.'}
                              </td>
                            </tr>
                          ) : (
                            paginatedConfig.map((row, idx) => (
                              <CsvTableRow
                                key={startIndex + idx}
                                row={row}
                                actualIndex={startIndex + idx}
                                columns={columns}
                                onFieldChange={handleFieldChange}
                                onRowDelete={handleRowDelete}
                              />
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px]" style={{ color: 'var(--app-text-2)' }}>Rows per page:</span>
                        <select
                          value={rowsPerPage}
                          onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
                          className="h-7 px-1 rounded border border-[var(--app-border)] bg-[var(--app-surface)] text-[12px] text-[var(--app-text-1)] focus:outline-none"
                        >
                          {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[12px]" style={{ color: 'var(--app-text-2)' }}>
                          {filteredConfig.length === 0 ? '0' : `${startIndex + 1}–${Math.min(endIndex, filteredConfig.length)}`} of {filteredConfig.length}
                        </span>
                        <AppButton variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                          Prev
                        </AppButton>
                        <AppButton variant="outline" disabled={endIndex >= filteredConfig.length} onClick={() => setPage(p => p + 1)}>
                          Next
                        </AppButton>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── System Parameters ── */}
            <TabsContent value="params">
              {loading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--app-text-3)' }} />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* MQTT */}
                  <div className="rounded-md border border-[var(--app-border)] p-4 space-y-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>MQTT Configuration</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <AppInput label="Host" value={sysParameters.mqtt?.host || ''} onChange={(e) => handleSysParamChange('mqtt', 'host', e.target.value)} />
                      <AppInput label="Port" type="number" value={sysParameters.mqtt?.port || 1883} onChange={(e) => handleSysParamChange('mqtt', 'port', parseInt(e.target.value))} />
                      <AppInput label="Username" value={sysParameters.mqtt?.username || ''} onChange={(e) => handleSysParamChange('mqtt', 'username', e.target.value)} />
                      <AppInput label="Password" type="password" value={sysParameters.mqtt?.password || ''} onChange={(e) => handleSysParamChange('mqtt', 'password', e.target.value)} />
                      <AppInput label="Client ID" value={sysParameters.mqtt?.clientId || ''} onChange={(e) => handleSysParamChange('mqtt', 'clientId', e.target.value)} />
                      <AppInput label="QoS" type="number" value={sysParameters.mqtt?.qos ?? 0} onChange={(e) => handleSysParamChange('mqtt', 'qos', parseInt(e.target.value))} />
                      <AppInput label="Keepalive (s)" type="number" value={sysParameters.mqtt?.keepalive || 60} onChange={(e) => handleSysParamChange('mqtt', 'keepalive', parseInt(e.target.value))} />
                    </div>
                  </div>

                  {/* HTTP */}
                  <div className="rounded-md border border-[var(--app-border)] p-4 space-y-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>HTTP Configuration</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <AppInput label="Host" value={sysParameters.http?.host || ''} onChange={(e) => handleSysParamChange('http', 'host', e.target.value)} />
                      <AppInput label="Port" type="number" value={sysParameters.http?.port || 8000} onChange={(e) => handleSysParamChange('http', 'port', parseInt(e.target.value))} />
                      <div>
                        <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Method</label>
                        <RadixSelect value={sysParameters.http?.method || 'POST'} onValueChange={(v) => handleSysParamChange('http', 'method', v)}>
                          <SelectTrigger className="h-9 text-[13px]" style={selectStyle}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                            {['GET', 'POST', 'PUT', 'PATCH'].map(m => <SelectItem key={m} value={m} className="text-[13px]">{m}</SelectItem>)}
                          </SelectContent>
                        </RadixSelect>
                      </div>
                      <AppInput label="Path" value={sysParameters.http?.path || '/'} onChange={(e) => handleSysParamChange('http', 'path', e.target.value)} />
                    </div>

                    {/* HTTP Headers */}
                    <div className="border-t border-[var(--app-border)] pt-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>
                          HTTP Headers
                        </p>
                        <Info size={12} style={{ color: 'var(--app-text-3)' }} title="Custom HTTP headers for requests" />
                      </div>

                      {/* Quick add */}
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          ['Authorization', 'Bearer your-token-here'],
                          ['X-API-Key', 'your-api-key-here'],
                          ['User-Agent', 'LSG-Gateway/1.0'],
                          ['X-Request-ID', `req-${Date.now()}`],
                        ].map(([key, val]) => (
                          <AppButton
                            key={key}
                            variant="outline"
                            disabled={!!(sysParameters.http?.headers?.[key])}
                            onClick={() => addQuickHeader(key, val)}
                          >
                            + {key}
                          </AppButton>
                        ))}
                      </div>

                      {/* Headers list */}
                      <div className="space-y-1.5">
                        {Object.entries(sysParameters.http?.headers || {}).map(([key, value]) => (
                          <div
                            key={key}
                            className="flex items-center gap-2 p-2 rounded-md border border-[var(--app-border)]"
                            style={{ background: 'var(--app-bg)' }}
                          >
                            <span className="text-[12px] font-mono font-semibold flex-shrink-0 w-36 truncate" style={{ color: 'var(--app-accent)' }}>
                              {key}:
                            </span>
                            {editingHeader === key ? (
                              <>
                                <input
                                  value={value}
                                  onChange={(e) => setSysParameters(prev => ({
                                    ...prev,
                                    http: { ...prev.http, headers: { ...prev.http.headers, [key]: e.target.value } },
                                  }))}
                                  className="flex-1 h-7 rounded border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-[12px] font-mono text-[var(--app-text-1)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                                />
                                <IconBtn onClick={() => setEditingHeader(null)}><Save size={12} /></IconBtn>
                                <IconBtn onClick={() => setEditingHeader(null)}><X size={12} /></IconBtn>
                              </>
                            ) : (
                              <>
                                <span className="text-[12px] font-mono flex-1 truncate" style={{ color: 'var(--app-text-2)' }}>
                                  {value}
                                </span>
                                <IconBtn onClick={() => setEditingHeader(key)}><Edit2 size={12} /></IconBtn>
                                <IconBtn variant="danger" onClick={() => handleDeleteHeader(key)}><Trash2 size={12} /></IconBtn>
                              </>
                            )}
                          </div>
                        ))}
                        {Object.keys(sysParameters.http?.headers || {}).length === 0 && (
                          <p className="text-[12px] italic text-center py-2" style={{ color: 'var(--app-text-3)' }}>
                            No custom headers configured.
                          </p>
                        )}
                      </div>

                      {/* Add header form */}
                      {showAddHeader ? (
                        <div className="rounded-md border border-[var(--app-border)] p-3 space-y-3" style={{ background: 'var(--app-bg)' }}>
                          <p className="text-[12px] font-medium" style={{ color: 'var(--app-text-2)' }}>Add New Header</p>
                          <div className="grid grid-cols-2 gap-2">
                            <AppInput
                              label="Header Name"
                              placeholder="e.g., Authorization"
                              value={newHeaderKey}
                              onChange={(e) => setNewHeaderKey(e.target.value)}
                            />
                            <AppInput
                              label="Header Value"
                              placeholder="e.g., Bearer token123"
                              value={newHeaderValue}
                              onChange={(e) => setNewHeaderValue(e.target.value)}
                            />
                          </div>
                          <p className="text-[11px] italic" style={{ color: 'var(--app-text-3)' }}>
                            Tip: Use variables like {'${timestamp}'}, {'${deviceId}'} in header values for dynamic content
                          </p>
                          <div className="flex gap-2">
                            <AppButton onClick={handleAddHeader} disabled={!newHeaderKey.trim() || !newHeaderValue.trim()}>
                              Add
                            </AppButton>
                            <AppButton variant="outline" onClick={() => { setShowAddHeader(false); setNewHeaderKey(''); setNewHeaderValue(''); }}>
                              Cancel
                            </AppButton>
                          </div>
                        </div>
                      ) : (
                        <AppButton variant="outline" onClick={() => setShowAddHeader(true)}>
                          <Plus size={13} />
                          Add Custom Header
                        </AppButton>
                      )}
                    </div>
                  </div>

                  {/* Other Parameters */}
                  <div className="rounded-md border border-[var(--app-border)] p-4 space-y-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-3)' }}>Other Parameters</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <AppInput label="OPC Server" value={sysParameters.opcServer || ''} onChange={(e) => handleSysParamChange(null, 'opcServer', e.target.value)} />
                      <AppInput label="Inter Poll Delay (ms)" type="number" value={sysParameters.interPollDelay || 100} onChange={(e) => handleSysParamChange(null, 'interPollDelay', parseInt(e.target.value))} />
                      <AppInput label="Modbus Timeout (ms)" type="number" value={sysParameters.modbusTimeout || 1000} onChange={(e) => handleSysParamChange(null, 'modbusTimeout', parseInt(e.target.value))} />
                      <AppInput label="Connect Retry Count" type="number" value={sysParameters.connectRetryCount || 3} onChange={(e) => handleSysParamChange(null, 'connectRetryCount', parseInt(e.target.value))} />
                      <AppInput label="Poll Retry Count" type="number" value={sysParameters.pollRetryCount || 3} onChange={(e) => handleSysParamChange(null, 'pollRetryCount', parseInt(e.target.value))} />
                      <AppInput label="Connect Retry Time (ms)" type="number" value={sysParameters.connectRetryTime || 30000} onChange={(e) => handleSysParamChange(null, 'connectRetryTime', parseInt(e.target.value))} />
                      <div>
                        <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Poll Connection Type</label>
                        <RadixSelect value={sysParameters.pollConnectionType || 'persist'} onValueChange={(v) => handleSysParamChange(null, 'pollConnectionType', v)}>
                          <SelectTrigger className="h-9 text-[13px]" style={selectStyle}><SelectValue /></SelectTrigger>
                          <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                            <SelectItem value="persist" className="text-[13px]">Persist</SelectItem>
                            <SelectItem value="reconnect" className="text-[13px]">Reconnect</SelectItem>
                          </SelectContent>
                        </RadixSelect>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Modbus Type</label>
                        <RadixSelect value={sysParameters.modbusType || 'tcp'} onValueChange={(v) => handleSysParamChange(null, 'modbusType', v)}>
                          <SelectTrigger className="h-9 text-[13px]" style={selectStyle}><SelectValue /></SelectTrigger>
                          <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                            <SelectItem value="tcp" className="text-[13px]">TCP</SelectItem>
                            <SelectItem value="rtu" className="text-[13px]">RTU</SelectItem>
                          </SelectContent>
                        </RadixSelect>
                      </div>
                      <div>
                        <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Posting Method</label>
                        <RadixSelect value={sysParameters.posting || 'http'} onValueChange={(v) => handleSysParamChange(null, 'posting', v)}>
                          <SelectTrigger className="h-9 text-[13px]" style={selectStyle}><SelectValue /></SelectTrigger>
                          <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                            <SelectItem value="http" className="text-[13px]">HTTP</SelectItem>
                            <SelectItem value="mqtt" className="text-[13px]">MQTT</SelectItem>
                          </SelectContent>
                        </RadixSelect>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="gap-2 pt-3 border-t border-[var(--app-border)] flex-shrink-0">
          <AppButton variant="outline" onClick={onClose}>Cancel</AppButton>
          <AppButton onClick={handleSave} disabled={saving}>
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
            Save Changes
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ProtocolConfigDialog;
