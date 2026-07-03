import React, { createContext, useContext, useState, useCallback } from 'react';
import { Topbar } from './Topbar';

interface LayoutContextType {
  registerRefresh: (fn: () => Promise<void>) => void;
  serviceStatus: string | null;
  setServiceStatus: (status: string | null) => void;
  serviceLoading: string | null;
  setServiceLoading: (action: string | null) => void;
  onServiceAction: ((action: "start" | "stop" | "restart") => Promise<void>) | null;
  setOnServiceAction: (fn: (action: "start" | "stop" | "restart") => Promise<void>) => void;
  backendReachable: boolean | null;
  setBackendReachable: (reachable: boolean) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) throw new Error("useLayout must be used within a LayoutProvider");
  return context;
};

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [onRefresh, setOnRefresh] = useState<(() => Promise<void>) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  
  const [serviceStatus, setServiceStatus] = useState<string | null>(null);
  const [serviceLoading, setServiceLoading] = useState<string | null>(null);
  const [onServiceAction, setOnServiceAction] = useState<((action: "start" | "stop" | "restart") => Promise<void>) | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);

  const registerRefresh = useCallback((fn: () => Promise<void>) => {
    setOnRefresh(() => fn);
  }, []);

  // Wrapper so callers pass the function directly without knowing about React's
  // functional-update ambiguity (useState would invoke a plain fn as an updater).
  const registerServiceAction = useCallback((fn: (action: "start" | "stop" | "restart") => Promise<void>) => {
    setOnServiceAction(() => fn);
  }, []);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <LayoutContext.Provider value={{
      registerRefresh,
      serviceStatus,
      setServiceStatus,
      serviceLoading,
      setServiceLoading,
      onServiceAction,
      setOnServiceAction: registerServiceAction,
      backendReachable,
      setBackendReachable,
    }}>
      <div className="flex flex-col h-screen overflow-hidden bg-app-bg text-app-text1 font-sans">
        <Topbar
          onRefresh={onRefresh ? handleRefresh : null}
          refreshing={refreshing}
          serviceStatus={serviceStatus}
          serviceLoading={serviceLoading}
          onServiceAction={onServiceAction || undefined}
          backendReachable={backendReachable}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="w-full h-full">
            {children}
          </div>
        </main>
      </div>
    </LayoutContext.Provider>
  );
};
