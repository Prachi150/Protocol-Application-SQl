import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import {
  LayoutDashboard, Wifi, Wrench, Puzzle, Upload,
  ShieldCheck, Sun, Moon, LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SIDEBAR_W   = 62;
const SIDEBAR_EXP = 256;

const NAV = [
  { id: 'overview',   label: 'Overview',        icon: LayoutDashboard, path: '/overview' },
  { id: 'network',    label: 'Network',          icon: Wifi,            path: '/network' },
  { id: 'services',   label: 'Services',          icon: Wrench,          path: '/services' },
  { id: 'polling',    label: 'Protocol Apps',    icon: Puzzle,          path: '/polling' },
  { id: 'forwarding', label: 'Data Forwarding',  icon: Upload,          path: '/forwarding' },
  { id: 'onboard',    label: 'Onboarding',       icon: ShieldCheck,     path: '/onboard' },
];

function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group/item relative flex items-center gap-[11px] w-full px-[11px] py-[9px] rounded-lg',
        'text-left transition-colors duration-[130ms] overflow-hidden whitespace-nowrap',
        active
          ? 'bg-[var(--app-accent-sub)] text-[var(--app-accent-text)]'
          : 'text-[var(--app-text-2)] hover:bg-[var(--app-elevated)] hover:text-[var(--app-text-1)]',
      )}
    >
      {active && (
        <span className="absolute left-0 top-[24%] bottom-[24%] w-[3px] rounded-r-[3px] bg-[var(--app-accent)]" />
      )}
      <Icon size={17} className="flex-shrink-0" />
      <span className="text-[13.5px] font-medium opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-[140ms] delay-[40ms]">
        {label}
      </span>
    </button>
  );
}

export default function Sidebar() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, logout } = useAuth();
  const { darkMode, toggleDarkMode } = useAppTheme();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <aside
      className="group/sidebar flex flex-col h-screen flex-shrink-0 overflow-hidden transition-[width] duration-[220ms] ease-out"
      style={{
        width: SIDEBAR_W,
        minWidth: SIDEBAR_W,
        background: 'var(--app-surface)',
        borderRight: '1px solid var(--app-border)',
      }}
      onMouseEnter={e => { e.currentTarget.style.width = `${SIDEBAR_EXP}px`; }}
      onMouseLeave={e => { e.currentTarget.style.width = `${SIDEBAR_W}px`; }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 overflow-hidden flex-shrink-0"
        style={{ height: 64, minHeight: 64, padding: '0 14px', borderBottom: '1px solid var(--app-border)' }}
      >
        <div
          className="flex items-center justify-center flex-shrink-0 rounded-lg text-white font-mono text-[11px] font-semibold tracking-tight"
          style={{ width: 34, height: 34, minWidth: 34, background: 'var(--app-accent)', letterSpacing: '-0.3px' }}
        >
          I/O
        </div>
        <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-[150ms] delay-[50ms] overflow-hidden">
          <p className="text-[13.5px] font-bold text-[var(--app-text-1)] whitespace-nowrap leading-tight">
            Faclon I/OConnect
          </p>
          <p className="text-[11.5px] text-[var(--app-text-3)] font-normal whitespace-nowrap leading-tight">
            Management Portal
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-hidden px-2 py-2.5 space-y-0.5">
        {NAV.map(item => (
          <NavItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={location.pathname === item.path}
            onClick={() => navigate(item.path)}
          />
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '8px', borderTop: '1px solid var(--app-border)' }}>
        {/* Theme toggle */}
        <button
          onClick={toggleDarkMode}
          className={cn(
            'flex items-center gap-[11px] w-full px-[11px] py-[9px] rounded-lg mb-1',
            'text-[var(--app-text-2)] hover:bg-[var(--app-elevated)] hover:text-[var(--app-text-1)]',
            'transition-colors duration-[130ms] overflow-hidden whitespace-nowrap',
          )}
        >
          {darkMode
            ? <Sun size={17} className="flex-shrink-0" />
            : <Moon size={17} className="flex-shrink-0" />}
          <span className="text-[13.5px] font-medium opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-[140ms] delay-[40ms]">
            {darkMode ? 'Light Mode' : 'Dark Mode'}
          </span>
        </button>

        {/* User / logout */}
        <button
          onClick={handleLogout}
          className={cn(
            'flex items-center gap-[11px] w-full px-[11px] py-[9px] rounded-lg',
            'text-[var(--app-text-2)] hover:bg-[var(--app-elevated)] hover:text-[var(--app-text-1)]',
            'transition-colors duration-[130ms] overflow-hidden whitespace-nowrap',
          )}
        >
          <div
            className="flex items-center justify-center flex-shrink-0 rounded-full text-[12px] font-semibold"
            style={{
              width: 28, height: 28, minWidth: 28,
              background: 'var(--app-accent-sub)',
              border: '1px solid var(--app-accent-border)',
              color: 'var(--app-accent-text)',
            }}
          >
            {user?.username?.charAt(0).toUpperCase() ?? 'U'}
          </div>
          <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-[140ms] delay-[40ms] flex-1 min-w-0">
            <p className="text-[13.5px] font-semibold text-[var(--app-text-1)] whitespace-nowrap leading-tight">
              {user?.username ?? 'admin'}
            </p>
            <p className="text-[12px] text-[var(--app-text-3)] whitespace-nowrap leading-tight">
              Sign out
            </p>
          </div>
          <LogOut size={14} className="opacity-0 group-hover/sidebar:opacity-100 flex-shrink-0 transition-opacity duration-[140ms] delay-[40ms]" />
        </button>
      </div>
    </aside>
  );
}
