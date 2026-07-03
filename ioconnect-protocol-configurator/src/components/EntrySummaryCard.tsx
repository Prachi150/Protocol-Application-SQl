import { AppButton } from "@/components/ui/app-ui";
import { Pencil, Server, Trash2 } from "lucide-react";
import { getDeep } from "@/lib/schema-utils";
import type { ColorToken, SummaryBadgeDescriptor, SummaryDescriptor } from "@/lib/schema-types";

const COLOR_CLASSES: Record<ColorToken, string> = {
  primary: "bg-app-accent-sub text-app-accent-text",
  muted: "bg-app-neutral-sub text-app-text2",
  warning: "bg-app-warning-sub text-app-warning",
  success: "bg-app-success-sub text-app-success",
  accent: "bg-app-accent-sub text-app-accent-text",
};

const ICON_BG: Record<"primary" | "accent", string> = {
  primary: "var(--app-accent-sub)",
  accent:  "var(--app-accent-sub)",
};

function resolveColor(rules: SummaryBadgeDescriptor["colorRules"], value: string): ColorToken {
  for (const rule of rules) {
    if (rule.value === "*" || rule.value === value) return rule.color;
  }
  return "muted";
}

interface EntrySummaryCardProps {
  summary: SummaryDescriptor;
  entry: Record<string, any>;
  index: number;
  accentColor: "primary" | "accent";
  isLocked: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function EntrySummaryCard({
  summary,
  entry,
  index,
  accentColor,
  isLocked,
  onEdit,
  onDelete,
}: EntrySummaryCardProps) {
  const title = summary.titleTemplate.replace("#{index}", String(index + 1));
  const accentClass = accentColor === "primary" ? "accent" : "accent";

  const rawSubtitle = String(getDeep(entry, summary.subtitleField) ?? "");
  const subtitle = summary.subtitleSuffix
    ? `${rawSubtitle}:${getDeep(entry, summary.subtitleSuffix) ?? ""}`
    : rawSubtitle;

  return (
    <div className="flex rounded-[10px] border border-app-border overflow-hidden bg-app-surface shadow-card hover:shadow-card-hover hover:-translate-y-[1.5px] transition-all duration-200">
      <div className={`w-1 flex-shrink-0 bg-app-${accentClass}`} />
      <div className="flex-1 flex items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            className={`w-[34px] h-[34px] rounded-lg flex items-center justify-center text-app-${accentClass}-text flex-shrink-0`}
            style={{ background: ICON_BG[accentColor] }}
          >
            <Server className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-app-text1">{title}</span>
              {isLocked && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-app-${accentClass}-sub text-app-${accentClass}-text border border-app-${accentClass}-border`}>
                  Default
                </span>
              )}
            </div>
            {subtitle && (
              <div className="font-mono text-[11px] text-app-text3 mt-0.5 truncate">
                {subtitle}
              </div>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
              {summary.badges.map((badge) => {
                const raw = getDeep(entry, badge.field);
                const rawStr = String(raw ?? "");
                const display = badge.booleanLabels
                  ? raw ? badge.booleanLabels.true : badge.booleanLabels.false
                  : rawStr || "—";
                const colorClass = COLOR_CLASSES[resolveColor(badge.colorRules, rawStr)];
                return (
                  <span key={badge.label} className="text-[10.5px] text-muted-foreground">
                    {badge.label}{" "}
                    <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${colorClass}`}>
                      {display}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <AppButton
            variant="outline"
            onClick={onEdit}
            className="h-7 gap-1 text-xs px-2"
            disabled={isLocked}
          >
            <Pencil className="h-3 w-3" /> Edit
          </AppButton>
          <AppButton
            variant="outline"
            onClick={onDelete}
            className="h-7 gap-1 text-xs px-2 text-app-danger border-app-danger/25 hover:bg-app-danger/5"
            disabled={isLocked}
          >
            <Trash2 className="h-3 w-3" /> Remove
          </AppButton>
        </div>
      </div>
    </div>
  );
}
