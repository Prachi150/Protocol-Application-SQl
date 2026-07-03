# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

OPC UA Configurator is a full-stack web application for configuring OPC UA polling parameters and monitoring real-time industrial IoT sensor data. It has two main purposes:

1. **Configuration** — Edit `sys_parameters.json` (OPC server + posting protocol config) and `config.csv` (sensor tag database) through a browser UI
2. **Monitoring** — View live tag values streamed from Kafka/Redpanda via SSE

## Commands

### Development (run both in parallel)

```bash
# Frontend (port 8080, proxies /api to port 3001)
npm run dev

# Backend (port 3001)
cd server && npm run dev
```

### Build

```bash
npm run build          # production build → dist/
npm run build:dev      # development build

cd server && npm run build   # compile TypeScript → server/dist/
```

### Lint & Test

```bash
npm run lint           # ESLint (frontend)
npm test               # Vitest (run once)
npm run test:watch     # Vitest (watch mode)
```

## Architecture

### Frontend → Backend communication

Vite dev server proxies all `/api` requests to `localhost:3001`. In production, the static build is served separately with a real reverse proxy. The base deployment path is configurable via `VITE_BASE_PATH` (default `/apps/lsg-opcua/`).

API client lives in `src/lib/api.ts` — three namespaces: `filesApi`, `serviceApi`, `monitorApi`.

### Backend routes (`server/src/routes/`)

| Route | Purpose |
|---|---|
| `/api/files/*` | Read/write `sys_parameters.json` and `config.csv` from `FILES_BASE_DIR` |
| `/api/service/{start\|stop\|restart\|status}` | Execute shell scripts in `SCRIPTS_DIR` via `child_process.exec` |
| `/api/monitor/snapshot` + `/api/monitor/stream` | Kafka consumer; snapshot endpoint + SSE stream of tag updates |

`safePath()` in `files.ts` prevents directory traversal. The Kafka consumer in `monitor.ts` reads `sys_parameters.json` to discover topics, then subscribes to `devicesIn.{device_id}.data`.

### Key data structures (`src/lib/sys-parameters-schema.ts`)

- **`SysParameters`** — top-level config with `polling[]` (OPC UA servers + retry/timeout) and `posting[]` (MQTT / HTTP / Redpanda destination configs)
- **`CSVRow`** — 10-column sensor tag definition: `device, address, tag, datatype, byteorder, resolution, server, lograte, isarray, arrayindex`
- **`TagSnapshot`** — real-time value from Kafka: `device, tag, value, timestamp`

### Main UI components

- **`JSONEditor`** — React Hook Form + Zod form for `sys_parameters.json`. Handles nested protocol auth (none / username / certificates) and SASL security options.
- **`CSVEditor`** — Spreadsheet-like table for the tag database. Supports drag-fill across cell ranges. Unsaved edits persist in `localStorage` (`src/lib/csv-storage.ts`) until explicitly saved.
- **`MonitorView`** — EventSource client connecting to `/api/monitor/stream`. Displays filterable live tag table with connection status indicator.
- **Header service buttons** — Poll `/api/service/status` every 5 seconds; Start/Stop/Restart call shell scripts.

### State management

React Query (`@tanstack/react-query`) handles all server state. Local CSV edits use `localStorage` as a staging buffer before write-back. No global state store.

## Environment variables

### Server (`server/.env`)

```
PORT=3001
SERVICE_NAME=my-opcua-service
FILES_BASE_DIR=./data
SCRIPTS_DIR=./scripts
```

### Frontend (`.env`)

```
VITE_BASE_PATH=/apps/lsg-opcua/
VITE_API_BASE=/api
```
