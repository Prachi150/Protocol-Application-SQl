import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import { getApiEndpoint } from '../config/api';
import { useLayout } from './layout/Layout';
import {
  Panel, PanelHeader, PanelBody, DataRow, MonoValue,
  StatusBadge, AppAlert, AppInput, AppButton, PageSpinner,
} from './ui/app-ui';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

const Onboarding = () => {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [adminUrl, setAdminUrl] = useState('');
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [resetDialog, setResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { registerRefresh } = useLayout();

  const fetchStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      const response = await axios.get(getApiEndpoint('ONBOARDING.STATUS'));
      setOnboardingStatus(response.data);
      if (!response.data.onboarded) setShowForm(true);
    } catch {
      setShowForm(true);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { registerRefresh(fetchStatus); }, [registerRefresh, fetchStatus]);

  const handleReset = async () => {
    setResetDialog(false);
    setResetting(true);
    setError(null);
    try {
      const response = await axios.post(getApiEndpoint('ONBOARDING.RESET'));
      if (response.data.success) {
        const count = response.data.uninstalledApps.length;
        setSuccess(count > 0
          ? `Reset complete. Uninstalled ${count} app(s): ${response.data.uninstalledApps.join(', ')}`
          : 'Reset complete. No apps were installed.');
        setOnboardingStatus(null);
        setShowForm(true);
      } else {
        setError(response.data.message || 'Reset failed');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await axios.post(getApiEndpoint('ONBOARDING.ONBOARD'), {
        token,
        adminUrl: adminUrl || undefined,
      });
      if (response.data.success) {
        setSuccess('Onboarding successful! Redirecting…');
        setTimeout(() => { window.location.href = '/'; }, 2000);
      } else {
        setError(response.data.message || 'Onboarding failed');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Onboarding failed');
    } finally {
      setLoading(false);
    }
  };

  if (statusLoading) return <PageSpinner />;

  return (
    <div className="max-w-lg">
      {error && <AppAlert severity="error" className="mb-4">{error}</AppAlert>}
      {success && <AppAlert severity="success" className="mb-4">{success}</AppAlert>}

      {/* Already onboarded */}
      {onboardingStatus?.onboarded && !showForm && (
        <Panel>
          <PanelHeader icon={CheckCircle2} iconColor="success" title="Device Onboarding" subtitle="Platform registration & asset link" />
          <PanelBody>
            <AppAlert severity="info" className="mb-4">This device is already linked to an asset.</AppAlert>

            <DataRow label="Status">
              <StatusBadge variant="success" dot>Onboarded</StatusBadge>
            </DataRow>
            <DataRow label="Admin Server">
              <MonoValue>{onboardingStatus.onboarding.adminUrl}</MonoValue>
            </DataRow>
            <DataRow label="Connection Mode">
              <StatusBadge variant="accent">{onboardingStatus.onboarding.connectionMode ?? 'direct'}</StatusBadge>
            </DataRow>
            <DataRow label="Onboarded At" last>
              <MonoValue>{new Date(onboardingStatus.onboarding.onboardedAt).toLocaleString()}</MonoValue>
            </DataRow>

            <div className="flex gap-3 mt-5">
              <AppButton
                variant="destructive"
                onClick={() => setResetDialog(true)}
                disabled={resetting}
                className="flex-1"
              >
                <RotateCcw size={14} />
                {resetting ? 'Resetting…' : 'Re-onboard (Reset)'}
              </AppButton>
              <AppButton variant="default" onClick={() => window.location.href = '/overview'} className="flex-1">
                Go to Dashboard
              </AppButton>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* Onboarding form */}
      {showForm && (
        <Panel>
          <PanelHeader icon={CheckCircle2} iconColor="accent" title="Device Onboarding" subtitle="Connect this asset to the Admin Server" />
          <PanelBody>
            <p className="text-[13.5px] mb-5" style={{ color: 'var(--app-text-2)' }}>
              Enter your onboarding token to connect this asset to the Admin Server.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <AppInput
                label="Onboarding Token"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={loading}
              />
              <AppInput
                label="Admin Server URL (optional)"
                placeholder="http://10.8.0.1:4017"
                helperText="Leave empty to use configured default"
                value={adminUrl}
                onChange={(e) => setAdminUrl(e.target.value)}
                disabled={loading}
              />
              <AppButton type="submit" disabled={loading} className="w-full justify-center py-2.5 mt-1">
                {loading ? 'Onboarding…' : 'Onboard Asset'}
              </AppButton>
            </form>
          </PanelBody>
        </Panel>
      )}

      {/* Reset confirmation dialog */}
      <Dialog open={resetDialog} onOpenChange={setResetDialog}>
        <DialogContent style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)', color: 'var(--app-text-1)' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} style={{ color: 'var(--app-warning)' }} />
              Confirm Reset
            </DialogTitle>
            <DialogDescription style={{ color: 'var(--app-text-2)' }}>
              This will:
              <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>Uninstall all installed protocol apps</li>
                <li>Stop the heartbeat service</li>
                <li>Clear the current onboarding link</li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <AppButton variant="outline" onClick={() => setResetDialog(false)}>Cancel</AppButton>
            <AppButton variant="destructive" onClick={handleReset}>Reset & Re-onboard</AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Onboarding;
