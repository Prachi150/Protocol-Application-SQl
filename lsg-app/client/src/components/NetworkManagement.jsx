import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageContainer, AppAlert } from './ui/app-ui';
import NetworkInterfaces from './network/NetworkInterfaces';
import FirewallManagement from './network/FirewallManagement';
import ConnectivityStatus from './network/ConnectivityStatus';

const NetworkManagement = () => {
  const [error, setError] = useState(null);

  return (
    <PageContainer>
      {error && <AppAlert severity="error">{error}</AppAlert>}
      <Tabs defaultValue="interfaces">
        <TabsList
          className="h-auto p-0 gap-0 rounded-none border-b bg-transparent"
          style={{ borderColor: 'var(--app-border)' }}
        >
          {['interfaces', 'firewall', 'connectivity'].map((tab, i) => {
            const labels = { interfaces: 'Network Interfaces', firewall: 'Firewall', connectivity: 'Connectivity' };
            return (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent px-5 py-3 text-[13px] font-medium data-[state=active]:border-[var(--app-accent)] data-[state=active]:text-[var(--app-accent-text)] data-[state=active]:bg-transparent bg-transparent"
                style={{ color: 'var(--app-text-2)' }}
              >
                {labels[tab]}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="interfaces" className="mt-4">
          <NetworkInterfaces setError={setError} />
        </TabsContent>
        <TabsContent value="firewall" className="mt-4">
          <FirewallManagement setError={setError} />
        </TabsContent>
        <TabsContent value="connectivity" className="mt-4">
          <ConnectivityStatus setError={setError} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
};

export default NetworkManagement;
