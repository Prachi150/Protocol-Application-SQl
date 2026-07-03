import React, { createContext, useContext, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

const LayoutContext = createContext({});
export const useLayout = () => useContext(LayoutContext);

export default function Layout({ children }) {
  const [refreshFn, setRefreshFn] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const registerRefresh = (fn) => setRefreshFn(() => fn);

  const handleRefresh = async () => {
    if (!refreshFn) return;
    setRefreshing(true);
    try { await refreshFn(); } finally { setRefreshing(false); }
  };

  return (
    <LayoutContext.Provider value={{ registerRefresh }}>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--app-bg)' }}>
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar onRefresh={refreshFn ? handleRefresh : undefined} refreshing={refreshing} />
          <main
            className="flex-1 overflow-y-auto"
            style={{ padding: '22px 24px' }}
          >
            {children}
          </main>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}
