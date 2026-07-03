import { CSVRow, VALID_CSV_HEADERS } from "./csv-headers";

const PREFIX = import.meta.env.VITE_STORAGE_KEY_PREFIX || "lsg-opcua";
const STORAGE_KEY = `${PREFIX}-csv-editor-rows`;
const SAVED_KEY = `${PREFIX}-csv-editor-saved`;

export function loadCSVRows(): CSVRow[] | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as CSVRow[];
    return null;
  } catch {
    return null;
  }
}

export function saveCSVRows(rows: CSVRow[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  localStorage.setItem(SAVED_KEY, "true");
}

export function markUnsaved(): void {
  localStorage.setItem(SAVED_KEY, "false");
}

export function isSaved(): boolean {
  return localStorage.getItem(SAVED_KEY) !== "false";
}
