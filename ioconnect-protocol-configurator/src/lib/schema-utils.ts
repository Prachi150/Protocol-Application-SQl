import type { FieldCondition, FormSection, ProtocolSchema } from "./schema-types";

export function getDeep(obj: Record<string, any>, path: string): any {
  return path.split(".").reduce((acc: any, key) => acc?.[key], obj);
}

export function setDeep(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const clone = JSON.parse(JSON.stringify(obj));
  const keys = path.split(".");
  let cursor: any = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor[keys[i]] == null) cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
  return clone;
}

export function evaluateCondition(cond: FieldCondition, entry: Record<string, any>): boolean {
  const actual = String(getDeep(entry, cond.field) ?? "");
  const expected = String(cond.value);
  return cond.op === "eq" ? actual === expected : actual !== expected;
}

export function buildDefaultEntry(sections: FormSection[]): Record<string, any> {
  let entry: Record<string, any> = {};
  for (const section of sections)
    for (const field of section.fields)
      entry = setDeep(entry, field.key, field.default);
  return entry;
}

export function buildDefaultPollingEntry(schema: ProtocolSchema): Record<string, any> {
  return buildDefaultEntry(schema.polling.sections);
}

export function buildDefaultPostingEntry(schema: ProtocolSchema, type: string): Record<string, any> {
  const t = schema.posting.types.find((pt) => pt.type === type);
  if (!t) throw new Error(`Unknown posting type: ${type}`);
  return { ...buildDefaultEntry(t.sections), type };
}
