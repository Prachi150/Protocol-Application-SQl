import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { Loader2 } from 'lucide-react';
import Login from './components/Login';
import Setup from './components/Setup';
import Overview from './components/Overview';
import NetworkManagement from './components/NetworkManagement';
import ServicesManagement from './components/services/ServicesManagement';
import DataForwardingManagement from './components/DataForwardingManagement';
import DataPollingManagement from './components/DataPollingManagement';
import Onboarding from './components/Onboarding';
import Layout from './components/layout/Layout';

const Spinner = () => (
  <div className="flex items-center justify-center h-screen" style={{ background: 'var(--app-bg)' }}>
    <Loader2 className="w-8 h-8 animate-spin text-app-accent" style={{ color: 'var(--app-accent)' }} />
  </div>
);

const ProtectedLayout = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" />;
  return <Layout>{children}</Layout>;
};

const AppRoutes = () => {
  const { user, loading } = useAuth();
  const [setupChecked, setSetupChecked] = useState(false);
  const [setupConfigured, setSetupConfigured] = useState(true);

  useEffect(() => {
    fetch('/api/setup/status')
      .then(r => r.json())
      .then(data => { setSetupConfigured(data.configured); setSetupChecked(true); })
      .catch(() => setSetupChecked(true));
  }, []);

  if (!setupChecked || loading) return <Spinner />;

  if (!setupConfigured) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/overview"   element={<ProtectedLayout><Overview /></ProtectedLayout>} />
      <Route path="/network"    element={<ProtectedLayout><NetworkManagement /></ProtectedLayout>} />
      <Route path="/services"   element={<ProtectedLayout><ServicesManagement /></ProtectedLayout>} />
      <Route path="/polling"    element={<ProtectedLayout><DataPollingManagement /></ProtectedLayout>} />
      <Route path="/forwarding" element={<ProtectedLayout><DataForwardingManagement /></ProtectedLayout>} />
      <Route path="/onboard"    element={<ProtectedLayout><Onboarding /></ProtectedLayout>} />
      <Route path="/" element={user ? <Navigate to="/overview" replace /> : <Navigate to="/login" replace />} />
    </Routes>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}
