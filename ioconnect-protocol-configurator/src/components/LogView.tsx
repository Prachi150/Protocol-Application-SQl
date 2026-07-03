import { useState, useEffect, useCallback, useRef } from "react";
import { ScrollText, RefreshCw, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Panel,
  PanelHeader,
  PanelBody,
  AppAlert,
  IconBtn,
  StatusBadge,
} from "@/components/ui/app-ui";
import { logsApi, getLogsStreamUrl } from "@/lib/api";

const MAX_LINES = 2000;
const GRID = "72px 68px 110px 160px 1fr";

const BASE_KEYS = new Set([
  "time", "level", "service", "file", "function", "thread", "message", "exception",
]);

interface LogEntry {
  id: number;
  raw: string;
}

interface ParsedLog {
  time?: string;
  level?: string;
  file?: string;
  function?: string;
  thread?: string;
  message?: string;
  exception?: string;
  [key: string]: unknown;
}

function parseLog(raw: string): ParsedLog | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj.level && !obj.message) return null;
    return obj as ParsedLog;
  } catch {
    return null;
  }
}

function getExtras(p: ParsedLog): [string, unknown][] {
  return Object.entries(p).filter(([k]) => !BASE_KEYS.has(k));
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function timeShort(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    const m = iso.match(/T(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : iso.slice(0, 8);
  }
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

const LEVEL_COLOR: Record<string, string> = {
  CRITICAL: "var(--app-danger)",
  ERROR: "var(--app-danger)",
  WARNING: "var(--app-warning)",
  INFO: "var(--app-text-3)",
  DEBUG: "var(--app-text-3)",
};

function msgColor(level: string) {
  const u = level.toUpperCase();
  return u === "CRITICAL" || u === "ERROR" || u === "WARNING"
    ? LEVEL_COLOR[u]
    : "var(--app-text-1)";
}

function HeaderRow() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 10,
        padding: "4px 0 6px",
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "var(--app-bg)",
        borderBottom: "1px solid var(--app-border)",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--app-text-3)",
      }}
    >
      <span>Time</span>
      <span>Level</span>
      <span>Thread</span>
      <span>File · Func</span>
      <span>Message</span>
    </div>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const p = parseLog(entry.raw);

  if (!p) {
    return (
      <div
        style={{
          padding: "2px 0",
          color: "var(--app-text-3)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          borderTop: "1px solid var(--app-border)",
        }}
      >
        {entry.raw}
      </div>
    );
  }

  const level = (p.level ?? "info").toUpperCase();
  const lc = LEVEL_COLOR[level] ?? "var(--app-text-3)";
  const mc = msgColor(level);
  const fileFunc = [p.file, p.function].filter(Boolean).join(":");
  const hasEx = !!p.exception;
  const extras = getExtras(p);
  const isExpandable = hasEx || extras.length > 0;

  return (
    <>
      <div
        onClick={isExpandable ? onToggle : undefined}
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: 10,
          padding: "2px 0",
          borderTop: "1px solid var(--app-border)",
          alignItems: "baseline",
          cursor: isExpandable ? "pointer" : "default",
        }}
      >
        <span
          style={{ color: "var(--app-text-3)", whiteSpace: "nowrap" }}
          title={p.time}
        >
          {timeShort(p.time ?? "")}
        </span>
        <span
          style={{
            color: lc,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          {isExpandable &&
            (expanded ? (
              <ChevronDown size={9} style={{ flexShrink: 0 }} />
            ) : (
              <ChevronRight size={9} style={{ flexShrink: 0 }} />
            ))}
          {level}
        </span>
        <span
          style={{
            color: "var(--app-text-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={p.thread}
        >
          {p.thread ?? ""}
        </span>
        <span
          style={{
            color: "var(--app-text-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={fileFunc}
        >
          {fileFunc}
        </span>
        <span
          style={{
            color: mc,
            wordBreak: "break-word",
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {p.message ?? ""}
          {extras.length > 0 && (
            <span
              style={{
                fontSize: 9,
                padding: "1px 5px",
                borderRadius: 3,
                background: "var(--app-elevated)",
                color: "var(--app-text-2)",
                border: "1px solid var(--app-border-mid)",
                flexShrink: 0,
                fontFamily: "'IBM Plex Sans', sans-serif",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.6,
              }}
            >
              +{extras.length} ctx
            </span>
          )}
        </span>
      </div>
      {isExpandable && expanded && (
        <div
          style={{
            padding: "6px 10px",
            marginBottom: 4,
            background: hasEx && extras.length === 0 ? "var(--app-danger-sub)" : "var(--app-elevated)",
            borderRadius: 6,
            borderLeft: `2px solid ${hasEx ? "var(--app-danger)" : "var(--app-border-mid)"}`,
          }}
        >
          {extras.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "max-content 1fr",
                columnGap: 16,
                rowGap: 1,
                marginBottom: hasEx ? 8 : 0,
              }}
            >
              {extras.map(([k, v]) => (
                <>
                  <span
                    key={`k-${k}`}
                    style={{
                      color: "var(--app-text-2)",
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      whiteSpace: "nowrap",
                      userSelect: "none",
                    }}
                  >
                    {k}
                  </span>
                  <span
                    key={`v-${k}`}
                    style={{
                      color: "var(--app-text-1)",
                      wordBreak: "break-all",
                    }}
                  >
                    {formatValue(v)}
                  </span>
                </>
              ))}
            </div>
          )}
          {hasEx && (
            <pre
              style={{
                margin: 0,
                fontSize: 10,
                color: "var(--app-danger)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {p.exception}
            </pre>
          )}
        </div>
      )}
    </>
  );
}

type LiveStatus = "off" | "connecting" | "connected" | "error";

export default function LogView() {
  const [allEntries, setAllEntries] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState("ALL");
  const [lineCount, setLineCount] = useState(200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [live, setLive] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("off");
  // expandAll=true: all expandable rows open by default; overrides tracks individual exceptions
  const [expandAll, setExpandAll] = useState(false);
  const [overrides, setOverrides] = useState<Set<number>>(new Set());
  const idRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // When expandAll=true, a row is expanded unless it's in overrides (collapsed by user).
  // When expandAll=false, a row is expanded only if it's in overrides (opened by user).
  function isExpanded(id: number) {
    return expandAll ? !overrides.has(id) : overrides.has(id);
  }

  function toggleRow(id: number) {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpandAll() {
    setExpandAll((prev) => !prev);
    setOverrides(new Set());
  }

  const displayedEntries =
    level === "ALL"
      ? allEntries
      : allEntries.filter(({ raw }) => {
          try {
            return (JSON.parse(raw).level ?? "").toUpperCase() === level;
          } catch {
            return false;
          }
        });

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await logsApi.fetch(lineCount);
      setAllEntries(res.lines.map((raw) => ({ id: idRef.current++, raw })));
      setSource(res.source);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [lineCount]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayedEntries.length]);

  // SSE lifecycle — open/close when `live` toggles
  useEffect(() => {
    if (!live) {
      esRef.current?.close();
      esRef.current = null;
      setLiveStatus("off");
      return;
    }

    setLiveStatus("connecting");
    const es = new EventSource(getLogsStreamUrl());
    esRef.current = es;

    es.onopen = () => setLiveStatus("connected");

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as {
          line?: string;
          error?: string;
        };
        if (payload.error) {
          setError(payload.error);
          setLive(false);
          return;
        }
        if (payload.line) {
          const entry: LogEntry = { id: idRef.current++, raw: payload.line };
          setAllEntries((prev) => {
            const next = [...prev, entry];
            return next.length > MAX_LINES
              ? next.slice(next.length - MAX_LINES)
              : next;
          });
        }
      } catch {
        // ignore malformed SSE frames
      }
    };

    es.onerror = () => {
      setLiveStatus("error");
      es.close();
    };

    return () => {
      es.close();
    };
  }, [live]);

  const liveBadge = live ? (
    liveStatus === "connected" ? (
      <StatusBadge variant="success" dot>
        Live
      </StatusBadge>
    ) : liveStatus === "connecting" ? (
      <StatusBadge variant="warning" dot>
        Connecting
      </StatusBadge>
    ) : liveStatus === "error" ? (
      <StatusBadge variant="danger">Stream error</StatusBadge>
    ) : null
  ) : null;

  return (
    <div style={{ padding: "22px 24px" }}>
      <Panel>
        <PanelHeader
          icon={ScrollText}
          iconColor="accent"
          title="Service Logs"
          subtitle={source ? `via ${source}` : undefined}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--app-text-3)",
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                {displayedEntries.length} entries
              </span>
              {liveBadge}
            </div>
          }
        />
        <PanelBody>
          {/* Controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            {/* Level filter — applied client-side, no refetch */}
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger
                style={{
                  width: 160,
                  height: 36,
                  fontSize: 13,
                  background: "var(--app-elevated)",
                  border: "1px solid var(--app-border-mid)",
                  color: "var(--app-text-1)",
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["ALL", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].map(
                  (l) => (
                    <SelectItem key={l} value={l}>
                      {l === "ALL" ? "All Levels" : l}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            {/* Line count — history fetch only, disabled in live mode */}
            <Select
              value={String(lineCount)}
              onValueChange={(v) => setLineCount(Number(v))}
              disabled={live}
            >
              <SelectTrigger
                style={{
                  width: 110,
                  height: 36,
                  fontSize: 13,
                  background: "var(--app-elevated)",
                  border: "1px solid var(--app-border-mid)",
                  color: "var(--app-text-1)",
                  opacity: live ? 0.5 : 1,
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[100, 200, 500, 1000].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} lines
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Refresh — disabled while live or loading */}
            <IconBtn
              onClick={fetchHistory}
              disabled={loading || live}
              title="Refresh"
            >
              <RefreshCw
                size={14}
                className={loading ? "animate-spin" : ""}
              />
            </IconBtn>

            {/* Expand / collapse all rows */}
            <IconBtn onClick={toggleExpandAll} title={expandAll ? "Collapse all" : "Expand all"}>
              {expandAll ? (
                <ChevronsDownUp size={14} />
              ) : (
                <ChevronsUpDown size={14} />
              )}
            </IconBtn>

            {/* Live toggle — SSE stream */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                marginLeft: "auto",
              }}
            >
              <Switch checked={live} onCheckedChange={setLive} />
              <span style={{ fontSize: 13, color: "var(--app-text-2)" }}>
                Live
              </span>
            </label>
          </div>

          {error && (
            <AppAlert severity="error" className="mb-3">
              {error}
            </AppAlert>
          )}

          {/* Log container */}
          <div
            style={{
              height: 520,
              overflowY: "auto",
              borderRadius: 8,
              padding: "0 12px 12px",
              background: "var(--app-bg)",
              border: "1px solid var(--app-border)",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              lineHeight: 1.6,
            }}
          >
            {displayedEntries.length === 0 && !loading ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "var(--app-text-3)",
                  fontFamily: "IBM Plex Sans, sans-serif",
                  fontSize: 13,
                }}
              >
                No log entries found.
              </div>
            ) : (
              <>
                <HeaderRow />
                {displayedEntries.map((entry) => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    expanded={isExpanded(entry.id)}
                    onToggle={() => toggleRow(entry.id)}
                  />
                ))}
              </>
            )}
            <div ref={endRef} />
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
