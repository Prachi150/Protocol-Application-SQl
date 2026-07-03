import express from "express";
import mqtt from "mqtt";
import fs from "fs";
import path from "path";

const router = express.Router();

// Cached asset_id from lsg-app orchestrator (valid for the lifetime of the server process)
let cachedAssetId: string | null = null;

function getMqttBrokerUrl(): string {
  const host = process.env.MASTER_MQTT_HOST ?? "localhost";
  const port = process.env.MASTER_MQTT_PORT ?? "1883";
  const protocol = process.env.MASTER_MQTT_TLS === "true" ? "mqtts" : "mqtt";
  return `${protocol}://${host}:${port}`;
}

function getMqttConnectOptions(): mqtt.IClientOptions {
  const opts: mqtt.IClientOptions = {
    clientId: `ioconnect-configurator-${crypto.randomUUID()}`,
    clean: true,
  };
  if (process.env.MASTER_MQTT_USERNAME) {
    opts.username = process.env.MASTER_MQTT_USERNAME;
    opts.password = process.env.MASTER_MQTT_PASSWORD ?? "";
  }
  return opts;
}

function loadSchemaColumns(): Array<{ key: string; includeInOnboard?: boolean }> {
  try {
    const profile = process.env.CONFIG_PROFILE ?? "opcua";
    const schemaPath = path.resolve(__dirname, `../../../configs/${profile}/schema.json`);
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    return schema.csv?.columns ?? [];
  } catch {
    return [];
  }
}

async function fetchAssetId(): Promise<string> {
  const lsgAppUrl = process.env.LSG_APP_URL ?? "http://localhost:3001";
  const res = await fetch(`${lsgAppUrl}/api/internal/asset-id`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`lsg-app returned HTTP ${res.status}`);
  const data = await res.json() as { asset_id?: string };
  if (!data.asset_id) throw new Error("asset_id missing from lsg-app response");
  return data.asset_id;
}

interface UnsNode {
  uns_id: string;
  uns_path: string;
}

function fetchUnsNodes(assetId: string): Promise<UnsNode[]> {
  return new Promise((resolve, reject) => {
    const timeoutMs = parseInt(process.env.ONBOARD_TIMEOUT_MS ?? "10000", 10);
    const requestTopic = `lsg/${assetId}/req/get-uns-ids`;
    const responseTopic = `lsg/${assetId}/req/get-uns-ids/res`;

    const client = mqtt.connect(getMqttBrokerUrl(), getMqttConnectOptions());
    let settled = false;

    const finish = (err?: Error, result?: UnsNode[]) => {
      if (settled) return;
      settled = true;
      client.end(true);
      if (err) reject(err);
      else resolve(result!);
    };

    const timer = setTimeout(() => finish(new Error("Timeout fetching UNS node list")), timeoutMs);

    client.on("connect", () => {
      client.subscribe(responseTopic, (err) => {
        if (err) { clearTimeout(timer); finish(err); return; }
        const correlationId = `${Date.now()}-${crypto.randomUUID().split("-")[0].substring(0, 6)}`;
        client.publish(requestTopic, JSON.stringify({ correlationId }), { qos: 1 });
      });
    });

    client.on("message", (_topic, message) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(message.toString()) as {
          correlationId?: string;
          success?: boolean;
          data?: { "uns-ids"?: UnsNode[] };
        };
        if (!data.success) {
          finish(new Error("get-uns-ids returned success=false"));
          return;
        }
        finish(undefined, data.data?.["uns-ids"] ?? []);
      } catch {
        finish(new Error("Invalid response format for UNS nodes"));
      }
    });

    client.on("error", (err) => { clearTimeout(timer); finish(err); });
  });
}

interface OnboardAssignment {
  device_id: string;
  sensor_id: string;
  [key: string]: string;
}

function doOnboardBatch(
  assetId: string,
  unsId: string,
  nodes: Record<string, string>[]
): Promise<OnboardAssignment[]> {
  return new Promise((resolve, reject) => {
    const timeoutMs = parseInt(process.env.ONBOARD_TIMEOUT_MS ?? "10000", 10);
    const protocolAppId = process.env.PROTOCOL_APP_NAME ?? "ioconnect-opcua";
    const requestTopic = `uns/${unsId}/${assetId}/${protocolAppId}/`;
    const responseTopic = `uns/${unsId}/${assetId}/${protocolAppId}/res`;

    const client = mqtt.connect(getMqttBrokerUrl(), getMqttConnectOptions());
    let settled = false;

    const finish = (err?: Error, result?: OnboardAssignment[]) => {
      if (settled) return;
      settled = true;
      client.end(true);
      if (err) reject(err);
      else resolve(result!);
    };

    const timer = setTimeout(() => finish(new Error("Timeout waiting for onboard response")), timeoutMs);

    client.on("connect", () => {
      client.subscribe(responseTopic, (err) => {
        if (err) { clearTimeout(timer); finish(err); return; }
        client.publish(requestTopic, JSON.stringify({ nodes }), { qos: 1 });
      });
    });

    client.on("message", (_topic, message) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(message.toString()) as { nodes?: OnboardAssignment[] };
        finish(undefined, data.nodes ?? []);
      } catch {
        finish(new Error("Invalid response format from onboard service"));
      }
    });

    client.on("error", (err) => { clearTimeout(timer); finish(err); });
  });
}

// GET /api/onboard/preflight
// Fetches asset_id from lsg-app and uns_nodes from MQTT broker.
router.get("/preflight", async (_req, res) => {
  try {
    cachedAssetId = await fetchAssetId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({
      success: false,
      message: `Failed to fetch asset ID from orchestrator: ${msg}`,
    });
  }

  let unsNodes: UnsNode[];
  try {
    unsNodes = await fetchUnsNodes(cachedAssetId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(503).json({
      success: false,
      message: `Failed to fetch UNS nodes: ${msg}`,
    });
  }

  res.json({ success: true, asset_id: cachedAssetId, uns_nodes: unsNodes });
});

// POST /api/onboard/batch
// Body: { rows: CSVRow[], uns_id: string }
// Publishes rows to MQTT and waits for device_id/sensor_id assignments.
router.post("/batch", async (req, res) => {
  if (!cachedAssetId) {
    return res.status(400).json({
      success: false,
      message: "Run preflight first to fetch asset ID",
    });
  }

  const { rows, uns_id } = req.body as { rows: Record<string, string>[]; uns_id: string };
  if (!Array.isArray(rows) || !uns_id) {
    return res.status(400).json({ success: false, message: "rows and uns_id are required" });
  }

  const columns = loadSchemaColumns();
  const payloadColumns = columns.filter((c) => c.includeInOnboard);

  const nodes = rows.map((row) =>
    Object.fromEntries(payloadColumns.map((c) => [c.key, row[c.key] ?? ""]))
  );

  let assignments: OnboardAssignment[];
  try {
    assignments = await doOnboardBatch(cachedAssetId, uns_id, nodes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(504).json({ success: false, message: msg });
  }

  res.json({ success: true, assignments });
});

export default router;
