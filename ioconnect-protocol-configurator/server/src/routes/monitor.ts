import { Router, Request, Response } from "express";
import { Kafka, logLevel, CompressionTypes, CompressionCodecs } from "kafkajs";
// LZ4 codec must be registered before any consumer is created
// eslint-disable-next-line @typescript-eslint/no-require-imports
CompressionCodecs[CompressionTypes.LZ4] = new (require("kafkajs-lz4"))().codec;
import fs from "fs";
import path from "path";

const router = Router();
const FILES_BASE_DIR = process.env.FILES_BASE_DIR ?? ".";

// When set, Live Values is driven by adapters POSTing to /api/monitor/ingest
// instead of a Kafka/Redpanda consumer. Useful where no broker is available
// (local/dev). The Kafka path is left fully intact for production.
const INGEST_HTTP =
  process.env.MONITOR_INGEST_HTTP === "1" ||
  process.env.MONITOR_INGEST_HTTP === "true";

interface TagSnapshot {
  device: string;
  tag: string;
  value: string;
  timestamp: string;
}

const cache = new Map<string, TagSnapshot>();
const sseClients = new Set<Response>();

type ConsumerStatus = "idle" | "connecting" | "connected" | "error";
let consumerStatus: ConsumerStatus = "idle";
let consumerErrorMsg: string | null = null;
let activeConsumer: any = null;
let subscribedDeviceIds: string[] = [];

function broadcast(event: object) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach((res) => res.write(data));
}

function setConsumerStatus(status: ConsumerStatus, errorMsg?: string) {
  consumerStatus = status;
  consumerErrorMsg = errorMsg ?? null;
}

function readDeviceIdsFromCSV(): string[] {
  try {
    const csvPath = path.join(FILES_BASE_DIR, "config.csv");
    if (!fs.existsSync(csvPath)) return [];
    const csvText = fs.readFileSync(csvPath, "utf-8");
    const [headerLine, ...lines] = csvText.trim().split("\n");
    const headers = headerLine.split(",").map((h) => h.trim());
    const deviceIdx = headers.indexOf("device");
    if (deviceIdx === -1) return [];
    return [
      ...new Set(
        lines
          .map((l) => l.split(",")[deviceIdx]?.trim())
          .filter(Boolean) as string[]
      ),
    ];
  } catch {
    return [];
  }
}

async function startConsumer() {
  // Don't start while already connecting.
  if (consumerStatus === "connecting") return;

  // If already connected, check whether device IDs in the CSV have changed.
  // If they haven't, nothing to do; if they have, stop and re-subscribe.
  if (consumerStatus === "connected") {
    const currentIds = readDeviceIdsFromCSV();
    const same =
      currentIds.length === subscribedDeviceIds.length &&
      currentIds.every((id) => subscribedDeviceIds.includes(id));
    if (same) return;

    // Device IDs changed — disconnect the old consumer before restarting.
    if (activeConsumer) {
      try { await activeConsumer.disconnect(); } catch { /* ignore */ }
      activeConsumer = null;
    }
    subscribedDeviceIds = [];
  }

  setConsumerStatus("connecting");

  // Broker address: env var wins; fall back to sys_parameters.json redpanda config.
  // Either source is sufficient — env vars don't require a posting entry in the file.
  let posting: any = null;
  const sysPath = path.join(FILES_BASE_DIR, "sys_parameters.json");
  if (fs.existsSync(sysPath)) {
    try {
      const sys = JSON.parse(fs.readFileSync(sysPath, "utf-8"));
      const p = sys.posting?.[0];
      if (p?.type === "redpanda") posting = p;
    } catch (err) {
      console.warn("[monitor] Failed to parse sys_parameters.json:", err);
    }
  }

  const brokerAddress = process.env.REDPANDA_KAFKA_ADDRESS || posting?.bootstrap_servers;
  if (!brokerAddress) {
    const msg = "No Redpanda broker configured — set REDPANDA_KAFKA_ADDRESS or add a redpanda posting entry in sys_parameters.json";
    console.warn("[monitor]", msg);
    setConsumerStatus("error", msg);
    broadcast({ type: "error", message: msg });
    return;
  }

  const csvPath = path.join(FILES_BASE_DIR, "config.csv");
  if (!fs.existsSync(csvPath)) {
    const msg = "config.csv not found — no topics to subscribe to";
    console.log("[monitor]", msg);
    setConsumerStatus("error", msg);
    broadcast({ type: "error", message: msg });
    return;
  }

  let deviceIds: string[] = [];
  try {
    const csvText = fs.readFileSync(csvPath, "utf-8");
    const [headerLine, ...lines] = csvText.trim().split("\n");
    const headers = headerLine.split(",").map((h) => h.trim());
    const deviceIdx = headers.indexOf("device");
    deviceIds = [
      ...new Set(
        lines
          .map((l) => l.split(",")[deviceIdx]?.trim())
          .filter(Boolean) as string[]
      ),
    ];
  } catch (err) {
    const msg = "Failed to read config.csv";
    console.warn("[monitor]", msg, err);
    setConsumerStatus("error", msg);
    broadcast({ type: "error", message: msg });
    return;
  }

  if (deviceIds.length === 0) {
    const msg = "No device IDs in config.csv — no topics to subscribe to";
    console.warn("[monitor]", msg);
    setConsumerStatus("error", msg);
    broadcast({ type: "error", message: msg });
    return;
  }

  const topics = deviceIds.map((id) => `devicesIn.${id}.data`);

  const securityProtocol = process.env.REDPANDA_KAFKA_SECURITY_PROTOCOL || posting?.security_protocol;
  const saslMechanism = process.env.REDPANDA_KAFKA_SASL_MECHANISM || posting?.sasl_mechanism;
  const saslUsername = process.env.REDPANDA_KAFKA_SASL_USERNAME || posting?.sasl_username;
  const saslPassword = process.env.REDPANDA_KAFKA_SASL_PASSWORD || posting?.sasl_password;

  const kafkaConfig: any = {
    clientId: process.env.KAFKA_CLIENT_ID || "lsg-opcua-configurator",
    brokers: brokerAddress.split(",").map((s: string) => s.trim()),
    logLevel: logLevel.WARN,
  };

  if (securityProtocol === "SASL_PLAINTEXT" || securityProtocol === "SASL_SSL") {
    kafkaConfig.sasl = {
      mechanism: (saslMechanism || "scram-sha-256").toLowerCase(),
      username: saslUsername,
      password: saslPassword,
    };
    if (securityProtocol === "SASL_SSL") {
      kafkaConfig.ssl = true;
    }
  }

  const kafka = new Kafka(kafkaConfig);
  // Use a per-process unique group ID so each server instance independently
  // consumes all partitions, avoiding partition-stealing between instances.
  const groupId = process.env.KAFKA_GROUP_ID ?? `lsg-opcua-monitor-${process.pid}`;
  const consumer = kafka.consumer({ groupId });
  activeConsumer = consumer;
  subscribedDeviceIds = deviceIds;

  try {
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: false });
    console.log(`[monitor] Subscribed to topics: ${topics.join(", ")}`);
    setConsumerStatus("connected");
    broadcast({ type: "broker_connected" });

    await consumer.run({
      eachMessage: async ({ message }: { message: any }) => {
        if (!message.value) return;
        let payload: any;
        try {
          payload = JSON.parse(message.value.toString());
        } catch {
          return;
        }

        const device: string = payload.device;
        const tsMs: number = payload.time;
        const timestamp = new Date(tsMs).toISOString();
        const updates: TagSnapshot[] = [];

        for (const item of payload.data ?? []) {
          const tag: string = item.tag;
          const value: string = String(item.value);
          const snap: TagSnapshot = { device, tag, value, timestamp };
          cache.set(`${device}::${tag}`, snap);
          updates.push(snap);
        }

        if (updates.length > 0) {
          broadcast({ type: "update", tags: updates });
        }
      },
    });
  } catch (err) {
    const msg = `Broker connection failed: ${(err as Error).message}`;
    console.error("[monitor] Kafka consumer error:", err);
    setConsumerStatus("error", msg);
    broadcast({ type: "error", message: msg });
    activeConsumer = null;
    subscribedDeviceIds = [];
  }
}

// Update the cache + push to SSE clients from a single adapter payload.
// Shared shape with the Kafka path: { device, time, data: [{ tag, value }] }.
function ingestPayload(payload: any): number {
  if (!payload || !payload.device) return 0;
  const device: string = payload.device;
  const tsMs: number = typeof payload.time === "number" ? payload.time : Date.now();
  const timestamp = new Date(tsMs).toISOString();
  const updates: TagSnapshot[] = [];
  for (const item of payload.data ?? []) {
    if (item?.tag === undefined) continue;
    const snap: TagSnapshot = { device, tag: String(item.tag), value: String(item.value), timestamp };
    cache.set(`${device}::${snap.tag}`, snap);
    updates.push(snap);
  }
  if (updates.length > 0) broadcast({ type: "update", tags: updates });
  return updates.length;
}

// HTTP ingest endpoint — adapters POST payloads here when MONITOR_INGEST_HTTP=1.
router.post("/ingest", (req: Request, res: Response) => {
  try {
    const n = ingestPayload(req.body);
    setConsumerStatus("connected");
    res.json({ ok: true, ingested: n });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

router.get("/snapshot", (_req, res) => {
  res.json({ success: true, tags: [...cache.values()] });
});

router.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send the cached snapshot immediately.
  res.write(`data: ${JSON.stringify({ type: "snapshot", tags: [...cache.values()] })}\n\n`);

  // Tell this client the current broker state so it doesn't have to wait for a
  // broadcast — critical when the consumer is already running or already failed.
  if (consumerStatus === "connected") {
    res.write(`data: ${JSON.stringify({ type: "broker_connected" })}\n\n`);
  } else if (consumerStatus === "error") {
    res.write(`data: ${JSON.stringify({ type: "error", message: consumerErrorMsg })}\n\n`);
  }

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));

  if (INGEST_HTTP) {
    // No broker to connect to — data arrives via POST /ingest. Report connected
    // so the UI shows a healthy monitor.
    if (consumerStatus !== "connected") {
      setConsumerStatus("connected");
      res.write(`data: ${JSON.stringify({ type: "broker_connected" })}\n\n`);
    }
    return;
  }

  // Always call startConsumer — it is idempotent when nothing has changed, and
  // will restart automatically if the CSV device list differs from what is
  // currently subscribed.
  startConsumer().catch(console.error);
});

export default router;
