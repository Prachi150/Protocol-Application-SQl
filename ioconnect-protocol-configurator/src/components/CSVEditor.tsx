import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { AppButton } from "@/components/ui/app-ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Download, Copy, AlertCircle, Server, Cpu, Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { CSVRow, validateHeadersWithSchema, parseCSV, toCSVWithSchema } from "@/lib/csv-headers";
import { loadCSVRows, saveCSVRows, markUnsaved, isSaved } from "@/lib/csv-storage";
import { useDragFill } from "@/hooks/use-drag-fill";
import { filesApi, onboardApi } from "@/lib/api";
import type { UnsNode } from "@/lib/api";
import { getDeep } from "@/lib/schema-utils";
import type { CSVSchema, CSVColumnDescriptor } from "@/lib/schema-types";

interface CSVEditorProps {
  schema: CSVSchema;
  pollingEntries: Record<string, any>[];
  pollingEntryServerField?: string;
  pollingEntryPortField?: string;
  pollingEntryRackField?: string;
  pollingEntrySlotField?: string;
  pollingEntryForceDatatypeField?: string;
}

interface CellSelection {
  startRow: number;
  endRow: number;
  startCol: string;
  endCol: string;
}

export default function CSVEditor({
  schema,
  pollingEntries,
  pollingEntryServerField = "protocol.server",
  pollingEntryPortField,
  pollingEntryRackField,
  pollingEntrySlotField,
  pollingEntryForceDatatypeField = "protocol.force_datatype",
}: CSVEditorProps) {
  const allColumns = schema.columns;
  const serverColKey = allColumns.find((c) => c.widget === "server-select")?.key ?? "server";
  const portColKey = allColumns.find((c) => c.widget === "port-select")?.key ?? "port";
  const rackColKey = allColumns.find((c) => c.widget === "rack-select")?.key ?? "rack";
  const slotColKey = allColumns.find((c) => c.widget === "slot-select")?.key ?? "slot";

  const emptyRow = useCallback(
    (): CSVRow =>
      Object.fromEntries(
        allColumns.map((c) => [
          c.key,
          c.widget === "checkbox" ? "no" : (c.default !== undefined ? c.default : ""),
        ])
      ),
    [allColumns]
  );

  // Fills in any schema columns missing from a parsed row (e.g. auto_onboarded in old CSVs)
  const normalizeRow = useCallback(
    (row: CSVRow): CSVRow => {
      const filled = { ...row };
      for (const col of allColumns) {
        if (!(col.key in filled)) {
          filled[col.key] = col.widget === "checkbox" ? "no" : (col.default ?? "");
        }
      }
      return filled;
    },
    [allColumns]
  );

  const [rows, setRows] = useState<CSVRow[]>(() =>
    !isSaved() ? (loadCSVRows() ?? [emptyRow()]) : [emptyRow()]
  );
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState(() => isSaved());
  const [cellSelection, setCellSelection] = useState<CellSelection | null>(null);
  const [isSelectingCells, setIsSelectingCells] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvFileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const cellSelectionRef = useRef<CellSelection | null>(null);
  const visibleColumnsRef = useRef<CSVColumnDescriptor[]>([]);
  const rowsRef = useRef(rows);
  const editingCellRef = useRef(editingCell);
  const clipboardRef = useRef<{ data: string[][], cols: string[] } | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(() => isSaved());

  // ---- UNS / Auto Onboard state ----
  const [unsMode, setUnsMode] = useState(() => localStorage.getItem("csvEditorMode") === "uns");

  useEffect(() => {
    localStorage.setItem("csvEditorMode", unsMode ? "uns" : "legacy");
  }, [unsMode]);

  const [showUnsHiddenCols, setShowUnsHiddenCols] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [onboardProgress, setOnboardProgress] = useState("");
  const [inflightRows, setInflightRows] = useState<Set<number>>(new Set());
  const [failedRows, setFailedRows] = useState<Set<number>>(new Set());
  const [onboardError, setOnboardError] = useState<string | null>(null);

  cellSelectionRef.current = cellSelection;
  rowsRef.current = rows;
  editingCellRef.current = editingCell;

  useEffect(() => {
    saveCSVRows(rows);
  }, [rows]);

  useEffect(() => {
    if (initialized) return;
    if (!isSaved()) { setInitialized(true); return; }
    const loadDefault = async () => {
      try {
        const { content } = await filesApi.readDefault("csv");
        const { headers, rows: parsed } = parseCSV(content);
        if (validateHeadersWithSchema(headers, allColumns)) {
          const normalized = parsed.map(normalizeRow);
          setRows(normalized.length ? normalized : [emptyRow()]);
          setSelectedRows(new Set());
          saveCSVRows(normalized.length ? normalized : [emptyRow()]);
          setSaved(true);
          toast.success(`Loaded ${parsed.length} rows from server`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("not found")) console.error("Failed to read CSV from server");
      } finally {
        setInitialized(true);
        setLoading(false);
      }
    };
    loadDefault();
  }, [initialized, allColumns, emptyRow, normalizeRow]);

  const markDirty = useCallback(() => { markUnsaved(); setSaved(false); }, []);

  // ---- Cell selection ----

  const startCellSelection = useCallback((rowIdx: number, col: string) => {
    const s: CellSelection = { startRow: rowIdx, endRow: rowIdx, startCol: col, endCol: col };
    setCellSelection(s);
    cellSelectionRef.current = s;
    setIsSelectingCells(true);
    setEditingCell(null);
  }, []);

  const updateCellSelection = useCallback((rowIdx: number, col: string) => {
    const cur = cellSelectionRef.current;
    if (!cur) return;
    const s: CellSelection = { ...cur, endRow: rowIdx, endCol: col };
    setCellSelection(s);
    cellSelectionRef.current = s;
  }, []);

  const handleCellMouseDown = useCallback(
    (event: React.MouseEvent, rowIdx: number, col: string) => {
      if (event.button !== 0) return;
      startCellSelection(rowIdx, col);
    },
    [startCellSelection]
  );

  useEffect(() => {
    if (!isSelectingCells) return;
    const handleMouseMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const cell = target?.closest("td[data-cell-col][data-row-index]") as HTMLElement | null;
      if (!cell) return;
      const rowIdx = Number(cell.getAttribute("data-row-index"));
      const col = cell.getAttribute("data-cell-col");
      if (Number.isNaN(rowIdx) || !col) return;
      updateCellSelection(rowIdx, col);
    };
    const handleMouseUp = () => setIsSelectingCells(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
  }, [isSelectingCells, updateCellSelection]);

  // ---- Server options & force_datatype ----

  const serverOptions = useMemo(
    () => Array.from(new Set(
      pollingEntries.map((p) => String(getDeep(p, pollingEntryServerField) ?? "")).filter(Boolean)
    )),
    [pollingEntries, pollingEntryServerField]
  );

  const serverToPortsMap = useMemo(() => {
    if (!pollingEntryPortField) return {} as Record<string, string[]>;
    const map: Record<string, string[]> = {};
    pollingEntries.forEach((p) => {
      const srv = String(getDeep(p, pollingEntryServerField) ?? "");
      const port = String(getDeep(p, pollingEntryPortField) ?? "");
      if (srv && port) {
        if (!map[srv]) map[srv] = [];
        if (!map[srv].includes(port)) map[srv].push(port);
      }
    });
    return map;
  }, [pollingEntries, pollingEntryServerField, pollingEntryPortField]);

  const allPortOptions = useMemo(
    () => Array.from(new Set(Object.values(serverToPortsMap).flat())),
    [serverToPortsMap]
  );

  // Rack options keyed by "server::port" so only racks valid for the selected IP+port are shown.
  const serverPortToRacksMap = useMemo(() => {
    if (!pollingEntryRackField) return {} as Record<string, string[]>;
    const map: Record<string, string[]> = {};
    pollingEntries.forEach((p) => {
      const srv  = String(getDeep(p, pollingEntryServerField) ?? "");
      const port = pollingEntryPortField ? String(getDeep(p, pollingEntryPortField) ?? "") : "";
      const rack = String(getDeep(p, pollingEntryRackField) ?? "");
      if (srv && rack !== "") {
        const k = `${srv}::${port}`;
        if (!map[k]) map[k] = [];
        if (!map[k].includes(rack)) map[k].push(rack);
      }
    });
    return map;
  }, [pollingEntries, pollingEntryServerField, pollingEntryPortField, pollingEntryRackField]);

  const allRackOptions = useMemo(
    () => Array.from(new Set(Object.values(serverPortToRacksMap).flat())),
    [serverPortToRacksMap]
  );

  // Slot options keyed by "server::port::rack" so only slots valid for the selected IP+port+rack are shown.
  const serverPortRackToSlotsMap = useMemo(() => {
    if (!pollingEntrySlotField) return {} as Record<string, string[]>;
    const map: Record<string, string[]> = {};
    pollingEntries.forEach((p) => {
      const srv  = String(getDeep(p, pollingEntryServerField) ?? "");
      const port = pollingEntryPortField ? String(getDeep(p, pollingEntryPortField) ?? "") : "";
      const rack = pollingEntryRackField ? String(getDeep(p, pollingEntryRackField) ?? "") : "";
      const slot = String(getDeep(p, pollingEntrySlotField) ?? "");
      if (srv && slot !== "") {
        const k = `${srv}::${port}::${rack}`;
        if (!map[k]) map[k] = [];
        if (!map[k].includes(slot)) map[k].push(slot);
      }
    });
    return map;
  }, [pollingEntries, pollingEntryServerField, pollingEntryPortField, pollingEntryRackField, pollingEntrySlotField]);

  const allSlotOptions = useMemo(
    () => Array.from(new Set(Object.values(serverPortRackToSlotsMap).flat())),
    [serverPortRackToSlotsMap]
  );

  const serverForceDatatype = useMemo(() => {
    const map: Record<string, boolean> = {};
    pollingEntries.forEach((p) => {
      const srv = String(getDeep(p, pollingEntryServerField) ?? "");
      if (srv) map[srv] = Boolean(getDeep(p, pollingEntryForceDatatypeField));
    });
    return map;
  }, [pollingEntries, pollingEntryServerField, pollingEntryForceDatatypeField]);

  const anyRowNeedsDatatype = useMemo(
    () => rows.some((r) => r[serverColKey] && (serverForceDatatype[r[serverColKey]] ?? false)),
    [rows, serverColKey, serverForceDatatype]
  );

  const visibleColumns = useMemo(
    () =>
      allColumns.filter((col) => {
        if (col.unsOnly && !unsMode) return false;
        if (col.unsHidden && unsMode && !showUnsHiddenCols) return false;
        if (!col.visibleWhen) return true;
        if (col.visibleWhen.condition === "anyServerForcesDatatype") return anyRowNeedsDatatype;
        return true;
      }),
    [allColumns, anyRowNeedsDatatype, unsMode, showUnsHiddenCols]
  );
  visibleColumnsRef.current = visibleColumns;

  const shouldShowDatatypeForRow = useCallback(
    (row: CSVRow) => {
      if (!anyRowNeedsDatatype) return false;
      const srv = row[serverColKey];
      return srv ? (serverForceDatatype[srv] ?? false) : false;
    },
    [anyRowNeedsDatatype, serverColKey, serverForceDatatype]
  );

  // ---- File I/O ----

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const { headers, rows: parsed } = parseCSV(ev.target?.result as string);
        if (!validateHeadersWithSchema(headers, allColumns)) {
          toast.error("Invalid CSV: headers don't match schema");
          return;
        }
        const normalized = parsed.map(normalizeRow);
        setRows(normalized.length ? normalized : [emptyRow()]);
        setSelectedRows(new Set());
        markDirty();
        toast.success(`Loaded ${parsed.length} rows`);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [allColumns, emptyRow, markDirty, normalizeRow]
  );

  // Plain hidden <input type=file> (handleFile parses/validates). Reliable in
  // every context, including the embedded cross-origin iframe.
  const openFileWithHandle = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const getCSVContent = useCallback(
    () => toCSVWithSchema(rows, allColumns, new Set(visibleColumns.map((c) => c.key))),
    [rows, allColumns, visibleColumns]
  );

  // Plain browser download — reliable in every context (incl. embedded iframe).
  const saveFile = useCallback(() => {
    const csv = getCSVContent();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "config.csv"; a.click();
    saveCSVRows(rows); setSaved(true);
    toast.success("CSV exported");
  }, [getCSVContent, rows]);

  const saveToServer = useCallback(async () => {
    try {
      const result = await filesApi.writeDefault("csv", getCSVContent());
      saveCSVRows(rows); setSaved(true);
      toast.success(result.message);
    } catch (err: any) {
      toast.error(err.message || "Failed to save to server");
    }
  }, [getCSVContent, rows]);

  // ---- Auto Onboard ----

  const runOnboarding = useCallback(async (unsNode: UnsNode) => {
    const currentRows = [...rowsRef.current];
    const pending = currentRows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => row.auto_onboarded !== "true");

    const BATCH_SIZE = 100;
    const batches: Array<typeof pending> = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      batches.push(pending.slice(i, i + BATCH_SIZE));
    }

    let successCount = 0;
    let anySuccess = false;

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      setOnboardProgress(`Onboarding batch ${bi + 1} / ${batches.length}…`);
      setInflightRows(new Set(batch.map((b) => b.idx)));

      try {
        const result = await onboardApi.batch(batch.map((b) => b.row), unsNode.uns_id);
        for (const assignment of result.assignments) {
          const match = batch.find(({ row }) =>
            Object.entries(assignment)
              .filter(([k]) => k !== "device_id" && k !== "sensor_id")
              .every(([k, v]) => row[k] === v)
          );
          if (match) {
            currentRows[match.idx] = {
              ...currentRows[match.idx],
              device: assignment.device_id,
              tag: assignment.sensor_id,
              auto_onboarded: "true",
            };
            successCount++;
          }
        }
        anySuccess = true;
        setInflightRows(new Set());
        setRows([...currentRows]);
      } catch {
        setInflightRows(new Set());
        setFailedRows((prev) => new Set([...prev, ...batch.map((b) => b.idx)]));
        toast.warning(`Batch ${bi + 1} timed out — ${batch.length} row${batch.length !== 1 ? "s" : ""} not onboarded`);
        break;
      }
    }

    setOnboarding(false);
    setOnboardProgress("");

    if (anySuccess) {
      try {
        const csv = toCSVWithSchema(currentRows, allColumns);
        await filesApi.writeDefault("csv", csv);
        saveCSVRows(currentRows);
        setSaved(true);
        toast.success(`${successCount} row${successCount !== 1 ? "s" : ""} onboarded and saved`);
      } catch {
        toast.error("Onboarded but auto-save failed — please save manually");
      }
    }
  }, [allColumns]);

  const handleAutoOnboard = useCallback(async () => {
    setOnboardError(null);
    setFailedRows(new Set());
    setOnboarding(true);
    setOnboardProgress("Fetching configuration…");

    let preflightResult: { success: boolean; asset_id: string; uns_nodes: UnsNode[] };
    try {
      preflightResult = await onboardApi.preflight();
    } catch (err) {
      setOnboardError(err instanceof Error ? err.message : "Failed to connect to orchestrator");
      setOnboarding(false);
      return;
    }

    const { uns_nodes } = preflightResult;

    if (!uns_nodes || uns_nodes.length === 0) {
      setOnboardError("No UNS namespace received from broker — check device registration");
      setOnboarding(false);
      return;
    }

    const selectedUns = uns_nodes[0];
    if (!selectedUns.uns_id) {
      setOnboardError("Invalid UNS response: missing uns_id — check broker configuration");
      setOnboarding(false);
      return;
    }

    await runOnboarding(selectedUns);
  }, [runOnboarding]);

  // ---- Row operations ----

  const updateCell = useCallback(
    (rowIdx: number, col: string, value: string) => {
      setRows((prev) =>
        prev.map((r, i) => {
          if (i !== rowIdx) return r;
          const updated = { ...r, [col]: value };

          if (col === serverColKey) {
            // Auto-fill port (or clear)
            let newPort = "";
            if (pollingEntryPortField) {
              const validPorts = serverToPortsMap[value] ?? [];
              newPort = validPorts.length === 1 ? validPorts[0] : "";
              updated[portColKey] = newPort;
            }
            // Auto-fill rack based on server + new port (or clear)
            let newRack = "";
            if (pollingEntryRackField) {
              const validRacks = serverPortToRacksMap[`${value}::${newPort}`] ?? [];
              newRack = validRacks.length === 1 ? validRacks[0] : "";
              updated[rackColKey] = newRack;
            }
            // Auto-fill slot based on server + new port + new rack (or clear)
            if (pollingEntrySlotField) {
              const validSlots = serverPortRackToSlotsMap[`${value}::${newPort}::${newRack}`] ?? [];
              updated[slotColKey] = validSlots.length === 1 ? validSlots[0] : "";
            }
          }

          if (col === portColKey) {
            const srv = updated[serverColKey] ?? "";
            // Auto-fill rack based on server + new port (or clear)
            let newRack = "";
            if (pollingEntryRackField) {
              const validRacks = serverPortToRacksMap[`${srv}::${value}`] ?? [];
              newRack = validRacks.length === 1 ? validRacks[0] : "";
              updated[rackColKey] = newRack;
            }
            // Auto-fill slot based on server + new port + new rack (or clear)
            if (pollingEntrySlotField) {
              const validSlots = serverPortRackToSlotsMap[`${srv}::${value}::${newRack}`] ?? [];
              updated[slotColKey] = validSlots.length === 1 ? validSlots[0] : "";
            }
          }

          if (col === rackColKey) {
            // Auto-fill slot based on server + port + new rack (or clear)
            if (pollingEntrySlotField) {
              const srv  = updated[serverColKey] ?? "";
              const port = updated[portColKey] ?? "";
              const validSlots = serverPortRackToSlotsMap[`${srv}::${port}::${value}`] ?? [];
              updated[slotColKey] = validSlots.length === 1 ? validSlots[0] : "";
            }
          }

          return updated;
        })
      );
      markDirty();
    },
    [markDirty, serverColKey, portColKey, rackColKey, slotColKey,
     pollingEntryPortField, pollingEntryRackField, pollingEntrySlotField,
     serverToPortsMap, serverPortToRacksMap, serverPortRackToSlotsMap]
  );

  const addRow = useCallback(() => { setRows((p) => [...p, emptyRow()]); markDirty(); }, [emptyRow, markDirty]);

  const insertRowBelow = useCallback(() => {
    const sel = cellSelectionRef.current;
    let insertAfter: number;
    if (sel !== null) {
      insertAfter = Math.max(sel.startRow, sel.endRow);
    } else if (selectedRows.size > 0) {
      insertAfter = Math.max(...selectedRows);
    } else {
      setRows((p) => [...p, emptyRow()]);
      markDirty();
      return;
    }
    setRows((p) => {
      const next = [...p];
      next.splice(insertAfter + 1, 0, emptyRow());
      return next;
    });
    markDirty();
  }, [emptyRow, markDirty, selectedRows]);
  const deleteSelected = useCallback(() => {
    if (!selectedRows.size) return;
    setRows((p) => p.filter((_, i) => !selectedRows.has(i)));
    setSelectedRows(new Set()); markDirty();
  }, [selectedRows, markDirty]);
  const duplicateSelected = useCallback(() => {
    if (!selectedRows.size) return;
    const dupes = rows.filter((_, i) => selectedRows.has(i)).map((r) => ({ ...r }));
    setRows((p) => [...p, ...dupes]); setSelectedRows(new Set()); markDirty();
  }, [selectedRows, rows, markDirty]);
  const toggleSelect = useCallback((idx: number) => {
    setSelectedRows((p) => { const n = new Set(p); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  }, []);
  const selectAll = useCallback(() => {
    setSelectedRows((p) => p.size === rows.length ? new Set() : new Set(rows.map((_, i) => i)));
  }, [rows.length]);

  // ---- Cell selection helpers ----

  const isCellSelected = useCallback(
    (rowIdx: number, col: string) => {
      if (!cellSelection) return false;
      const minRow = Math.min(cellSelection.startRow, cellSelection.endRow);
      const maxRow = Math.max(cellSelection.startRow, cellSelection.endRow);
      if (rowIdx < minRow || rowIdx > maxRow) return false;
      const startColIdx = visibleColumns.findIndex(c => c.key === cellSelection.startCol);
      const endColIdx   = visibleColumns.findIndex(c => c.key === cellSelection.endCol);
      const minColIdx   = Math.min(startColIdx, endColIdx);
      const maxColIdx   = Math.max(startColIdx, endColIdx);
      const colIdx      = visibleColumns.findIndex(c => c.key === col);
      return colIdx >= minColIdx && colIdx <= maxColIdx;
    },
    [cellSelection, visibleColumns]
  );

  const getCellSelectionBorders = useCallback(
    (rowIdx: number, col: string): { top: boolean; bottom: boolean; left: boolean; right: boolean } | null => {
      if (!isCellSelected(rowIdx, col)) return null;
      const minRow = Math.min(cellSelection!.startRow, cellSelection!.endRow);
      const maxRow = Math.max(cellSelection!.startRow, cellSelection!.endRow);
      const startColIdx = visibleColumns.findIndex(c => c.key === cellSelection!.startCol);
      const endColIdx   = visibleColumns.findIndex(c => c.key === cellSelection!.endCol);
      const minColIdx   = Math.min(startColIdx, endColIdx);
      const maxColIdx   = Math.max(startColIdx, endColIdx);
      const colIdx      = visibleColumns.findIndex(c => c.key === col);
      return {
        top:    rowIdx === minRow,
        bottom: rowIdx === maxRow,
        left:   colIdx === minColIdx,
        right:  colIdx === maxColIdx,
      };
    },
    [isCellSelected, cellSelection, visibleColumns]
  );

  const isSelectionTailCell = useCallback(
    (rowIdx: number, col: string) => {
      if (!cellSelection) return false;
      const maxRow = Math.max(cellSelection.startRow, cellSelection.endRow);
      if (rowIdx !== maxRow) return false;
      const startColIdx = visibleColumns.findIndex(c => c.key === cellSelection.startCol);
      const endColIdx   = visibleColumns.findIndex(c => c.key === cellSelection.endCol);
      const rightmostCol = visibleColumns[Math.max(startColIdx, endColIdx)]?.key;
      return col === rightmostCol;
    },
    [cellSelection, visibleColumns]
  );

  // ---- Drag-fill ----

  const handleFill = useCallback(
    (col: string, fromRow: number, toRow: number, values: string[]) => {
      setRows((prev) => {
        const next = [...prev];
        for (let i = fromRow; i <= toRow; i++) next[i] = { ...next[i], [col]: values[i - fromRow] };
        return next;
      });
      markDirty();
    },
    [markDirty]
  );

  const { startDrag, onMouseEnterRow, isHighlighted, isDragging, getHighlightBorders } = useDragFill({ rows, onFill: handleFill });

  const startDragFromTail = useCallback((fallbackRow: number, fallbackCol: string, fallbackValue: string) => {
    const sel = cellSelectionRef.current;
    if (!sel) {
      startDrag(fallbackRow, [fallbackCol], { [fallbackCol]: [fallbackValue] });
      return;
    }
    const cols = visibleColumnsRef.current;
    const startColIdx = cols.findIndex(c => c.key === sel.startCol);
    const endColIdx   = cols.findIndex(c => c.key === sel.endCol);
    const minColIdx   = Math.min(startColIdx, endColIdx);
    const maxColIdx   = Math.max(startColIdx, endColIdx);
    const selectedCols = cols.slice(minColIdx, maxColIdx + 1).map(c => c.key);
    const minRow = Math.min(sel.startRow, sel.endRow);
    const maxRow = Math.max(sel.startRow, sel.endRow);
    const valuesByCol: Record<string, string[]> = {};
    for (const colKey of selectedCols) {
      valuesByCol[colKey] = rowsRef.current.slice(minRow, maxRow + 1).map(r => r[colKey] ?? "");
    }
    startDrag(maxRow, selectedCols, valuesByCol);
  }, [startDrag]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingCellRef.current) return;
      const sel = cellSelectionRef.current;
      if (!sel) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (e.ctrlKey || e.metaKey || e.altKey) return; // let browser shortcuts through
        e.preventDefault();
        const cols    = visibleColumnsRef.current;
        const startCI = cols.findIndex(c => c.key === sel.startCol);
        const endCI   = cols.findIndex(c => c.key === sel.endCol);
        const minCI   = Math.min(startCI, endCI);
        const maxCI   = Math.max(startCI, endCI);
        const selCols = cols.slice(minCI, maxCI + 1).map(c => c.key);
        const minRow  = Math.min(sel.startRow, sel.endRow);
        const maxRow  = Math.max(sel.startRow, sel.endRow);
        setRows(prev => {
          const next = [...prev];
          for (let r = minRow; r <= maxRow; r++) {
            const updated = { ...next[r] };
            for (const col of selCols) updated[col] = "";
            next[r] = updated;
          }
          return next;
        });
        markDirty();
        return;
      }

      if (!e.ctrlKey && !e.metaKey) return;

      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        const cols    = visibleColumnsRef.current;
        const startCI = cols.findIndex(c => c.key === sel.startCol);
        const endCI   = cols.findIndex(c => c.key === sel.endCol);
        const minCI   = Math.min(startCI, endCI);
        const maxCI   = Math.max(startCI, endCI);
        const selCols = cols.slice(minCI, maxCI + 1).map(c => c.key);
        const minRow  = Math.min(sel.startRow, sel.endRow);
        const maxRow  = Math.max(sel.startRow, sel.endRow);
        const data    = rowsRef.current.slice(minRow, maxRow + 1)
                          .map(row => selCols.map(col => row[col] ?? ""));
        clipboardRef.current = { data, cols: selCols };
        navigator.clipboard.writeText(data.map(r => r.join("\t")).join("\n")).catch(() => {});

      } else if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        if (!clipboardRef.current) return;
        const cols    = visibleColumnsRef.current;
        const minRow  = Math.min(sel.startRow, sel.endRow);
        const startCI = Math.min(
          cols.findIndex(c => c.key === sel.startCol),
          cols.findIndex(c => c.key === sel.endCol)
        );
        const { data } = clipboardRef.current;
        setRows(prev => {
          const next = [...prev];
          data.forEach((rowVals, ri) => {
            const tRow = minRow + ri;
            if (tRow >= next.length) return;
            rowVals.forEach((val, ci) => {
              const tCol = cols[startCI + ci]?.key;
              if (!tCol) return;
              next[tRow] = { ...next[tRow], [tCol]: val };
            });
          });
          return next;
        });
        markDirty();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // stable: setRows + markDirty are stable; data accessed via refs

  // ---- Render ----

  return (
    <div className="flex flex-col h-full">
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />

      {!saved && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-app-warning-sub border-b border-app-warning/20 text-app-warning text-xs font-medium">
          <AlertCircle className="h-3.5 w-3.5" />
          Unsaved changes — save before changing tabs or restarting the service.
        </div>
      )}

      {onboardError && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-red-500/10 border-b border-red-500/20 text-red-500 text-xs font-medium">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{onboardError}</span>
          <button onClick={() => setOnboardError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="flex items-center gap-2 p-3 border-b border-app-border bg-app-elevated flex-wrap">
        <AppButton size="sm" onClick={openFileWithHandle} variant="outline" className="gap-1.5">
          <Upload className="h-3.5 w-3.5" /> Import CSV
        </AppButton>
        <AppButton size="sm" onClick={saveFile} variant="outline" className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </AppButton>

        <div className="w-px h-6 bg-app-border mx-1" />

        {/* UNS / Legacy mode toggle */}
        <div className="flex items-center gap-1 text-xs text-app-text2">
          <label className={cn("flex items-center gap-1 cursor-pointer px-2 py-1 rounded", !unsMode && "text-app-text1 font-medium")}>
            <input type="radio" name="csvMode" checked={!unsMode} onChange={() => { setUnsMode(false); setShowUnsHiddenCols(false); }} className="accent-app-accent" />
            Legacy
          </label>
          <label className={cn("flex items-center gap-1 cursor-pointer px-2 py-1 rounded", unsMode && "text-app-text1 font-medium")}>
            <input type="radio" name="csvMode" checked={unsMode} onChange={() => setUnsMode(true)} className="accent-app-accent" />
            UNS
          </label>
        </div>

        {unsMode && (
          <AppButton
            size="sm"
            variant="outline"
            onClick={() => setShowUnsHiddenCols((v) => !v)}
            className="gap-1.5"
            title={showUnsHiddenCols ? "Hide Device/Sensor ID columns" : "Show Device/Sensor ID columns"}
          >
            {showUnsHiddenCols ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </AppButton>
        )}

        <div className="w-px h-6 bg-app-border mx-1" />

        {/* Auto Onboard button */}
        <div className="flex items-center gap-2">
          <AppButton
            size="sm"
            onClick={handleAutoOnboard}
            disabled={!saved || rows.every((r) => r.auto_onboarded === "true") || onboarding}
            className="gap-1.5"
            title={
              !saved ? "Save CSV first"
              : rows.every((r) => r.auto_onboarded === "true") ? "All rows already onboarded"
              : undefined
            }
          >
            {onboarding
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Onboarding…</>
              : <><Cpu className="h-3.5 w-3.5" /> Auto Onboard</>
            }
          </AppButton>
          {onboardProgress && (
            <span className="text-xs text-app-text3">{onboardProgress}</span>
          )}
        </div>

        <AppButton
          onClick={saveToServer}
          className="ml-auto h-8 px-4"
        >
          <Server className="h-3.5 w-3.5" /> Save to Device
        </AppButton>
        <div className="w-px h-6 bg-app-border mx-1" />
        <AppButton size="sm" variant="outline" onClick={addRow} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Row
        </AppButton>
        <AppButton size="sm" variant="outline" onClick={insertRowBelow} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Insert Row
        </AppButton>
        <AppButton size="sm" variant="outline" onClick={duplicateSelected} disabled={selectedRows.size === 0} className="gap-1.5">
          <Copy className="h-3.5 w-3.5" /> Duplicate
        </AppButton>
        <AppButton size="sm" variant="outline" onClick={deleteSelected} disabled={selectedRows.size === 0} className="gap-1.5 text-app-danger border-app-danger/25 hover:bg-app-danger/5">
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </AppButton>
      </div>

      <div className={`flex-1 overflow-auto ${isDragging || isSelectingCells ? "select-none" : ""}`}>
        <table className="w-full text-sm border-collapse table-fixed">
          <thead className="sticky top-0 z-10">
            <tr className="bg-app-elevated">
              <th className="p-2 border-b border-r border-app-border w-10 text-center">
                <input type="checkbox" checked={selectedRows.size === rows.length && rows.length > 0} onChange={selectAll} className="accent-app-accent" />
              </th>
              <th className="p-2 border-b border-r border-app-border w-10 text-center text-app-text3 font-medium">#</th>
              {visibleColumns.map((col, idx) => {
                const isLast = idx === visibleColumns.length - 1;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "p-2 border-b border-r border-app-border text-left font-semibold text-app-text1 uppercase text-xs tracking-wider whitespace-nowrap",
                      isLast && "pr-6"
                    )}
                    style={col.width ? { width: col.width, minWidth: col.width, maxWidth: col.width } : undefined}
                  >
                    {col.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleColumns.length + 2} className="p-8 text-center text-muted-foreground text-sm">Loading…</td>
              </tr>
            ) : (
              rows.map((row, ri) => {
                const showDatatype = shouldShowDatatypeForRow(row);
                const onboardRowStatus = inflightRows.has(ri) ? "inflight" as const
                  : failedRows.has(ri) ? "failed" as const
                  : row.auto_onboarded === "true" ? "done" as const
                  : null;
                const rowBg = selectedRows.has(ri) ? "bg-app-accent-sub"
                  : onboardRowStatus === "inflight" ? "bg-amber-500/10"
                  : onboardRowStatus === "failed" ? "bg-red-500/10"
                  : onboardRowStatus === "done" ? "bg-green-500/5"
                  : "bg-app-surface";
                return (
                  <tr
                    key={ri}
                    data-row-index={ri}
                    onMouseEnter={() => onMouseEnterRow(ri)}
                    className={`${rowBg} transition-colors`}
                    style={!selectedRows.has(ri) && onboardRowStatus === null && ri % 2 === 0 ? { background: "var(--app-neutral-sub)" } : undefined}
                  >
                    <td className="p-1 border-b border-r border-app-border text-center">
                      <input type="checkbox" checked={selectedRows.has(ri)} onChange={() => toggleSelect(ri)} className="accent-app-accent" />
                    </td>
                    <td className="p-1 border-b border-r border-app-border text-center text-app-text3 text-xs">{ri + 1}</td>
                    {visibleColumns.map((col, idx) => renderCell({
                      col, row, ri, showDatatype,
                      isLast: idx === visibleColumns.length - 1,
                      onboardRowStatus,
                      editingCell, setEditingCell,
                      handleCellMouseDown, getCellSelectionBorders, isSelectionTailCell,
                      isHighlighted, getHighlightBorders, startDragFromTail, updateCell,
                      serverOptions, serverToPortsMap, allPortOptions, serverColKey,
                      serverPortToRacksMap, allRackOptions, rackColKey,
                      serverPortRackToSlotsMap, allSlotOptions, slotColKey,
                      pollingEntries, pollingEntryServerField,
                    }))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex-shrink-0 flex items-center px-4 py-1.5 bg-app-surface border-t border-app-border text-[11px] text-app-text3">
        <span>{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
        <div className="flex-1" />
        <span>{selectedRows.size} selected</span>
      </div>

    </div>
  );
}

// ---- Cell renderer (extracted to keep JSX manageable) ----

function renderCell({
  col, row, ri, showDatatype,
  isLast,
  onboardRowStatus,
  editingCell, setEditingCell,
  handleCellMouseDown, getCellSelectionBorders, isSelectionTailCell,
  isHighlighted, getHighlightBorders, startDragFromTail, updateCell,
  serverOptions, serverToPortsMap, allPortOptions, serverColKey,
  serverPortToRacksMap, allRackOptions, rackColKey,
  serverPortRackToSlotsMap, allSlotOptions, slotColKey,
  pollingEntries, pollingEntryServerField,
}: {
  col: CSVColumnDescriptor;
  row: CSVRow;
  ri: number;
  showDatatype: boolean;
  isLast?: boolean;
  onboardRowStatus?: "inflight" | "failed" | "done" | null;
  editingCell: { row: number; col: string } | null;
  setEditingCell: (v: { row: number; col: string } | null) => void;
  handleCellMouseDown: (e: React.MouseEvent, ri: number, col: string) => void;
  getCellSelectionBorders: (ri: number, col: string) => { top: boolean; bottom: boolean; left: boolean; right: boolean } | null;
  isSelectionTailCell: (ri: number, col: string) => boolean;
  isHighlighted: (ri: number, col: string) => boolean;
  getHighlightBorders: (ri: number, col: string) => { top: boolean; bottom: boolean; left: boolean; right: boolean } | null;
  startDragFromTail: (fromRow: number, col: string, fallbackValue: string) => void;
  updateCell: (ri: number, col: string, value: string) => void;
  serverOptions: string[];
  serverToPortsMap: Record<string, string[]>;
  allPortOptions: string[];
  serverColKey: string;
  serverPortToRacksMap: Record<string, string[]>;
  allRackOptions: string[];
  rackColKey: string;
  serverPortRackToSlotsMap: Record<string, string[]>;
  allSlotOptions: string[];
  slotColKey: string;
  pollingEntries: Record<string, any>[];
  pollingEntryServerField: string;
}) {
  const { key, widget, monospace, visibleWhen } = col;
  const borders = getCellSelectionBorders(ri, key);
  const isSelected = borders !== null;
  const highlighted = isHighlighted(ri, key);
  const isSelTail = isSelectionTailCell(ri, key);
  const isEditing = editingCell?.row === ri && editingCell?.col === key;

  let selectionStyle: React.CSSProperties | undefined;
  if (borders && !isEditing) {
    const color = "var(--app-accent)";
    const shadows: string[] = [];
    if (borders.left)   shadows.push(`inset 2px 0 0 0 ${color}`);
    if (borders.right)  shadows.push(`inset -2px 0 0 0 ${color}`);
    if (borders.top)    shadows.push(`inset 0 2px 0 0 ${color}`);
    if (borders.bottom) shadows.push(`inset 0 -2px 0 0 ${color}`);
    if (shadows.length) selectionStyle = { boxShadow: shadows.join(", ") };
  }
  // Overlay div shows only the outer edges of the fill range (no internal cell borders).
  const hb = getHighlightBorders(ri, key);
  const highlightOverlay = hb && !isEditing
    ? <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5,
        borderTop:    hb.top    ? "2px solid var(--app-accent)" : undefined,
        borderBottom: hb.bottom ? "2px solid var(--app-accent)" : undefined,
        borderLeft:   hb.left   ? "2px solid var(--app-accent)" : undefined,
        borderRight:  hb.right  ? "2px solid var(--app-accent)" : undefined,
      }} />
    : null;

  const cellStateClass = highlighted ? "bg-app-accent-sub/80" : isSelected ? "bg-app-accent-sub" : "";

  const dragHandle = (
    <DragHandle
      active={isSelTail}
      onMouseDown={() => startDragFromTail(ri, key, row[key] ?? "")}
    />
  );

  // Read-only status cell (e.g. auto_onboarded)
  if (col.readOnly) {
    let icon: React.ReactNode;
    let iconColorClass: string;
    if (onboardRowStatus === "inflight") {
      icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
      iconColorClass = "text-amber-500";
    } else if (onboardRowStatus === "failed") {
      icon = <XCircle className="h-3.5 w-3.5" />;
      iconColorClass = "text-red-500";
    } else if (row[key] === "true") {
      icon = <CheckCircle2 className="h-3.5 w-3.5" />;
      iconColorClass = "text-green-500";
    } else {
      icon = <span className="text-xs">—</span>;
      iconColorClass = "text-app-text3";
    }
    return (
      <td key={key} data-row-index={ri} data-cell-col={key}
        onMouseDown={(e) => handleCellMouseDown(e, ri, key)}
        className={cn("p-0.5 border-b border-r border-app-border relative", cellStateClass, isLast && "pr-6")}
        style={selectionStyle}
      >
        <div className={`h-8 flex items-center justify-center ${iconColorClass}`}>{icon}</div>
        {highlightOverlay}
      </td>
    );
  }

  // N/A for conditionally-visible columns when this row doesn't qualify
  if (visibleWhen?.condition === "anyServerForcesDatatype" && !showDatatype) {
    return (
      <td key={key} data-row-index={ri} data-cell-col={key}
        onMouseDown={(e) => handleCellMouseDown(e, ri, key)}
        className={cn("p-0.5 border-b border-r border-border relative", cellStateClass, isLast && "pr-6")}
        style={selectionStyle}
      >
        <span className="text-xs text-muted-foreground italic px-2">N/A</span>
        {highlightOverlay}
      </td>
    );
  }

  if (widget === "checkbox") {
    return (
      <td key={key} data-row-index={ri} data-cell-col={key}
        onMouseDown={(e) => handleCellMouseDown(e, ri, key)}
        className={cn("p-0.5 border-b border-r border-app-border relative", cellStateClass, isLast && "pr-6")}
        style={selectionStyle}
      >
        <div className="flex items-center justify-center h-8">
          <Checkbox
            checked={(row[key] ?? "").toLowerCase() === "yes"}
            onCheckedChange={(checked) => updateCell(ri, key, checked ? "yes" : "no")}
          />
        </div>
        {dragHandle}
        {highlightOverlay}
      </td>
    );
  }

  if (widget === "select") {
    const isEditingSelect = editingCell?.row === ri && editingCell?.col === key;
    const opts = col.options ?? [];
    return (
      <td key={key} data-row-index={ri} data-cell-col={key}
        onMouseDown={(e) => { if (!isEditingSelect) handleCellMouseDown(e, ri, key); }}
        onDoubleClick={() => setEditingCell({ row: ri, col: key })}
        className={cn("p-0.5 border-b border-r border-app-border relative", cellStateClass, isLast && "pr-6")}
        style={selectionStyle}
      >
        {isEditingSelect ? (
          <Select
            open
            value={row[key] || undefined}
            onValueChange={(v) => { updateCell(ri, key, v); setEditingCell(null); }}
            onOpenChange={(open) => { if (!open) setTimeout(() => setEditingCell(null), 100); }}
          >
            <SelectTrigger className="h-7 text-xs border-transparent hover:border-app-border-mid focus:border-app-accent rounded-sm bg-transparent text-app-text1">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {opts.length === 0 ? (
                <SelectItem value="__none" disabled>No options</SelectItem>
              ) : (
                opts.map((opt, i) => <SelectItem key={i} value={opt}>{opt}</SelectItem>)
              )}
            </SelectContent>
          </Select>
        ) : (
          <span className="block h-8 px-3 text-xs leading-8 truncate text-app-text1 font-mono">
            {row[key] || <span className="text-app-text3 italic">—</span>}
          </span>
        )}
        {!isEditingSelect && dragHandle}
        {highlightOverlay}
      </td>
    );
  }

  if (widget === "server-select") {
    const isEditingServer = editingCell?.row === ri && editingCell?.col === key;
    return (
      <td key={key} data-row-index={ri} data-cell-col={key}
        onMouseDown={(e) => { if (!isEditingServer) handleCellMouseDown(e, ri, key); }}
        onDoubleClick={() => setEditingCell({ row: ri, col: key })}
        className={cn("p-0.5 border-b border-r border-app-border relative", cellStateClass, isLast && "pr-6")}
        style={selectionStyle}
      >
        {isEditingServer ? (
          <Select
            open
            value={row[key] || undefined}
            onValueChange={(v) => { updateCell(ri, key, v); setEditingCell(null); }}
            onOpenChange={(open) => { if (!open) setTimeout(() => setEditingCell(null), 100); }}
          >
            <SelectTrigger className="h-7 text-xs border-transparent hover:border-app-border-mid focus:border-app-accent rounded-sm bg-transparent text-app-text1">
              <SelectValue placeholder="Select server..." />
            </SelectTrigger>
            <SelectContent>
              {serverOptions.length === 0 ? (
                <SelectItem value="__none" disabled>No servers configured</SelectItem>
              ) : (
                serverOptions.map((s, si) => <SelectItem key={si} value={s}>{s}</SelectItem>)
              )}
            </SelectContent>
          </Select>
        ) : (
          (() => {
            const si = pollingEntries.findIndex(
              (p) => String(getDeep(p, pollingEntryServerField) ?? "") === row[key]
            );
            const colorClass = si === 0 ? "text-app-accent-text font-medium" : si === 1 ? "text-teal-500 font-medium" : "text-app-text1";
            return (
              <span className={`block h-8 px-3 text-xs leading-8 truncate ${colorClass}`}>
                {row[key] || <span className="text-app-text3 italic">Select server...</span>}
              </span>
            );
          })()
        )}
        {!isEditingServer && dragHandle}
        {highlightOverlay}
      </td>
    );
  }

  if (widget === "port-select") {
    const isEditingPort = editingCell?.row === ri && editingCell?.col === key;
    const rowServer = row[serverColKey];
    const rowPortOptions = rowServer && serverToPortsMap[rowServer]
      ? serverToPortsMap[rowServer]
      : allPortOptions;
    return (
      <td key={key} data-row-index={ri} data-cell-col={key}
        onMouseDown={(e) => { if (!isEditingPort) handleCellMouseDown(e, ri, key); }}
        onDoubleClick={() => setEditingCell({ row: ri, col: key })}
        className={cn("p-0.5 border-b border-r border-app-border relative", cellStateClass, isLast && "pr-6")}
        style={selectionStyle}
      >
        {isEditingPort ? (
          <Select
            open
            value={row[key] || undefined}
            onValueChange={(v) => { updateCell(ri, key, v); setEditingCell(null); }}
            onOpenChange={(open) => { if (!open) setTimeout(() => setEditingCell(null), 100); }}
          >
            <SelectTrigger className="h-7 text-xs border-transparent hover:border-app-border-mid focus:border-app-accent rounded-sm bg-transparent text-app-text1">
              <SelectValue placeholder="Select port..." />
            </SelectTrigger>
            <SelectContent>
              {rowPortOptions.length === 0 ? (
                <SelectItem value="__none" disabled>No ports configured</SelectItem>
              ) : (
                rowPortOptions.map((p, pi) => <SelectItem key={pi} value={p}>{p}</SelectItem>)
              )}
            </SelectContent>
          </Select>
        ) : (
          (() => {
            const pi = rowPortOptions.indexOf(row[key]);
            const colorClass = pi === 0 ? "text-app-accent-text font-medium" : pi === 1 ? "text-teal-500 font-medium" : "text-app-text1";
            return (
              <span className={`block h-8 px-3 text-xs leading-8 truncate ${colorClass}`}>
                {row[key] || <span className="text-app-text3 italic">Select port...</span>}
              </span>
            );
          })()
        )}
        {!isEditingPort && dragHandle}
        {highlightOverlay}
      </td>
    );
  }

  if (widget === "rack-select") {
    const isEditingRack = editingCell?.row === ri && editingCell?.col === key;
    const rowServer = row[serverColKey];
    const rowPort   = row["port"] ?? "";
    const mapKey    = `${rowServer}::${rowPort}`;
    const rowRackOptions = rowServer ? (serverPortToRacksMap[mapKey] ?? allRackOptions) : allRackOptions;
    return (
      <td key={key} data-row-index={ri} data-cell-col={key}
        onMouseDown={(e) => { if (!isEditingRack) handleCellMouseDown(e, ri, key); }}
        onDoubleClick={() => setEditingCell({ row: ri, col: key })}
        className={cn("p-0.5 border-b border-r border-app-border relative", cellStateClass, isLast && "pr-6")}
        style={selectionStyle}
      >
        {isEditingRack ? (
          <Select
            open
            value={row[key] || undefined}
            onValueChange={(v) => { updateCell(ri, key, v); setEditingCell(null); }}
            onOpenChange={(open) => { if (!open) setTimeout(() => setEditingCell(null), 100); }}
          >
            <SelectTrigger className="h-7 text-xs border-transparent hover:border-app-border-mid focus:border-app-accent rounded-sm bg-transparent text-app-text1">
              <SelectValue placeholder="Select rack..." />
            </SelectTrigger>
            <SelectContent>
              {rowRackOptions.length === 0 ? (
                <SelectItem value="__none" disabled>No racks configured</SelectItem>
              ) : (
                rowRackOptions.map((r, i) => <SelectItem key={i} value={r}>{r}</SelectItem>)
              )}
            </SelectContent>
          </Select>
        ) : (
          <span className="block h-8 px-3 text-xs leading-8 truncate text-app-text1">
            {row[key] || <span className="text-app-text3 italic">Select rack...</span>}
          </span>
        )}
        {!isEditingRack && dragHandle}
        {highlightOverlay}
      </td>
    );
  }

  if (widget === "slot-select") {
    const isEditingSlot = editingCell?.row === ri && editingCell?.col === key;
    const rowServer = row[serverColKey];
    const rowPort   = row["port"]  ?? "";
    const rowRack   = row[rackColKey] ?? "";
    const mapKey    = `${rowServer}::${rowPort}::${rowRack}`;
    const rowSlotOptions = rowServer ? (serverPortRackToSlotsMap[mapKey] ?? allSlotOptions) : allSlotOptions;
    return (
      <td key={key} data-row-index={ri} data-cell-col={key}
        onMouseDown={(e) => { if (!isEditingSlot) handleCellMouseDown(e, ri, key); }}
        onDoubleClick={() => setEditingCell({ row: ri, col: key })}
        className={cn("p-0.5 border-b border-r border-app-border relative", cellStateClass, isLast && "pr-6")}
        style={selectionStyle}
      >
        {isEditingSlot ? (
          <Select
            open
            value={row[key] || undefined}
            onValueChange={(v) => { updateCell(ri, key, v); setEditingCell(null); }}
            onOpenChange={(open) => { if (!open) setTimeout(() => setEditingCell(null), 100); }}
          >
            <SelectTrigger className="h-7 text-xs border-transparent hover:border-app-border-mid focus:border-app-accent rounded-sm bg-transparent text-app-text1">
              <SelectValue placeholder="Select slot..." />
            </SelectTrigger>
            <SelectContent>
              {rowSlotOptions.length === 0 ? (
                <SelectItem value="__none" disabled>No slots configured</SelectItem>
              ) : (
                rowSlotOptions.map((s, i) => <SelectItem key={i} value={s}>{s}</SelectItem>)
              )}
            </SelectContent>
          </Select>
        ) : (
          <span className="block h-8 px-3 text-xs leading-8 truncate text-app-text1">
            {row[key] || <span className="text-app-text3 italic">Select slot...</span>}
          </span>
        )}
        {!isEditingSlot && dragHandle}
        {highlightOverlay}
      </td>
    );
  }

  // text (default)
  return (
    <td key={key} data-row-index={ri} data-cell-col={key}
      onMouseDown={(e) => handleCellMouseDown(e, ri, key)}
      onDoubleClick={() => setEditingCell({ row: ri, col: key })}
      className={cn("p-0.5 border-b border-r border-app-border relative", cellStateClass, isLast && "pr-6")}
      style={selectionStyle}
    >
      {isEditing ? (
        <input
          autoFocus
          size={1}
          value={row[key] ?? ""}
          onChange={(e) => updateCell(ri, key, e.target.value)}
          onBlur={() => setEditingCell(null)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingCell(null); }}
          className="h-8 w-full min-w-0 max-w-full box-border px-3 text-xs leading-5 border-0 outline-none bg-transparent shadow-none text-app-text1"
        />
      ) : (
        <div className={`h-8 text-xs px-3 flex items-center truncate cursor-default text-app-text1 ${monospace ? "font-mono text-[11.5px] tracking-[-0.02em]" : ""}`}>
          {row[key] || <span className="text-app-text3">—</span>}
        </div>
      )}
      {!isEditing && dragHandle}
      {highlightOverlay}
    </td>
  );
}

function DragHandle({ onMouseDown, active = false }: { onMouseDown: () => void; active?: boolean }) {
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onMouseDown(); }}
      className={`absolute bottom-[-3px] right-[-3px] w-[7px] h-[7px] rounded-full bg-app-accent cursor-crosshair z-20 transition-opacity ${active ? "opacity-100" : "opacity-0 hover:opacity-100"}`}
      title="Drag to fill"
    />
  );
}
