import { useRef } from "react";
import { AppInput, AppButton } from "@/components/ui/app-ui";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderOpen } from "lucide-react";
import { evaluateCondition, getDeep } from "@/lib/schema-utils";
import type { FormSection, FieldDescriptor } from "@/lib/schema-types";

interface SchemaFormSectionsProps {
  sections: FormSection[];
  entry: Record<string, any>;
  updateField: (path: string, value: string | number | boolean) => void;
}

export function SchemaFormSections({ sections, entry, updateField }: SchemaFormSectionsProps) {
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <div key={section.key}>
          <div className="text-xs font-semibold text-app-text1 uppercase tracking-wider pb-1 border-b border-app-border border-l-2 border-l-app-accent pl-2 mb-3">
            {section.label}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {section.fields.map((field) => (
              <FieldWidget
                key={field.key}
                field={field}
                entry={entry}
                updateField={updateField}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldWidget({
  field,
  entry,
  updateField,
}: {
  field: FieldDescriptor;
  entry: Record<string, any>;
  updateField: (path: string, value: string | number | boolean) => void;
}) {
  const value = getDeep(entry, field.key) ?? field.default;
  const disabled = field.disableWhen ? evaluateCondition(field.disableWhen, entry) : false;
  const widget =
    field.widgetWhen && evaluateCondition(field.widgetWhen.condition, entry)
      ? field.widgetWhen.widget
      : field.widget;

  if (widget === "boolean") {
    return (
      <div className="flex items-center justify-between gap-2 py-1">
        <Label className="text-xs font-medium text-app-text3">{field.label}</Label>
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(v) => updateField(field.key, v)}
          disabled={disabled}
        />
      </div>
    );
  }

  if (widget === "select") {
    return (
      <div className="space-y-1">
        <Label className="text-xs font-medium text-app-text3">{field.label}</Label>
        <Select
          value={String(value)}
          onValueChange={(v) => updateField(field.key, v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-sm focus:border-app-accent bg-app-elevated border-app-border-mid text-app-text1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (widget === "filepath") {
    return <FilePathWidget label={field.label} value={String(value)} onChange={(v) => updateField(field.key, v)} disabled={disabled} />;
  }

  // text / number
  return (
    <AppInput
      label={field.label}
      value={String(value)}
      onChange={(e) =>
        updateField(
          field.key,
          widget === "number" ? Number(e.target.value) || 0 : e.target.value
        )
      }
      type={widget === "number" ? "number" : "text"}
      className="h-8 text-sm"
      disabled={disabled}
    />
  );
}

function FilePathWidget({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-app-text3">{label}</Label>
      <div className="flex gap-1">
        <AppInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm flex-1"
          disabled={disabled}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".pem,.der,.crt,.cer,.key"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onChange(file.name);
            e.target.value = "";
          }}
        />
        <AppButton
          type="button"
          variant="outline"
          className="h-8 px-2"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </AppButton>
      </div>
    </div>
  );
}
