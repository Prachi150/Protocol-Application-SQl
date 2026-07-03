export type WidgetType = "text" | "number" | "boolean" | "filepath" | "select";
export type CSVWidgetType = "text" | "checkbox" | "server-select" | "port-select" | "rack-select" | "slot-select" | "select";
export type ColorToken = "primary" | "muted" | "warning" | "success" | "accent";
export type ConditionOp = "eq" | "neq";

export interface FieldCondition {
  field: string;
  op: ConditionOp;
  value: string | number | boolean;
}

export interface WidgetOverride {
  condition: FieldCondition;
  widget: WidgetType;
}

export interface FieldDescriptor {
  key: string;
  label: string;
  widget: WidgetType;
  default: string | number | boolean;
  options?: string[];
  disableWhen: FieldCondition | null;
  /** Override the widget type when the condition matches the current entry */
  widgetWhen?: WidgetOverride | null;
}

export interface FormSection {
  key: string;
  label: string;
  fields: FieldDescriptor[];
}

export interface BadgeColorRule {
  value: string;
  color: ColorToken;
}

export interface SummaryBadgeDescriptor {
  label: string;
  field: string;
  booleanLabels?: { true: string; false: string };
  colorRules: BadgeColorRule[];
}

export interface SummaryDescriptor {
  titleTemplate: string;
  subtitleField: string;
  subtitleSuffix?: string;
  badges: SummaryBadgeDescriptor[];
}

export interface PollingSchemaSection {
  sectionLabel: string;
  entryLabel: string;
  sections: FormSection[];
  summary: SummaryDescriptor;
}

export interface PostingTypeSchema {
  type: string;
  label: string;
  pinToIndex0: boolean;
  sections: FormSection[];
  summary: SummaryDescriptor;
}

export interface PostingSchema {
  types: PostingTypeSchema[];
}

export interface CSVColumnVisibility {
  condition: string;
  hiddenDefault?: string;
}

export interface CSVColumnDescriptor {
  key: string;
  label: string;
  widget: CSVWidgetType;
  options?: string[];
  width: string | null;
  monospace: boolean;
  visibleWhen: CSVColumnVisibility | null;
  /** Column is included in the Auto Onboard MQTT payload */
  includeInOnboard?: boolean;
  /** Column is hidden in UNS mode by default (user can toggle to show) */
  unsHidden?: boolean;
  /** Column is read-only in the editor (cannot be manually edited) */
  readOnly?: boolean;
  /** Column only rendered in UNS mode (hidden in Legacy mode) */
  unsOnly?: boolean;
  /** Default cell value for new empty rows */
  default?: string;
}

export interface CSVSchema {
  columns: CSVColumnDescriptor[];
}

export interface ProtocolSchema {
  profile: string;
  label: string;
  pollingEntryServerField?: string;
  pollingEntryPortField?: string;
  pollingEntryRackField?: string;
  pollingEntrySlotField?: string;
  pollingEntryForceDatatypeField?: string;
  polling: PollingSchemaSection;
  posting: PostingSchema;
  csv: CSVSchema;
}
