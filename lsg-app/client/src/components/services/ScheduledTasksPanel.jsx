import React, { useState, useCallback, useEffect } from 'react';
import { CalendarClock, Trash2, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getApiEndpoint, API_CONFIG } from '../../config/api';
import {
  Panel, PanelHeader, PanelBody, StatusBadge, AppButton, AppInput,
} from '../ui/app-ui';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select as RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { IconBtn } from '../ui/app-ui';

const nativeInputCls = [
  'w-full h-9 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)]',
  'px-3 text-[13px] text-[var(--app-text-1)]',
  'focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

const toDatetimeLocal = (date = new Date()) => {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function formatRecurringSchedule(type, value) {
  try {
    switch (type?.toLowerCase()) {
      case 'daily': {
        const [h, m] = value.split(':').map(Number);
        const t = new Date(); t.setHours(h, m, 0, 0);
        return `Daily – ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
      }
      case 'weekly': {
        const parts = value.split(/[@\s]+/);
        if (parts.length >= 2) {
          const dayNum = parseInt(parts[0]);
          const [wh, wm] = parts[1].split(':').map(Number);
          const wt = new Date(); wt.setHours(wh, wm, 0, 0);
          const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          return `Weekly on ${days[dayNum] ?? `Day ${dayNum}`} – ${wt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
        }
        return `Weekly – ${value}`;
      }
      default:
        return `${type} – ${value}`;
    }
  } catch {
    return `${type} – ${value}`;
  }
}

export default function ScheduledTasksPanel({ showSnackbar }) {
  const { getAuthHeaders } = useAuth();

  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState({ oneTime: [], recurring: [] });
  const [actions, setActions] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Dialog form state
  const [scheduleAction, setScheduleAction] = useState('restart-system');
  const [restartType, setRestartType] = useState('immediate');
  const [scheduledDateTime, setScheduledDateTime] = useState(() => toDatetimeLocal());
  const [allowActiveUsers, setAllowActiveUsers] = useState(false);
  const [recurringType, setRecurringType] = useState('daily');
  const [dailyTime, setDailyTime] = useState('22:00');
  const [weeklyDay, setWeeklyDay] = useState('1');
  const [weeklyTime, setWeeklyTime] = useState('22:00');

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(getApiEndpoint('REMOTE.RESTART'), { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch schedules');
      setSchedules(await res.json());
    } catch (err) {
      showSnackbar(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, showSnackbar]);

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch(API_CONFIG.ENDPOINTS.SCHEDULE_ACTIONS, { headers: getAuthHeaders() });
      if (!res.ok) return;
      setActions(await res.json());
    } catch {
      // non-critical
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchSchedules();
    fetchActions();
  }, [fetchSchedules, fetchActions]);

  const resetForm = () => {
    setScheduleAction('restart-system');
    setRestartType('immediate');
    setScheduledDateTime(toDatetimeLocal());
    setAllowActiveUsers(false);
    setRecurringType('daily');
    setDailyTime('22:00');
    setWeeklyTime('22:00');
    setWeeklyDay('1');
  };

  const handleSubmit = async () => {
    try {
      const payload = { type: restartType };
      switch (restartType) {
        case 'immediate':
          payload.force = true;
          break;
        case 'scheduled':
          payload.datetime = new Date(scheduledDateTime).toISOString();
          payload.allowActiveUsers = allowActiveUsers;
          break;
        case 'recurring': {
          const value = recurringType === 'daily' ? dailyTime : `${weeklyDay}@${weeklyTime}`;
          payload.schedule = { type: recurringType, value, action: scheduleAction };
          break;
        }
        default:
          throw new Error('Invalid type');
      }
      const res = await fetch(getApiEndpoint('REMOTE.RESTART'), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to schedule task');
      showSnackbar('Task scheduled successfully');
      setDialogOpen(false);
      resetForm();
      fetchSchedules();
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  };

  const handleCancel = async (id) => {
    try {
      const res = await fetch(getApiEndpoint('REMOTE.RESTART') + `/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to cancel task');
      showSnackbar('Task cancelled');
      fetchSchedules();
    } catch (err) {
      showSnackbar(err.message, 'error');
    }
  };

  const getActionLabel = (key) => {
    const a = actions.find(a => a.key === key);
    return a ? a.label : key || 'Restart system';
  };

  const formatDateTime = (dt) => {
    if (!dt) return 'N/A';
    return new Date(dt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <>
      <Panel>
        <PanelHeader
          icon={CalendarClock}
          iconColor="accent"
          title="Scheduled Tasks"
          subtitle="Automated system actions via cron"
          right={
            <AppButton variant="outline" onClick={() => { resetForm(); setDialogOpen(true); }} disabled={loading}>
              <Clock size={13} />
              Add Task
            </AppButton>
          }
        />
        <PanelBody>
          {loading ? (
            <p className="text-[13px] italic" style={{ color: 'var(--app-text-3)' }}>Loading schedules…</p>
          ) : (
            <div className="space-y-5">
              {/* One-time */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--app-text-3)' }}>
                  Scheduled One-time Tasks
                </p>
                {schedules.oneTime.length > 0 ? (
                  <div className="space-y-2">
                    {schedules.oneTime.map((s) => (
                      <div key={s.id} className="flex items-start justify-between p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>One-time Restart</span>
                            <StatusBadge variant="accent">One-time</StatusBadge>
                          </div>
                          <p className="text-[12px]" style={{ color: 'var(--app-text-1)' }}>Scheduled: {formatDateTime(s.datetime)}</p>
                          <p className="text-[12px]" style={{ color: 'var(--app-text-2)' }}>Allow Active Users: {s.allowActiveUsers ? 'Yes' : 'No'}</p>
                        </div>
                        <IconBtn onClick={() => handleCancel(s.id)} variant="danger"><Trash2 size={13} /></IconBtn>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] italic text-center py-3" style={{ color: 'var(--app-text-3)' }}>No one-time tasks scheduled.</p>
                )}
              </div>

              {/* Recurring */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--app-text-3)' }}>
                  Recurring Tasks
                </p>
                {schedules.recurring.length > 0 ? (
                  <div className="space-y-2">
                    {schedules.recurring.map((s) => (
                      <div key={s.id} className="flex items-start justify-between p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>{getActionLabel(s.action)}</span>
                            <StatusBadge variant="warning">Recurring</StatusBadge>
                          </div>
                          <p className="text-[12px]" style={{ color: 'var(--app-text-1)' }}>{formatRecurringSchedule(s.type, s.value)}</p>
                        </div>
                        <IconBtn onClick={() => handleCancel(s.id)} variant="danger"><Trash2 size={13} /></IconBtn>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] italic text-center py-3" style={{ color: 'var(--app-text-3)' }}>No recurring tasks configured.</p>
                )}
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* Add Task Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Clock size={16} style={{ color: 'var(--app-accent)' }} />
              Add Scheduled Task
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Task Type</label>
              <RadixSelect value={restartType} onValueChange={setRestartType}>
                <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                  <SelectItem value="immediate" className="text-[13px]">Immediate</SelectItem>
                  <SelectItem value="scheduled" className="text-[13px]">Scheduled One-time</SelectItem>
                  <SelectItem value="recurring" className="text-[13px]">Recurring</SelectItem>
                </SelectContent>
              </RadixSelect>
            </div>

            {restartType === 'recurring' && actions.length > 0 && (
              <div>
                <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Action</label>
                <RadixSelect value={scheduleAction} onValueChange={setScheduleAction}>
                  <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                    {actions.map(a => (
                      <SelectItem key={a.key} value={a.key} className="text-[13px]">{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </RadixSelect>
              </div>
            )}

            {restartType === 'scheduled' && (
              <div className="space-y-3 p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                <div>
                  <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Date & Time</label>
                  <input type="datetime-local" value={scheduledDateTime} onChange={(e) => setScheduledDateTime(e.target.value)} className={nativeInputCls} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--app-text-1)' }}>Allow Active Users</span>
                  <Switch checked={allowActiveUsers} onCheckedChange={setAllowActiveUsers} />
                </div>
              </div>
            )}

            {restartType === 'recurring' && (
              <div className="space-y-3 p-3 rounded-md border border-[var(--app-border)]" style={{ background: 'var(--app-bg)' }}>
                <div>
                  <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Schedule Type</label>
                  <RadixSelect value={recurringType} onValueChange={setRecurringType}>
                    <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                      <SelectItem value="daily" className="text-[13px]">Daily</SelectItem>
                      <SelectItem value="weekly" className="text-[13px]">Weekly</SelectItem>
                    </SelectContent>
                  </RadixSelect>
                </div>
                {recurringType === 'daily' && (
                  <div>
                    <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Time</label>
                    <input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className={nativeInputCls} />
                  </div>
                )}
                {recurringType === 'weekly' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Day</label>
                      <RadixSelect value={weeklyDay} onValueChange={setWeeklyDay}>
                        <SelectTrigger className="h-9 text-[13px]" style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)', color: 'var(--app-text-1)' }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent style={{ background: 'var(--app-surface)', borderColor: 'var(--app-border)' }}>
                          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                            <SelectItem key={i} value={String(i)} className="text-[13px]">{d}</SelectItem>
                          ))}
                        </SelectContent>
                      </RadixSelect>
                    </div>
                    <div>
                      <label className="text-[12px] font-medium mb-1.5 block" style={{ color: 'var(--app-text-2)' }}>Time</label>
                      <input type="time" value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} className={nativeInputCls} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <AppButton variant="outline" onClick={() => setDialogOpen(false)}>Cancel</AppButton>
            <AppButton onClick={handleSubmit}>
              {restartType === 'immediate' ? 'Execute Now' : 'Schedule Task'}
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
