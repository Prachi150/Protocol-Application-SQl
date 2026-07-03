import React from 'react';
import { Play, Square, RotateCcw, Terminal, Sun, Moon, ServerCrash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusBadge, IconBtn, Spinner } from './ui/app-ui';
import { useAppTheme } from './ThemeContext';

interface TopbarProps {
  title?: string;
  onRefresh?: (() => Promise<void>) | null;
  refreshing?: boolean;
  serviceStatus?: string | null;
  serviceLoading?: string | null;
  onServiceAction?: (action: "start" | "stop" | "restart") => Promise<void>;
  backendReachable?: boolean | null;
}

export const Topbar: React.FC<TopbarProps> = ({
  title = import.meta.env.VITE_APP_NAME || "Configurator",
  serviceStatus,
  serviceLoading,
  onServiceAction,
  backendReachable,
}) => {
  const { darkMode, toggleDarkMode } = useAppTheme();
  const isRunning = serviceStatus === "active";

  return (
    <header className="h-[64px] min-h-[64px] bg-app-surface border-b border-app-border px-6 flex items-center justify-between z-40">
      <div className="flex items-center gap-2">
        {/* Logo Area */}
        <div className="flex items-center gap-2">
          <div className="w-[28px] h-[28px] rounded-lg bg-app-accent flex items-center justify-center text-white shrink-0">
            <Terminal size={16} />
          </div>
          <h1 className="text-[15px] font-bold text-app-text1 whitespace-nowrap">
            I/O Connect
          </h1>
        </div>

        <div className="h-4 w-px bg-app-border mx-1" />
        
        <h2 className="text-[14px] font-medium text-app-text2">{title}</h2>
      </div>

      <div className="flex items-center gap-4">
        {/* Service Controls in Topbar */}
        <div className="flex items-center gap-2">
          {backendReachable === false && (
            <StatusBadge variant="warning">
              <ServerCrash size={12} />
              Backend offline
            </StatusBadge>
          )}
          {serviceStatus !== null && (
            <StatusBadge variant={isRunning ? "success" : "danger"} dot>
              {isRunning ? "Running" : "Stopped"}
            </StatusBadge>
          )}
          
          <div className="flex items-center gap-1">
            <IconBtn 
              variant="success" 
              title="Start" 
              disabled={serviceLoading !== null || isRunning}
              onClick={() => onServiceAction?.("start")}
            >
              {serviceLoading === "start" ? <Spinner size={13} /> : <Play size={13} />}
            </IconBtn>
            <IconBtn 
              variant="danger" 
              title="Stop" 
              disabled={serviceLoading !== null || !isRunning}
              onClick={() => onServiceAction?.("stop")}
            >
              {serviceLoading === "stop" ? <Spinner size={13} /> : <Square size={13} />}
            </IconBtn>
            <IconBtn 
              variant="warning" 
              title="Restart" 
              disabled={serviceLoading !== null}
              onClick={() => onServiceAction?.("restart")}
            >
              {serviceLoading === "restart" ? <Spinner size={13} /> : <RotateCcw size={13} />}
            </IconBtn>
          </div>
        </div>

        <div className="h-4 w-px bg-app-border mx-1" />

        {/* Theme Toggle */}
        <button 
          onClick={toggleDarkMode}
          className="p-2 rounded-lg text-app-text2 hover:bg-app-neutral-sub hover:text-app-text1 transition-colors"
          title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
};
