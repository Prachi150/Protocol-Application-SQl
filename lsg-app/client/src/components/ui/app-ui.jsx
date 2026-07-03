/**
 * App-level UI primitives — thin wrappers around the mockup design system.
 * These replace the MUI Box/Paper/Typography/Chip patterns across all pages.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

/* ── Layout helpers ─────────────────────────────────────────────────────── */

export function PageContainer({ children, className }) {
  return <div className={cn('space-y-4', className)}>{children}</div>;
}

/* ── Panel (replaces Paper/Card) ────────────────────────────────────────── */

export function Panel({ children, className }) {
  return (
    <div
      className={cn('rounded-lg overflow-hidden', className)}
      style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}
    >
      {children}
    </div>
  );
}

export function PanelHeader({ icon: Icon, iconColor = 'accent', title, subtitle, right, className }) {
  const colorMap = {
    accent:  { bg: 'var(--app-accent-sub)',   color: 'var(--app-accent-text)' },
    success: { bg: 'var(--app-success-sub)',  color: 'var(--app-success)' },
    warning: { bg: 'var(--app-warning-sub)',  color: 'var(--app-warning)' },
    danger:  { bg: 'var(--app-danger-sub)',   color: 'var(--app-danger)' },
  };
  const { bg, color } = colorMap[iconColor] ?? colorMap.accent;

  return (
    <div
      className={cn('flex items-center justify-between px-[18px] py-[14px]', className)}
      style={{ borderBottom: '1px solid var(--app-border)' }}
    >
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div
            className="flex items-center justify-center rounded-[7px] flex-shrink-0"
            style={{ width: 30, height: 30, background: bg, color }}
          >
            <Icon size={15} />
          </div>
        )}
        <div>
          <h2 className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--app-text-1)' }}>{title}</h2>
          {subtitle && <p className="text-[12.5px] leading-tight mt-0.5" style={{ color: 'var(--app-text-3)' }}>{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function PanelBody({ children, className }) {
  return <div className={cn('px-[18px] py-[16px]', className)}>{children}</div>;
}

/* ── DataRow (label + value pair) ───────────────────────────────────────── */

export function DataRow({ label, children, last }) {
  return (
    <div
      className="flex items-center justify-between py-[9px]"
      style={{ borderBottom: last ? 'none' : '1px solid var(--app-border)' }}
    >
      <span className="text-[13.5px]" style={{ color: 'var(--app-text-2)' }}>{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function MonoValue({ children, color, className }) {
  return (
    <span
      className={cn('font-mono text-[13px] font-medium', className)}
      style={{ color: color ?? 'var(--app-text-1)' }}
    >
      {children}
    </span>
  );
}

/* ── StatusBadge (replaces Chip) ────────────────────────────────────────── */

export function StatusBadge({ variant = 'neutral', dot, children, className }) {
  const styles = {
    success: { background: 'var(--app-success-sub)',  color: 'var(--app-success)',      dotColor: 'var(--app-success)' },
    warning: { background: 'var(--app-warning-sub)',  color: 'var(--app-warning)',      dotColor: 'var(--app-warning)' },
    danger:  { background: 'var(--app-danger-sub)',   color: 'var(--app-danger)',       dotColor: 'var(--app-danger)' },
    accent:  { background: 'var(--app-accent-sub)',   color: 'var(--app-accent-text)',  dotColor: 'var(--app-accent)' },
    neutral: { background: 'var(--app-neutral-sub)',  color: 'var(--app-text-2)',       dotColor: 'var(--app-text-3)' },
  };
  const s = styles[variant] ?? styles.neutral;

  return (
    <span
      className={cn('inline-flex items-center gap-[5px] px-[9px] py-[3px] rounded-[5px] text-[12.5px] font-medium', className)}
      style={{ background: s.background, color: s.color }}
    >
      {dot && <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: s.dotColor }} />}
      {children}
    </span>
  );
}

/* ── StatusDot (running/stopped indicator) ──────────────────────────────── */

export function StatusDot({ active, label }) {
  return (
    <div className="flex items-center gap-1.5">
      {active
        ? <CheckCircle2 size={15} style={{ color: 'var(--app-success)' }} />
        : <XCircle      size={15} style={{ color: 'var(--app-danger)' }} />}
      <span className="text-[13.5px]" style={{ color: 'var(--app-text-1)' }}>{label}</span>
    </div>
  );
}

/* ── Spinner ────────────────────────────────────────────────────────────── */

export function Spinner({ size = 20 }) {
  return <Loader2 size={size} className="animate-spin" style={{ color: 'var(--app-accent-text)' }} />;
}

/* ── PageSpinner ────────────────────────────────────────────────────────── */

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner size={28} />
    </div>
  );
}

/* ── SectionLabel ───────────────────────────────────────────────────────── */

export function SectionLabel({ children }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.6px] mb-2.5" style={{ color: 'var(--app-text-3)' }}>
      {children}
    </p>
  );
}

/* ── Divider ────────────────────────────────────────────────────────────── */

export function AppDivider({ className }) {
  return <hr className={cn('my-1', className)} style={{ borderColor: 'var(--app-border)' }} />;
}

/* ── AppAlert ───────────────────────────────────────────────────────────── */

export function AppAlert({ severity = 'error', children, className }) {
  const styles = {
    error:   { background: 'var(--app-danger-sub)',  color: 'var(--app-danger)' },
    success: { background: 'var(--app-success-sub)', color: 'var(--app-success)' },
    warning: { background: 'var(--app-warning-sub)', color: 'var(--app-warning)' },
    info:    { background: 'var(--app-accent-sub)',  color: 'var(--app-accent-text)' },
  };
  const s = styles[severity] ?? styles.error;
  return (
    <div
      className={cn('px-4 py-3 rounded-lg text-[13.5px] font-medium', className)}
      style={{ background: s.background, color: s.color }}
    >
      {children}
    </div>
  );
}

/* ── IconBtn ────────────────────────────────────────────────────────────── */

export function IconBtn({ onClick, disabled, title, children, className, variant }) {
  const vs = {
    success: { bg: 'var(--app-success-sub)', border: 'var(--app-success)', color: 'var(--app-success)', hoverBg: 'rgba(52,211,153,0.20)' },
    danger:  { bg: 'var(--app-danger-sub)',  border: 'var(--app-danger)',  color: 'var(--app-danger)',  hoverBg: 'rgba(248,113,113,0.20)' },
    warning: { bg: 'var(--app-warning-sub)', border: 'var(--app-warning)', color: 'var(--app-warning)', hoverBg: 'rgba(251,191,36,0.20)'  },
  };
  const s = vs[variant] ?? { bg: 'var(--app-elevated)', border: 'var(--app-border)', color: 'var(--app-text-2)', hoverBg: 'var(--app-border)' };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-[130ms]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.background = s.hoverBg)}
      onMouseLeave={e => (e.currentTarget.style.background = s.bg)}
    >
      {children}
    </button>
  );
}

/* ── AppInput ───────────────────────────────────────────────────────────── */

export function AppInput({ label, error, helperText, className, ...props }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <label className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>{label}</label>
      )}
      <input
        className={cn(
          'px-3 py-2 rounded-lg text-[13.5px] outline-none transition-colors duration-[130ms]',
          'font-mono placeholder:font-sans',
          error ? 'ring-1 ring-[var(--app-danger)]' : '',
        )}
        style={{
          background: 'var(--app-elevated)',
          border: `1px solid ${error ? 'var(--app-danger)' : 'var(--app-border-mid)'}`,
          color: 'var(--app-text-1)',
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--app-accent)'; e.target.style.outline = 'none'; }}
        onBlur={e => { e.target.style.borderColor = error ? 'var(--app-danger)' : 'var(--app-border-mid)'; }}
        {...props}
      />
      {helperText && (
        <span className="text-[11.5px]" style={{ color: error ? 'var(--app-danger)' : 'var(--app-text-3)' }}>
          {helperText}
        </span>
      )}
    </div>
  );
}

/* ── AppButton ──────────────────────────────────────────────────────────── */

export function AppButton({ variant = 'default', disabled, children, className, ...props }) {
  const base = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors duration-[130ms] disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    default:     { background: 'var(--app-accent)',   border: 'var(--app-accent)',      color: '#fff' },
    outline:     { background: 'var(--app-surface)',  border: 'var(--app-border-mid)',  color: 'var(--app-text-1)' },
    ghost:       { background: 'transparent',         border: 'transparent',            color: 'var(--app-text-2)' },
    destructive: { background: 'var(--app-danger-sub)', border: 'var(--app-danger)',   color: 'var(--app-danger)' },
  };
  const s = variants[variant] ?? variants.default;

  return (
    <button
      disabled={disabled}
      className={cn(base, className)}
      style={{ background: s.background, border: `1px solid ${s.border}`, color: s.color }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = '0.85'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
      {...props}
    >
      {children}
    </button>
  );
}
