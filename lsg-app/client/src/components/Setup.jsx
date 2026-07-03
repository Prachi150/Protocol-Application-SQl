import React, { useState, useCallback } from 'react';
import { Eye, EyeOff, User, Lock, Key, Github, Server, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppAlert } from './ui/app-ui';

// ── API ───────────────────────────────────────────────────────────────────────
const api = {
  status: () => fetch('/api/setup/status').then(r => r.json()),
  verifyToken: (token) =>
    fetch('/api/setup/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(r => r.json()),
  complete: (body, token) =>
    fetch('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Token': token },
      body: JSON.stringify(body),
    }).then(r => r.json()),
};

// ── Password strength ─────────────────────────────────────────────────────────
function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { label: 'Very weak', color: 'var(--app-danger)' },
    { label: 'Weak',      color: 'var(--app-danger)' },
    { label: 'Fair',      color: 'var(--app-warning)' },
    { label: 'Good',      color: 'var(--app-accent)' },
    { label: 'Strong',    color: 'var(--app-success)' },
    { label: 'Very strong', color: 'var(--app-success)' },
  ];
  return { score, ...levels[score] };
}

// ── Shared components ─────────────────────────────────────────────────────────
function SetupInput({ label, id, helperText, error, className, ...props }) {
  return (
    <div className={`flex flex-col gap-1.5 mb-4 ${className ?? ''}`}>
      {label && <label htmlFor={id} className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>{label}</label>}
      <input
        id={id}
        className="px-3 py-2 rounded-lg text-[13.5px] outline-none font-mono placeholder:font-sans"
        style={{
          background: 'var(--app-elevated)',
          border: `1px solid ${error ? 'var(--app-danger)' : 'var(--app-border-mid)'}`,
          color: 'var(--app-text-1)',
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--app-accent)'; }}
        onBlur={e => { e.target.style.borderColor = error ? 'var(--app-danger)' : 'var(--app-border-mid)'; }}
        {...props}
      />
      {helperText && (
        <span className="text-[11.5px]" style={{ color: error ? 'var(--app-danger)' : 'var(--app-text-3)' }}>{helperText}</span>
      )}
    </div>
  );
}

function PasswordInput({ label, id, helperText, error, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 mb-4">
      {label && <label htmlFor={id} className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>{label}</label>}
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className="w-full pl-3 pr-10 py-2 rounded-lg text-[13.5px] outline-none font-mono"
          style={{
            background: 'var(--app-elevated)',
            border: `1px solid ${error ? 'var(--app-danger)' : 'var(--app-border-mid)'}`,
            color: 'var(--app-text-1)',
          }}
          onFocus={e => { e.target.style.borderColor = 'var(--app-accent)'; }}
          onBlur={e => { e.target.style.borderColor = error ? 'var(--app-danger)' : 'var(--app-border-mid)'; }}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--app-text-3)' }}
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {helperText && (
        <span className="text-[11.5px]" style={{ color: error ? 'var(--app-danger)' : 'var(--app-text-3)' }}>{helperText}</span>
      )}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="flex items-center justify-center rounded-lg flex-shrink-0" style={{ width: 32, height: 32, background: 'var(--app-accent-sub)' }}>
        <Icon size={15} style={{ color: 'var(--app-accent-text)' }} />
      </div>
      <div>
        <h3 className="text-[14px] font-semibold" style={{ color: 'var(--app-text-1)' }}>{title}</h3>
        {subtitle && <p className="text-[12px] mt-0.5" style={{ color: 'var(--app-text-3)' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Step indicators ───────────────────────────────────────────────────────────
const STEPS = ['Admin Account', 'IoAdmin MQTT', 'GitHub & API Keys'];

function StepIndicator({ activeStep }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex flex-col items-center gap-1 flex-1">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors duration-200"
              style={{
                background: i < activeStep ? 'var(--app-success)' : i === activeStep ? 'var(--app-accent)' : 'var(--app-elevated)',
                color: i <= activeStep ? '#fff' : 'var(--app-text-3)',
                border: i > activeStep ? '1px solid var(--app-border)' : 'none',
              }}
            >
              {i < activeStep ? <CheckCircle2 size={13} /> : i + 1}
            </div>
            <span className="text-[10px] text-center leading-tight" style={{ color: i === activeStep ? 'var(--app-text-1)' : 'var(--app-text-3)' }}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className="h-px flex-1 mb-5" style={{ background: i < activeStep ? 'var(--app-success)' : 'var(--app-border)' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Main setup wizard ─────────────────────────────────────────────────────────
export default function Setup() {
  const navigate = useNavigate();

  const [activeStep, setActiveStep] = useState(0);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [tokenVerified, setTokenVerified] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenVerifying, setTokenVerifying] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const [form, setForm] = useState({
    adminUsername: '',
    adminPassword: '',
    confirmPassword: '',
    masterMqttHost: 'hap.faclon.com',
    masterMqttPort: '1883',
    masterMqttUsername: '',
    masterMqttPassword: '',
    githubToken: '',
    apiKeys: '',
  });

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));
  const strength = passwordStrength(form.adminPassword);

  const pollUntilConfigured = useCallback(() => {
    const interval = setInterval(async () => {
      try {
        const data = await api.status();
        if (data.configured) {
          clearInterval(interval);
          navigate('/login', { replace: true });
        }
      } catch { /* service restarting */ }
    }, 2000);
  }, [navigate]);

  const handleVerifyToken = async () => {
    setTokenError('');
    setTokenVerifying(true);
    try {
      const res = await api.verifyToken(tokenInput.trim());
      if (!res.success) throw new Error(res.message || 'Invalid token');
      setSetupToken(tokenInput.trim());
      setTokenVerified(true);
    } catch (err) {
      setTokenError(err.message);
    } finally {
      setTokenVerifying(false);
    }
  };

  const stepValid = useCallback(() => {
    switch (activeStep) {
      case 0: return form.adminUsername.trim().length >= 2 && form.adminPassword.length >= 8 && form.adminPassword === form.confirmPassword;
      case 1: return form.masterMqttHost.trim().length > 0 && /^\d+$/.test(form.masterMqttPort.trim()) && form.masterMqttUsername.trim().length > 0 && form.masterMqttPassword.length > 0;
      case 2: return form.githubToken.trim().length > 10;
      default: return false;
    }
  }, [activeStep, form]);

  const allValid =
    form.adminUsername.trim().length >= 2
    && form.adminPassword.length >= 8
    && form.adminPassword === form.confirmPassword
    && form.masterMqttHost.trim().length > 0
    && /^\d+$/.test(form.masterMqttPort.trim())
    && form.masterMqttUsername.trim().length > 0
    && form.masterMqttPassword.length > 0
    && form.githubToken.trim().length > 10;

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const res = await api.complete({
        adminUsername: form.adminUsername.trim(),
        adminPassword: form.adminPassword,
        confirmPassword: form.confirmPassword,
        masterMqttHost: form.masterMqttHost.trim(),
        masterMqttPort: form.masterMqttPort.trim(),
        masterMqttUsername: form.masterMqttUsername.trim(),
        masterMqttPassword: form.masterMqttPassword,
        githubToken: form.githubToken.trim(),
        apiKeys: form.apiKeys.trim() || undefined,
      }, setupToken);
      if (!res.success) throw new Error(res.message || 'Setup failed');
      setRestarting(true);
      pollUntilConfigured();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: 'var(--app-bg)' }}>
      <div
        className="w-full max-w-[520px] rounded-xl p-8"
        style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div
            className="flex items-center justify-center rounded-xl mb-4 font-mono text-[13px] font-semibold text-white"
            style={{ width: 48, height: 48, background: 'var(--app-accent)', letterSpacing: '-0.3px' }}
          >
            I/O
          </div>
          <h1 className="text-[20px] font-semibold" style={{ color: 'var(--app-text-1)' }}>Device Setup</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--app-text-3)' }}>
            Configure credentials for this I/OConnect gateway. One-time setup.
          </p>
        </div>

        {/* Restarting overlay */}
        {restarting && (
          <div className="flex flex-col items-center gap-4 py-8">
            <RefreshCw size={40} className="animate-spin" style={{ color: 'var(--app-accent)' }} />
            <div className="text-center">
              <h3 className="text-[15px] font-semibold mb-1" style={{ color: 'var(--app-text-1)' }}>Setting up your device…</h3>
              <p className="text-[13px]" style={{ color: 'var(--app-text-2)' }}>Encrypting secrets and restarting the service.</p>
              <p className="text-[13px]" style={{ color: 'var(--app-text-3)' }}>This usually takes 5–10 seconds.</p>
            </div>
          </div>
        )}

        {/* Token gate */}
        {!restarting && !tokenVerified && (
          <div>
            <SectionHeader icon={Key} title="Setup Token" subtitle="Enter the token printed by the installer on the device terminal" />
            {tokenError && <AppAlert severity="error" className="mb-3">{tokenError}</AppAlert>}
            <PasswordInput
              id="setup-token-input"
              label="Setup Token"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              autoFocus
              placeholder="e.g. a3f8c2d1…"
              onKeyDown={e => { if (e.key === 'Enter' && tokenInput.trim()) handleVerifyToken(); }}
            />
            <button
              id="setup-verify-token-btn"
              disabled={!tokenInput.trim() || tokenVerifying}
              onClick={handleVerifyToken}
              className="w-full py-2.5 rounded-lg text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ background: 'var(--app-accent)' }}
            >
              <Key size={14} />
              {tokenVerifying ? 'Verifying…' : 'Verify Token'}
            </button>
          </div>
        )}

        {/* Multi-step wizard */}
        {!restarting && tokenVerified && (
          <div>
            <StepIndicator activeStep={activeStep} />

            {error && <AppAlert severity="error" className="mb-4">{error}</AppAlert>}

            {/* Step 0: Admin Account */}
            {activeStep === 0 && (
              <div>
                <SectionHeader icon={User} title="Admin Account" subtitle="Credentials for the I/OConnect management UI" />
                <SetupInput id="setup-admin-username" label="Admin Username" value={form.adminUsername} onChange={set('adminUsername')} autoFocus placeholder="admin" />
                <PasswordInput id="setup-admin-password" label="Password (min. 8 characters)" value={form.adminPassword} onChange={set('adminPassword')} />
                {form.adminPassword.length > 0 && (
                  <div className="flex items-center gap-2 mb-4 -mt-2">
                    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--app-border)' }}>
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${(strength.score / 5) * 100}%`, background: strength.color }} />
                    </div>
                    <span className="text-[11.5px] font-medium whitespace-nowrap" style={{ color: strength.color }}>{strength.label}</span>
                  </div>
                )}
                <PasswordInput
                  id="setup-confirm-password"
                  label="Confirm Password"
                  value={form.confirmPassword}
                  onChange={set('confirmPassword')}
                  error={form.confirmPassword.length > 0 && form.adminPassword !== form.confirmPassword}
                  helperText={form.confirmPassword.length > 0 && form.adminPassword !== form.confirmPassword ? 'Passwords do not match' : ''}
                />
              </div>
            )}

            {/* Step 1: IoAdmin MQTT */}
            {activeStep === 1 && (
              <div>
                <SectionHeader icon={Server} title="IoAdmin MQTT" subtitle="Broker address and credentials to connect this device to the IoAdmin platform" />
                <SetupInput id="setup-master-mqtt-host" label="MQTT Host" value={form.masterMqttHost} onChange={set('masterMqttHost')} autoFocus placeholder="hap.faclon.com" />
                <SetupInput id="setup-master-mqtt-port" label="MQTT Port" value={form.masterMqttPort} onChange={set('masterMqttPort')} placeholder="1883" />
                <SetupInput id="setup-master-mqtt-username" label="MQTT Username" value={form.masterMqttUsername} onChange={set('masterMqttUsername')} />
                <PasswordInput id="setup-master-mqtt-password" label="MQTT Password" value={form.masterMqttPassword} onChange={set('masterMqttPassword')} />
              </div>
            )}

            {/* Step 2: GitHub token & API keys */}
            {activeStep === 2 && (
              <div>
                <SectionHeader icon={Github} title="GitHub Token" subtitle="Personal access token for downloading protocol app packages" />
                <PasswordInput id="setup-github-token" label="GitHub Personal Access Token" value={form.githubToken} onChange={set('githubToken')} autoFocus placeholder="ghp_…" />

                <div className="h-px my-4" style={{ background: 'var(--app-border)' }} />

                <SectionHeader icon={Key} title="IoT API Keys" subtitle="Optional — comma-separated keys for IoT device authentication" />
                <div className="flex flex-col gap-1.5 mb-4">
                  <label className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>API Keys (optional, comma-separated)</label>
                  <textarea
                    id="setup-api-keys"
                    rows={2}
                    value={form.apiKeys}
                    onChange={set('apiKeys')}
                    placeholder="key-abc123, key-def456"
                    className="px-3 py-2 rounded-lg text-[13.5px] outline-none font-mono resize-none"
                    style={{ background: 'var(--app-elevated)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}
                    onFocus={e => { e.target.style.borderColor = 'var(--app-accent)'; }}
                    onBlur={e => { e.target.style.borderColor = 'var(--app-border-mid)'; }}
                  />
                  <span className="text-[11.5px]" style={{ color: 'var(--app-text-3)' }}>You can add more keys later from the Data Forwarding settings.</span>
                </div>

                <AppAlert severity={allValid ? 'success' : 'warning'}>
                  {allValid
                    ? 'All required fields are complete. Ready to set up the device.'
                    : 'Please go back and complete all required fields before submitting.'}
                </AppAlert>
              </div>
            )}

            {/* Navigation buttons */}
            <div className="flex gap-3 mt-5">
              {activeStep > 0 && (
                <button
                  id="setup-back-btn"
                  onClick={() => setActiveStep(s => s - 1)}
                  className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-85"
                  style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border-mid)', color: 'var(--app-text-1)' }}
                >
                  Back
                </button>
              )}

              {activeStep < STEPS.length - 1 ? (
                <button
                  id="setup-next-btn"
                  disabled={!stepValid()}
                  onClick={() => setActiveStep(s => s + 1)}
                  className="flex-1 py-2.5 rounded-lg text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'var(--app-accent)' }}
                >
                  Next
                </button>
              ) : (
                <button
                  id="setup-submit-btn"
                  disabled={!allValid || submitting}
                  onClick={handleSubmit}
                  className="flex-1 py-2.5 rounded-lg text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ background: 'var(--app-accent)' }}
                >
                  <CheckCircle2 size={14} />
                  {submitting ? 'Saving…' : 'Complete Setup'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
