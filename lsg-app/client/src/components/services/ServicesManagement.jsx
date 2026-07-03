import React, { useState, useCallback, useEffect } from 'react';
import { AppAlert } from '../ui/app-ui';
import { useLayout } from '../layout/Layout';
import SshPanel from './SshPanel';
import FtpPanel from './FtpPanel';
import VpnPanel from './VpnPanel';
import TimePanel from './TimePanel';
import ScheduledTasksPanel from './ScheduledTasksPanel';

export default function ServicesManagement() {
  const { registerRefresh } = useLayout();
  const [toast, setToast] = useState(null);

  const showSnackbar = useCallback((message, severity = 'success') => {
    setToast({ message, severity });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // registerRefresh expects a callback — panels manage their own refresh internally
  useEffect(() => {
    registerRefresh(() => {});
  }, [registerRefresh]);

  return (
    <div className="space-y-4">
      {toast && (
        <AppAlert severity={toast.severity} className="mb-2">
          {toast.message}
        </AppAlert>
      )}

      <SshPanel showSnackbar={showSnackbar} />
      <FtpPanel showSnackbar={showSnackbar} />
      <VpnPanel showSnackbar={showSnackbar} />
      <TimePanel showSnackbar={showSnackbar} />
      <ScheduledTasksPanel showSnackbar={showSnackbar} />
    </div>
  );
}
