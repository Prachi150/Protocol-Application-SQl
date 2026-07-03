import { useState, useRef, useEffect } from "react";
import { AppButton } from "@/components/ui/app-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Plus, Upload, Download, Server, AlertCircle } from "lucide-react";
import { filesApi } from "@/lib/api";
import { SysParameters } from "@/lib/sys-parameters-schema";
import { SchemaFormSections } from "@/components/SchemaFormSections";
import { EntrySummaryCard } from "@/components/EntrySummaryCard";
import { buildDefaultPollingEntry, buildDefaultPostingEntry, setDeep } from "@/lib/schema-utils";
import type { ProtocolSchema } from "@/lib/schema-types";

interface JSONEditorProps {
  params: SysParameters;
  setParams: React.Dispatch<React.SetStateAction<SysParameters>>;
  schema: ProtocolSchema;
}

export default function JSONEditor({ params, setParams, schema }: JSONEditorProps) {
  const [pollingDialogOpen, setPollingDialogOpen] = useState(false);
  const [editingPollingIndex, setEditingPollingIndex] = useState<number | null>(null);
  const [pollingDraft, setPollingDraft] = useState<Record<string, any>>(() =>
    buildDefaultPollingEntry(schema)
  );

  const [postingDialogOpen, setPostingDialogOpen] = useState(false);
  const [addPostingOpen, setAddPostingOpen] = useState(false);
  const [editingPostingIndex, setEditingPostingIndex] = useState<number | null>(null);
  const [postingDraft, setPostingDraft] = useState<Record<string, any>>({});

  const [jsonSaved, setJsonSaved] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonFileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const initialParamsRef = useRef(JSON.stringify(params));

  const pinnedType = schema.posting.types.find((t) => t.pinToIndex0)?.type ?? null;

  // Auto-inject the pinned posting type at index 0 if missing
  useEffect(() => {
    if (!pinnedType) return;
    if (params.posting[0]?.type === pinnedType) return;
    const injected = {
      ...params,
      posting: [buildDefaultPostingEntry(schema, pinnedType), ...params.posting],
    };
    setParams(injected);
    initialParamsRef.current = JSON.stringify(injected);
  }, [params, pinnedType, schema, setParams]);

  const markDirty = () => setJsonSaved(false);

  const updateDraftField = (
    draft: Record<string, any>,
    setDraft: React.Dispatch<React.SetStateAction<Record<string, any>>>,
    path: string,
    value: string | number | boolean
  ) => {
    setDraft(setDeep(draft, path, value));
  };

  // ---- Polling ----

  const openAddPolling = () => {
    setPollingDraft(buildDefaultPollingEntry(schema));
    setEditingPollingIndex(null);
    setPollingDialogOpen(true);
  };

  const openEditPolling = (index: number) => {
    setPollingDraft(JSON.parse(JSON.stringify(params.polling[index])));
    setEditingPollingIndex(index);
    setPollingDialogOpen(true);
  };

  const savePolling = () => {
    if (editingPollingIndex !== null) {
      setParams((p) => ({
        ...p,
        polling: p.polling.map((x, j) => (j === editingPollingIndex ? pollingDraft : x)),
      }));
    } else {
      setParams((p) => ({ ...p, polling: [...p.polling, pollingDraft] }));
    }
    markDirty();
    setPollingDialogOpen(false);
  };

  // ---- Posting ----

  const openAddPosting = (type: string) => {
    setPostingDraft(buildDefaultPostingEntry(schema, type));
    setEditingPostingIndex(null);
    setAddPostingOpen(false);
    setPostingDialogOpen(true);
  };

  const openEditPosting = (index: number) => {
    setPostingDraft(JSON.parse(JSON.stringify(params.posting[index])));
    setEditingPostingIndex(index);
    setPostingDialogOpen(true);
  };

  const savePosting = () => {
    if (editingPostingIndex !== null) {
      setParams((p) => ({
        ...p,
        posting: p.posting.map((x, j) => (j === editingPostingIndex ? postingDraft : x)),
      }));
    } else if (postingDraft.type === pinnedType) {
      setParams((p) => ({ ...p, posting: [postingDraft, ...p.posting] }));
    } else {
      setParams((p) => ({ ...p, posting: [...p.posting, postingDraft] }));
    }
    markDirty();
    setPostingDialogOpen(false);
  };

  // ---- File I/O ----

  const openFile = async () => {
    if ("showOpenFilePicker" in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: "JSON Files", accept: { "application/json": [".json"] } }],
        });
        jsonFileHandleRef.current = handle;
        const file = await handle.getFile();
        const text = await file.text();
        try {
          const data = JSON.parse(text);
          setParams(data);
          setJsonSaved(true);
          initialParamsRef.current = JSON.stringify(data);
          toast.success("JSON loaded");
        } catch {
          toast.error("Invalid JSON file");
        }
      } catch {
        // cancelled
      }
    } else {
      fileRef.current?.click();
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        setParams(data);
        setJsonSaved(true);
        initialParamsRef.current = JSON.stringify(data);
        toast.success("JSON loaded");
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const saveFile = async () => {
    const json = JSON.stringify(params, null, 2);
    if (jsonFileHandleRef.current) {
      try {
        const writable = await (jsonFileHandleRef.current as any).createWritable();
        await writable.write(json);
        await writable.close();
        setJsonSaved(true);
        toast.success("JSON saved to file");
        return;
      } catch {
        // fall through
      }
    }
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: "sys_parameters.json",
          types: [{ description: "JSON Files", accept: { "application/json": [".json"] } }],
        });
        jsonFileHandleRef.current = handle;
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setJsonSaved(true);
        toast.success("JSON saved to file");
        return;
      } catch {
        // cancelled
      }
    } else {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sys_parameters.json";
      a.click();
      URL.revokeObjectURL(url);
      setJsonSaved(true);
      toast.success("JSON saved");
    }
  };

  const saveToServer = async () => {
    try {
      const json = JSON.stringify(params, null, 2);
      const result = await filesApi.writeDefault("json", json);
      setJsonSaved(true);
      initialParamsRef.current = JSON.stringify(params);
      toast.success(result.message);
    } catch (err: any) {
      toast.error(err.message || "Failed to save to server");
    }
  };

  // ---- Current posting type schema ----
  const currentPostingTypeSchema = schema.posting.types.find(
    (t) => t.type === postingDraft.type
  );

  return (
    <div className="flex flex-col h-full">
      <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />

      {!jsonSaved && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-app-warning-sub border-b border-app-warning/20 text-app-warning text-xs font-medium">
          <AlertCircle className="h-3.5 w-3.5" />
          Unsaved changes — save before changing tabs or restarting the service.
        </div>
      )}

      <div className="flex items-center gap-2 p-3 border-b border-app-border bg-app-elevated">
        <AppButton size="sm" onClick={openFile} variant="outline" className="gap-1.5">
          <Upload className="h-3.5 w-3.5" /> Import JSON
        </AppButton>
        <AppButton size="sm" onClick={saveFile} variant="outline" className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export JSON
        </AppButton>
        <div className="w-px h-6 border-app-border mx-1" />
        <AppButton 
          onClick={saveToServer} 
          className="ml-auto h-8 px-4"
        >
          <Server className="h-3.5 w-3.5" /> Save to Device
        </AppButton>
      </div>

      <div className="flex-1 overflow-auto p-6 pt-2 space-y-8">
        {/* Polling Section */}
        <div className="mt-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-[3px] h-3.5 rounded-full bg-app-accent flex-shrink-0" />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.085em] text-app-text3 whitespace-nowrap">
              {schema.polling.sectionLabel}
            </span>
            <div className="flex-1 h-px bg-app-border" />
            <AppButton size="sm" variant="outline" onClick={openAddPolling} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add {schema.polling.entryLabel}
            </AppButton>
          </div>
          <div className="space-y-2">
            {params.polling.map((entry, i) => (
              <EntrySummaryCard
                key={i}
                summary={schema.polling.summary}
                entry={entry as Record<string, any>}
                index={i}
                accentColor="primary"
                isLocked={false}
                onEdit={() => openEditPolling(i)}
                onDelete={() => {
                  setParams((p) => ({ ...p, polling: p.polling.filter((_, j) => j !== i) }));
                  markDirty();
                }}
              />
            ))}
            {params.polling.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                No {schema.polling.sectionLabel.toLowerCase()} configured. Click "Add{" "}
                {schema.polling.entryLabel}" to create one.
              </p>
            )}
          </div>
        </div>

        {/* Posting Section */}
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-[3px] h-3.5 rounded-full bg-app-accent flex-shrink-0" />
            <span className="text-[10.5px] font-bold uppercase tracking-[0.085em] text-app-text3 whitespace-nowrap">
              Posting
            </span>
            <div className="flex-1 h-px bg-app-border" />
            <AppButton
              size="sm"
              variant="outline"
              onClick={() => setAddPostingOpen(true)}
              className="gap-1.5"
              disabled={pinnedType !== null && params.posting[0]?.type === pinnedType}
            >
              <Plus className="h-3.5 w-3.5" /> Add Posting Entry
            </AppButton>
          </div>
          <div className="space-y-2">
            {params.posting.map((entry, i) => {
              const typeSchema = schema.posting.types.find((t) => t.type === (entry as any).type);
              const isLocked = i === 0 && (entry as any).type === pinnedType;
              return (
                <EntrySummaryCard
                  key={i}
                  summary={typeSchema?.summary ?? schema.posting.types[0].summary}
                  entry={entry as Record<string, any>}
                  index={i}
                  accentColor="accent"
                  isLocked={isLocked}
                  onEdit={() => openEditPosting(i)}
                  onDelete={() => {
                    setParams((p) => ({ ...p, posting: p.posting.filter((_, j) => j !== i) }));
                    markDirty();
                  }}
                />
              );
            })}
            {params.posting.length === 0 && (
              <p className="text-sm text-muted-foreground italic">
                No posting entries configured. Click "Add Posting Entry" to create one.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Polling Add/Edit Dialog */}
      <Dialog open={pollingDialogOpen} onOpenChange={setPollingDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingPollingIndex !== null
                ? `Edit ${schema.polling.entryLabel}`
                : `Add ${schema.polling.entryLabel}`}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto pr-4">
            <SchemaFormSections
              sections={schema.polling.sections}
              entry={pollingDraft}
              updateField={(path, value) =>
                updateDraftField(pollingDraft, setPollingDraft, path, value)
              }
            />
          </div>
          <DialogFooter>
            <AppButton variant="outline" onClick={() => setPollingDialogOpen(false)}>
              Cancel
            </AppButton>
            <AppButton onClick={savePolling}>Save</AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Posting Type Picker Dialog */}
      <Dialog open={addPostingOpen} onOpenChange={setAddPostingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Posting Entry</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Choose the posting type:</p>
          <div className="flex gap-3 flex-wrap">
            {schema.posting.types
              .filter((t) => !(t.pinToIndex0 && params.posting[0]?.type === t.type))
              .map((t, i) => (
                <AppButton
                  key={t.type}
                  className="flex-1"
                  variant={i === 0 ? "default" : "outline"}
                  onClick={() => openAddPosting(t.type)}
                >
                  {t.label}
                </AppButton>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Posting Add/Edit Dialog */}
      <Dialog open={postingDialogOpen} onOpenChange={setPostingDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingPostingIndex !== null
                ? `Edit ${currentPostingTypeSchema?.label ?? ""} Posting`
                : `Add ${currentPostingTypeSchema?.label ?? ""} Posting`}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto pr-4">
            {currentPostingTypeSchema && (
              <SchemaFormSections
                sections={currentPostingTypeSchema.sections}
                entry={postingDraft}
                updateField={(path, value) =>
                  updateDraftField(postingDraft, setPostingDraft, path, value)
                }
              />
            )}
          </div>
          <DialogFooter>
            <AppButton variant="outline" onClick={() => setPostingDialogOpen(false)}>
              Cancel
            </AppButton>
            <AppButton onClick={savePosting}>Save</AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
