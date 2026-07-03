import { Router, Request, Response } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);
const router = Router();

function getScriptPath(action: string): string {
  const scriptsDir = process.env.SCRIPTS_DIR;
  if (!scriptsDir) {
    throw new Error("SCRIPTS_DIR is not configured in .env");
  }
  return path.resolve(process.cwd(), scriptsDir, `${action}.sh`);
}

async function runScript(action: string): Promise<{ success: boolean; status: number; message: string }> {
  try {
    const scriptPath = getScriptPath(action);
    const { stdout, stderr } = await execAsync(`bash "${scriptPath}"`);
    const output = (stdout || stderr || "").trim();
    return {
      success: true,
      status: 0,
      message: output || `Script ${scriptPath} executed successfully`,
    };
  } catch (err: any) {
    const errorOutput = (err.stderr || err.stdout || err.message || "").trim();
    const statusCode = typeof err.code === "number" ? err.code : 1;
    return {
      success: false,
      status: statusCode,
      message: `Failed to execute ${action} script: ${errorOutput}`,
    };
  }
}

router.post("/start", async (_req: Request, res: Response) => {
  try {
    const result = await runScript("start");
    res.status(result.success ? 200 : 500).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, status: 1, message: err.message });
  }
});

router.post("/stop", async (_req: Request, res: Response) => {
  try {
    const result = await runScript("stop");
    res.status(result.success ? 200 : 500).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, status: 1, message: err.message });
  }
});

router.post("/restart", async (_req: Request, res: Response) => {
  try {
    const result = await runScript("restart");
    res.status(result.success ? 200 : 500).json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, status: 1, message: err.message });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const result = await runScript("status");
    // systemctl is-active exits non-zero when inactive (code 3) — that is a
    // valid status, not a failure to check. Extract the actual output text
    // from either the success message or the wrapped error message.
    const statusText = result.success
      ? result.message
      : result.message.replace(/^Failed to execute \w+ script:\s*/i, "").trim() || "inactive";
    res.json({ success: true, code: result.status, status: statusText, message: result.message });
  } catch (err: any) {
    res.json({ success: false, code: 1, status: "unknown", message: err.message });
  }
});

router.get("/default-broker", (_req: Request, res: Response) => {
  res.json({
    success: true,
    broker: {
      bootstrap_servers: process.env.KAFKA_BOOTSTRAP_SERVERS || "localhost:9092",
      security_protocol: process.env.KAFKA_SECURITY_PROTOCOL || "PLAINTEXT",
      sasl_mechanism: process.env.KAFKA_SASL_MECHANISM || "PLAIN",
      sasl_username: process.env.KAFKA_SASL_USERNAME || "",
      sasl_password: process.env.KAFKA_SASL_PASSWORD || "",
      client_id: process.env.KAFKA_CLIENT_ID || "lsg-opcua-configurator"
    }
  });
});

export default router;
