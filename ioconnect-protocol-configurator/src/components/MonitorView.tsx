import { useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { filesApi, getMonitorStreamUrl, TagSnapshot } from "@/lib/api";
import { parseCSV } from "@/lib/csv-headers";
import { protocolSchema } from "@/lib/schema";

interface TagRow {
  device: string;
  tag: string;
  address: string;
  value: string | null;
  timestamp: string | null;
}

type ConnectionState = "connecting" | "connected" | "broker_error" | "error";

export default function MonitorView() {
  const [rows, setRows] = useState<TagRow[]>([]);
  const [liveMap, setLiveMap] = useState<Map<string, TagSnapshot>>(new Map());
  const [filter, setFilter] = useState("");
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [brokerError, setBrokerError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const liveMapRef = useRef<Map<string, TagSnapshot>>(new Map());

  const addressLabel = protocolSchema.csv.columns.find(c => c.key === "address")?.label ?? "Address";

  // Load CSV once on mount to build the base rows
  useEffect(() => {
    filesApi
      .readDefault("csv")
      .then(({ content }) => {
        const { rows: csvRows } = parseCSV(content);
        const tagRows: TagRow[] = csvRows.map((r) => ({
          device: r.device ?? "",
          tag: r.tag ?? "",
          address: r.address ?? "",
          value: null,
          timestamp: null,
        }));
        setRows(tagRows);
      })
      .catch(() => {
        // If CSV can't be loaded, start with empty rows
      });
  }, []);

  // SSE connection
  useEffect(() => {
    const url = getMonitorStreamUrl();

    function connect() {
      const es = new EventSource(url);
      esRef.current = es;
      setConnState("connecting");

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as {
            type: "snapshot" | "update" | "broker_connected" | "error";
            tags?: TagSnapshot[];
            message?: string;
          };

          if (event.type === "broker_connected") {
            setConnState("connected");
            setBrokerError(null);
            return;
          }

          if (event.type === "error") {
            setBrokerError(event.message ?? "Broker unavailable");
            setConnState("broker_error");
            es.close();
            return;
          }

          // snapshot / update — just refresh the live map, don't touch conn state
          setLiveMap((prev) => {
            const next = new Map(prev);
            for (const snap of event.tags ?? []) {
              next.set(`${snap.device}::${snap.tag}`, snap);
            }
            liveMapRef.current = next;
            return next;
          });
        } catch {
          // malformed event — ignore
        }
      };

      es.onerror = () => {
        setConnState("error");
        es.close();
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      esRef.current?.close();
    };
  }, []);

  const filtered = rows.filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      r.device.toLowerCase().includes(q) ||
      r.tag.toLowerCase().includes(q) ||
      r.address.toLowerCase().includes(q)
    );
  });

  function formatTimestamp(iso: string) {
    return new Date(iso).toLocaleString();
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background">
        <Input
          className="h-7 w-56 text-xs"
          placeholder="Filter by device, tag, or address…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {rows.length} tags
          </span>
          {connState === "connected" && (
            <Badge
              variant="outline"
              className="text-xs gap-1 py-0 border-green-300 text-green-700 bg-green-50"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
              Connected
            </Badge>
          )}
          {connState === "connecting" && (
            <Badge
              variant="outline"
              className="text-xs gap-1 py-0 border-yellow-300 text-yellow-700 bg-yellow-50"
            >
              Connecting…
            </Badge>
          )}
          {connState === "error" && (
            <Badge
              variant="outline"
              className="text-xs gap-1 py-0 border-red-300 text-red-700 bg-red-50"
            >
              Reconnecting…
            </Badge>
          )}
          {connState === "broker_error" && (
            <Badge
              variant="outline"
              className="text-xs gap-1 py-0 border-orange-300 text-orange-700 bg-orange-50"
              title={brokerError ?? undefined}
            >
              No broker
            </Badge>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="text-xs w-32">Device ID</TableHead>
              <TableHead className="text-xs w-40">Sensor ID</TableHead>
              <TableHead className="text-xs font-mono">{addressLabel}</TableHead>
              <TableHead className="text-xs w-32">Value</TableHead>
              <TableHead className="text-xs w-44">Last Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-xs text-muted-foreground py-8"
                >
                  {rows.length === 0
                    ? "No tags found in config.csv"
                    : "No tags match the filter"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const snap = liveMap.get(`${row.device}::${row.tag}`);
                return (
                  <TableRow key={`${row.device}::${row.tag}`}>
                    <TableCell className="text-xs font-medium">
                      {row.device}
                    </TableCell>
                    <TableCell className="text-xs">{row.tag}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {row.address}
                    </TableCell>
                    <TableCell className="text-xs">
                      {snap ? (
                        <span className="font-mono">{snap.value}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {snap ? formatTimestamp(snap.timestamp) : "Waiting…"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
