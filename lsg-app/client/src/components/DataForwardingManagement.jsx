import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageContainer } from './ui/app-ui';
import { useAuth } from '../context/AuthContext';
import { useLayout } from './layout/Layout';
import { getApiEndpoint } from '../config/api';
import OverviewTab   from './dataforwarding/OverviewTab';
import BrokerConfigForm from './dataforwarding/broker/BrokerConfigForm';
import PipelinesTab  from './dataforwarding/PipelinesTab';
import TopicsTab     from './dataforwarding/TopicsTab';
import LogsTab       from './dataforwarding/LogsTab';

const tabStyle = "rounded-none border-b-2 border-transparent px-5 py-3 text-[13px] font-medium data-[state=active]:border-[var(--app-accent)] data-[state=active]:text-[var(--app-accent-text)] data-[state=active]:bg-transparent bg-transparent";

export default function DataForwardingManagement() {
  const { getAuthHeaders }    = useAuth();
  const { registerRefresh }   = useLayout();

  const [tab, setTab]                     = useState('overview');
  const [editingPipeline, setEditingPipeline] = useState(null);
  const [status, setStatus]               = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError]     = useState(null);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res  = await fetch(getApiEndpoint('REDPANDA.STATUS'), { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok) setStatus(data);
      else setStatusError(data.error || 'Failed to fetch status');
    } catch (e) {
      setStatusError('Network error: ' + e.message);
    } finally {
      setStatusLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { registerRefresh(fetchStatus); }, [registerRefresh, fetchStatus]);

  const handleEditPipeline = (name) => {
    setEditingPipeline(name);
    setTab('pipelines');
  };

  const handlePipelineDeployed = () => {
    fetchStatus();
  };

  return (
    <PageContainer>
      <Tabs value={tab} onValueChange={v => { setTab(v); if (v !== 'pipelines') setEditingPipeline(null); }}>
        <TabsList className="h-auto p-0 gap-0 rounded-none border-b bg-transparent" style={{ borderColor: 'var(--app-border)' }}>
          {[['overview', 'Overview'], ['broker', 'Broker Config'], ['pipelines', 'Pipelines'], ['topics', 'Topics'], ['logs', 'Logs']].map(([v, l]) => (
            <TabsTrigger key={v} value={v} className={tabStyle} style={{ color: 'var(--app-text-2)' }}>{l}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            status={status}
            statusLoading={statusLoading}
            statusError={statusError}
            onRefresh={fetchStatus}
            onEditPipeline={handleEditPipeline}
          />
        </TabsContent>

        <TabsContent value="broker">
          <div className="mt-4">
            <BrokerConfigForm />
          </div>
        </TabsContent>

        <TabsContent value="pipelines">
          <PipelinesTab
            editingPipeline={editingPipeline}
            onEditClear={() => setEditingPipeline(null)}
            onDeployed={handlePipelineDeployed}
          />
        </TabsContent>

        <TabsContent value="topics">
          <TopicsTab />
        </TabsContent>

        <TabsContent value="logs">
          <LogsTab pipelines={status?.pipelines ?? []} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
