import type { CSVColumnDescriptor } from "./schema-types";

// Legacy constant — kept so csv-storage.ts and any other callers don't break during migration.
export const VALID_CSV_HEADERS = [
  "device",
  "address",
  "tag",
  "datatype",
  "byteorder",
  "resolution",
  "server",
  "lograte",
  "isarray",
  "arrayindex",
  "auto_onboarded",
] as const;

export type CSVRow = Record<string, string>;

// Schema-aware header validation — readOnly columns are optional (they may be absent in older CSVs)
export function validateHeadersWithSchema(
  headers: string[],
  columns: CSVColumnDescriptor[]
): boolean {
  const requiredKeys = columns.filter((c) => !c.readOnly).map((c) => c.key);
  const normalized = headers.map((h) => h.trim().toLowerCase());
  return requiredKeys.every((k) => normalized.includes(k));
}

// Legacy header validation (kept for backward compat)
export function validateHeaders(headers: string[]): boolean {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  return (
    normalized.length === VALID_CSV_HEADERS.length &&
    VALID_CSV_HEADERS.every((h) => normalized.includes(h))
  );
}

function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let field = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ",") i++; // skip delimiter
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) {
        fields.push(line.slice(i).trim());
        break;
      }
      fields.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return fields;
}

function quoteField(value: string): string {
  if (
    value.includes('"') ||
    value.includes(",") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return '"' + value.replaceAll('"', '""') + '"';
  }
  return value;
}

export function parseCSV(text: string): { headers: string[]; rows: CSVRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const values = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row as CSVRow;
  });
  return { headers, rows };
}

// Schema-aware CSV serialisation
export function toCSVWithSchema(
  rows: CSVRow[],
  columns: CSVColumnDescriptor[],
  visibleKeys?: Set<string>
): string {
  const keys = columns.map((c) => c.key);
  const header = keys.map(quoteField).join(",");
  const body = rows
    .map((r) =>
      keys
        .map((k) => {
          const col = columns.find((c) => c.key === k)!;
          const isHidden = visibleKeys !== undefined && !visibleKeys.has(k);
          if (isHidden && col.visibleWhen?.hiddenDefault !== undefined)
            return quoteField(col.visibleWhen.hiddenDefault);
          return quoteField(r[k] ?? "");
        })
        .join(",")
    )
    .join("\n");
  return header + "\n" + body;
}

// Legacy serialisation (kept for backward compat)
export function toCSV(rows: CSVRow[]): string {
  const header = VALID_CSV_HEADERS.join(",");
  const body = rows
    .map((r) => VALID_CSV_HEADERS.map((h) => quoteField(r[h] ?? "")).join(","))
    .join("\n");
  return header + "\n" + body;
}
