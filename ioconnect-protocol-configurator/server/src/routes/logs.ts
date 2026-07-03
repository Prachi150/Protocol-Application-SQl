import { Router, Request, Response } from "express";
import { spawn } from "child_process";

const router = Router();

function useFile(): boolean {
  return process.env.LOG_SOURCE === "file" && !!process.env.LOG_FILE_PATH;
}

function serviceName(): string {
  return process.env.SERVICE_NAME ?? "protocol-opcua";
}

// GET /api/logs?lines=200
router.get("/", (req: Request, res: Response) => {
  const lines = Math.min(parseInt(String(req.query.lines ?? "200"), 10), 2000);

  let proc: ReturnType<typeof spawn>;
  if (useFile()) {
    proc = spawn("tail", ["-n", String(lines), process.env.LOG_FILE_PATH!]);
  } else {
    proc = spawn("journalctl", [
      "-u", serviceName(),
      "-n", String(lines),
      "--output=cat",
      "--no-pager",
      "--no-hostname",
    ]);
  }

  const chunks: string[] = [];
  const errChunks: string[] = [];

  proc.stdout!.setEncoding("utf-8");
  proc.stdout!.on("data", (chunk: string) => chunks.push(chunk));

  proc.stderr!.setEncoding("utf-8");
  proc.stderr!.on("data", (chunk: string) => errChunks.push(chunk));

  proc.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: `Failed to spawn log reader: ${err.message}` });
    }
  });

  proc.on("close", (code) => {
    if (res.headersSent) return;
    if (code !== 0 && chunks.length === 0) {
      const stderr = errChunks.join("").trim();
      const detail = stderr || `exit code ${code}`;
      return res.status(500).json({
        success: false,
        message: `journalctl failed: ${detail}`,
      });
    }
    const filtered = chunks
      .join("")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"));

    res.json({ success: true, lines: filtered, source: useFile() ? "file" : "journalctl" });
  });
});

// GET /api/logs/stream — SSE live tail
router.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let proc: ReturnType<typeof spawn>;
  if (useFile()) {
    proc = spawn("tail", ["-f", "-n", "0", process.env.LOG_FILE_PATH!]);
  } else {
    proc = spawn("journalctl", [
      "-u", serviceName(),
      "-f",
      "-n", "0",
      "--output=cat",
      "--no-pager",
      "--no-hostname",
    ]);
  }

  proc.on("error", (err) => {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });

  let buf = "";
  proc.stdout!.setEncoding("utf-8");
  proc.stdout!.on("data", (chunk: string) => {
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const t = line.trim();
      if (t.startsWith("{")) {
        res.write(`data: ${JSON.stringify({ line: t })}\n\n`);
      }
    }
  });

  req.on("close", () => proc.kill());
});

export default router;
