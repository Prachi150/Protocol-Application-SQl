import { Router, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";

const router = Router();

function getBaseDir(): string {
  const base = process.env.FILES_BASE_DIR || "./data";
  return path.resolve(base);
}

function safePath(filePath: string): string | null {
  const baseDir = getBaseDir();
  const resolved = path.resolve(baseDir, filePath);
  if (!resolved.startsWith(baseDir)) {
    return null;
  }
  return resolved;
}

// List files by type (csv or json)
router.get("/list", async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const baseDir = getBaseDir();

    try {
      await fs.access(baseDir);
    } catch {
      await fs.mkdir(baseDir, { recursive: true });
    }

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    let files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name);

    if (type === "csv") {
      files = files.filter((f) => f.endsWith(".csv"));
    } else if (type === "json") {
      files = files.filter((f) => f.endsWith(".json"));
    }

    res.json({ success: true, files });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Read a file
router.get("/read", async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ success: false, message: "Missing path parameter" });
      return;
    }

    const resolved = safePath(filePath);
    if (!resolved) {
      res.status(403).json({ success: false, message: "Access denied: path outside base directory" });
      return;
    }

    const content = await fs.readFile(resolved, "utf-8");
    res.json({ success: true, content, filename: path.basename(resolved) });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      res.status(404).json({ success: false, message: "File not found" });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// Write to a file
router.post("/write", async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      res.status(400).json({ success: false, message: "Missing path or content" });
      return;
    }

    const resolved = safePath(filePath);
    if (!resolved) {
      res.status(403).json({ success: false, message: "Access denied: path outside base directory" });
      return;
    }

    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");

    res.json({ success: true, message: `File saved: ${path.basename(resolved)}` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Save as (same as write but semantically for new files)
router.post("/save-as", async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      res.status(400).json({ success: false, message: "Missing path or content" });
      return;
    }

    const resolved = safePath(filePath);
    if (!resolved) {
      res.status(403).json({ success: false, message: "Access denied: path outside base directory" });
      return;
    }

    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");

    res.json({ success: true, message: `File saved as: ${path.basename(resolved)}` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Default read endpoint based on .env
router.get("/read-default", async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string;
    if (!type || (type !== "json" && type !== "csv")) {
      res.status(400).json({ success: false, message: "Invalid or missing type parameter" });
      return;
    }

    const defaultFilename = type === "json" 
      ? (process.env.JSON_FILENAME || "sys_parameters.json")
      : (process.env.CSV_FILENAME || "config.csv");
    
    const resolved = safePath(defaultFilename);
    if (!resolved) {
      res.status(403).json({ success: false, message: "Access denied" });
      return;
    }

    const content = await fs.readFile(resolved, "utf-8");
    res.json({ success: true, content, filename: path.basename(resolved) });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      res.status(404).json({ success: false, message: "File not found" });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// Default write endpoint based on .env
router.post("/write-default", async (req: Request, res: Response) => {
  try {
    const { type, content } = req.body;
    if (!type || (type !== "json" && type !== "csv") || content === undefined) {
      res.status(400).json({ success: false, message: "Invalid type or missing content" });
      return;
    }

    const defaultFilename = type === "json" 
      ? (process.env.JSON_FILENAME || "sys_parameters.json")
      : (process.env.CSV_FILENAME || "config.csv");

    const resolved = safePath(defaultFilename);
    if (!resolved) {
      res.status(403).json({ success: false, message: "Access denied" });
      return;
    }

    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");

    res.json({ success: true, message: `File saved: ${path.basename(resolved)}` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
