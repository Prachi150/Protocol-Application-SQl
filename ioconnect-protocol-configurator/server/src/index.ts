import dotenv from "dotenv";
dotenv.config();

import path from "path";
import express from "express";
import cors from "cors";
import filesRouter from "./routes/files";
import serviceRouter from "./routes/service";
import monitorRouter from "./routes/monitor";
import logsRouter from "./routes/logs";
import onboardRouter from "./routes/onboard";

const profile = process.env.CONFIG_PROFILE ?? "opcua";
if (!process.env.FILES_BASE_DIR) {
  process.env.FILES_BASE_DIR = path.resolve(__dirname, `../../configs/${profile}`);
}
console.log(`Config profile: ${profile} | Files dir: ${process.env.FILES_BASE_DIR}`);

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/files", filesRouter);
app.use("/api/service", serviceRouter);
app.use("/api/monitor", monitorRouter);
app.use("/api/logs", logsRouter);
app.use("/api/onboard", onboardRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Single-port deployment ──
// Serve the built frontend (../../dist) from this same server so the whole
// configurator runs on ONE port. API routes above take precedence; everything
// else falls back to index.html for client-side routing.
const clientDist = path.resolve(__dirname, "../../dist");
app.use(express.static(clientDist));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (serving UI + API)`);
});
