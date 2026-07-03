import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

/**
 * PageContainer - Top-level wrapper for page content
 */
export const PageContainer: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("flex flex-col gap-4", className)}>
    {children}
  </div>
);

/**
 * Panel - Container for data sections
 */
export const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("bg-app-surface border border-app-border rounded-lg overflow-hidden shadow-sm", className)}>
    {children}
  </div>
);

interface PanelHeaderProps {
  icon?: React.ElementType;
  iconColor?: 'accent' | 'success' | 'warning' | 'danger';
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({ 
  icon: Icon, 
  iconColor = 'accent', 
  title, 
  subtitle, 
  right,
  className 
}) => {
  const iconColors = {
    accent: "bg-app-accent-sub text-app-accent-text",
    success: "bg-app-success-sub text-app-success",
    warning: "bg-app-warning-sub text-app-warning",
    danger: "bg-app-danger-sub text-app-danger",
  };

  return (
    <div className={cn("flex items-center justify-between px-[18px] py-[14px] border-b border-app-border", className)}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={cn("flex items-center justify-center w-[30px] h-[30px] rounded-[7px] shrink-0", iconColors[iconColor])}>
            <Icon size={15} />
          </div>
        )}
        <div className="flex flex-col">
          <h3 className="text-[14px] font-semibold text-app-text1 leading-tight">{title}</h3>
          {subtitle && <p className="text-[12.5px] text-app-text3 leading-tight mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
};

export const PanelBody: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("p-[18px] pt-[16px]", className)}>
    {children}
  </div>
);

/**
 * DataRow & MonoValue
 */
interface DataRowProps {
  label: string;
  children: React.ReactNode;
  last?: boolean;
  className?: string;
}

export const DataRow: React.FC<DataRowProps> = ({ label, children, last, className }) => (
  <div className={cn(
    "flex items-center justify-between py-[9px] border-b border-app-border",
    last && "border-b-0",
    className
  )}>
    <span className="text-[13.5px] text-app-text2">{label}</span>
    <div className="flex items-center">{children}</div>
  </div>
);

export const MonoValue: React.FC<{ children: React.ReactNode; color?: string; className?: string }> = ({ 
  children, 
  color, 
  className 
}) => (
  <span 
    className={cn("font-mono text-[13px] font-medium text-app-text1", className)}
    style={color ? { color } : undefined}
  >
    {children}
  </span>
);

/**
 * StatusBadge
 */
interface StatusBadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'accent' | 'neutral';
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ 
  variant = 'neutral', 
  dot, 
  children, 
  className 
}) => {
  const variants = {
    success: "bg-app-success-sub text-app-success border-app-success/20",
    warning: "bg-app-warning-sub text-app-warning border-app-warning/20",
    danger: "bg-app-danger-sub text-app-danger border-app-danger/20",
    accent: "bg-app-accent-sub text-app-accent-text border-app-accent-border",
    neutral: "bg-app-neutral-sub text-app-text2 border-app-border",
  };

  return (
    <div className={cn("inline-flex items-center gap-[5px] px-[9px] py-[3px] rounded-[8px] text-[12.5px] font-medium border", variants[variant], className)}>
      {dot && <span className="w-[5px] h-[5px] rounded-full shrink-0 bg-current" />}
      {children}
    </div>
  );
};

/**
 * StatusDot
 */
export const StatusDot: React.FC<{ active: boolean; label: string; className?: string }> = ({ active, label, className }) => (
  <div className={cn("flex items-center gap-[6px] text-[13.5px] text-app-text1", className)}>
    {active ? (
      <CheckCircle2 size={15} className="text-app-success" />
    ) : (
      <XCircle size={15} className="text-app-danger" />
    )}
    <span>{label}</span>
  </div>
);

/**
 * AppButton & IconBtn
 */
interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  children: React.ReactNode;
}

export const AppButton: React.FC<AppButtonProps> = ({ 
  variant = 'default', 
  children, 
  className, 
  ...props 
}) => {
  const variants = {
    default: "bg-app-accent border-app-accent text-white",
    outline: "bg-app-surface border-app-border-mid text-app-text1",
    ghost: "bg-transparent border-transparent text-app-text2",
    destructive: "bg-app-danger-sub border-app-danger text-app-danger",
  };

  return (
    <button 
      className={cn(
        "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-sans text-[13px] font-medium cursor-pointer border transition-opacity duration-130 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-85",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

interface IconBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'success' | 'danger' | 'warning';
  title: string;
  children: React.ReactNode;
}

export const IconBtn: React.FC<IconBtnProps> = ({ 
  variant, 
  title, 
  children, 
  className, 
  ...props 
}) => {
  const variants = {
    success: "bg-app-success-sub border-app-success text-app-success hover:bg-[rgba(52,211,153,0.20)]",
    danger: "bg-app-danger-sub border-app-danger text-app-danger hover:bg-[rgba(248,113,113,0.20)]",
    warning: "bg-app-warning-sub border-app-warning text-app-warning hover:bg-[rgba(251,191,36,0.20)]",
  };

  return (
    <button 
      title={title}
      className={cn(
        "flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer transition-colors duration-130 disabled:opacity-50 disabled:cursor-not-allowed",
        variant ? cn("border", variants[variant]) : "bg-app-elevated border border-app-border text-app-text2 hover:bg-app-border/10",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

/**
 * AppInput
 */
interface AppInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: boolean;
  helperText?: string;
}

export const AppInput: React.FC<AppInputProps> = ({ 
  label, 
  error, 
  helperText, 
  className, 
  ...props 
}) => (
  <div className="flex flex-col gap-1">
    {label && <label className="text-[13px] font-medium text-app-text1">{label}</label>}
    <input 
      className={cn(
        "px-3 py-2 rounded-lg font-mono text-[13.5px] bg-app-elevated border border-app-border-mid text-app-text1 outline-none transition-colors duration-130 placeholder:font-sans placeholder:text-app-text3 focus:border-app-accent",
        error && "border-app-danger focus:border-app-danger ring-1 ring-app-danger",
        className
      )}
      {...props}
    />
    {helperText && (
      <span className={cn("text-[11.5px] text-app-text3", error && "text-app-danger")}>
        {helperText}
      </span>
    )}
  </div>
);

/**
 * AppAlert
 */
export const AppAlert: React.FC<{ 
  severity?: 'error' | 'success' | 'warning' | 'info'; 
  children: React.ReactNode;
  className?: string;
}> = ({ severity = 'info', children, className }) => {
  const severities = {
    error: "bg-app-danger-sub text-app-danger",
    success: "bg-app-success-sub text-app-success",
    warning: "bg-app-warning-sub text-app-warning",
    info: "bg-app-accent-sub text-app-accent-text",
  };

  return (
    <div className={cn("px-4 py-3 rounded-lg text-[13.5px] font-medium", severities[severity], className)}>
      {children}
    </div>
  );
};

/**
 * SectionLabel & AppDivider
 */
export const SectionLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("text-[11px] font-normal uppercase tracking-[0.6px] text-app-text3 mb-2.5", className)}>
    {children}
  </div>
);

export const AppDivider: React.FC<{ className?: string }> = ({ className }) => (
  <hr className={cn("border-none border-t border-app-border my-1", className)} />
);

/**
 * Spinner
 */
export const Spinner: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <Loader2 size={size} className={cn("animate-spin text-app-accent-text", className)} />
);

export const PageSpinner: React.FC = () => (
  <div className="flex items-center justify-center h-64">
    <Spinner size={28} />
  </div>
);
