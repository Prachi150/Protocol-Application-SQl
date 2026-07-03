# OPC UA Configurator - Codebase Guide

This document provides a comprehensive overview of the OPC UA Configurator codebase, its architecture, components, interactions, and testing procedures. It is designed for both human developers and AI agents.

## 1. Project Overview
The OPC UA Configurator is a full-stack application designed to manage OPC UA polling configurations and monitor real-time industrial IoT data.
- **Configuration**: Edit `sys_parameters.json` and `config.csv` via a browser-based UI.
- **Monitoring**: Real-time visualization of tag values streamed from Kafka/Redpanda via Server-Sent Events (SSE).
- **Service Control**: Start, stop, and restart the underlying data collection service via shell scripts.
~
## 2. Architecture

### Frontend (React + Vite)
- **Framework**: React 18 with TypeScript.
- **Styling**: Tailwind CSS + Shadcn UI.
- **State Management**: React Query (`@tanstack/react-query`) for server state; `useState` and `localStorage` for local/unsaved state.
- **Routing**: `react-router-dom`.
- **UI Paradigm**: Metadata-driven. The UI for the JSON editor and CSV editor is generated based on a `ProtocolSchema` (loaded from `configs/{profile}/schema.json`).

### Backend (Node.js + Express)
- **Framework**: Express.js.
- **Language**: TypeScript (using `tsx` for development).
- **Functionality**:
    - **File CRUD**: Manages configuration files in a specific directory.
    - **Service Management**: Executes shell scripts to control an external process.
    - **Kafka Consumer**: Subscribes to topics based on the configuration and streams updates to the frontend via SSE.

### Communication
- **REST API**: Standard CRUD operations for files and service control.
- **SSE (Server-Sent Events)**: Unidirectional real-time stream for monitoring tag updates.
- **Proxy**: In development, Vite proxies `/api` requests to the backend (port 3001).

## 3. Core Components (Frontend)

### Metadata-Driven UI (`src/lib/schema-types.ts`, `src/lib/schema.ts`)
The UI is not hardcoded for specific OPC UA fields. Instead, it uses a schema to define sections, fields, widgets, and validation rules.
- `__PROTOCOL_SCHEMA__`: Injected via Vite's `define` at build/dev time.
- `ProtocolSchema`: Defines the layout for both the JSON editor and the CSV editor.

### JSON Editor (`src/components/JSONEditor.tsx`)
- Uses `react-hook-form` and `zod` for validation.
- Dynamically renders form sections based on the schema.
- Handles complex nested structures like authentication protocols (SASL, Username/Password, Certificates).

### CSV Editor & Headers (`src/lib/csv-headers.ts`)
- **Transition**: The project is transitioning from legacy hardcoded headers (`VALID_CSV_HEADERS`) to schema-driven headers defined in `ProtocolSchema.csv`.
- **Validation**: `validateHeadersWithSchema()` compares actual CSV headers against the schema.
- **Serialization**: `toCSVWithSchema()` ensures rows are serialized in the order defined by the schema columns.

### Monitor View (`src/components/MonitorView.tsx`)
- Connects to `/api/monitor/stream` using `EventSource`.
- Displays a filterable table of live tag values.
- Tracks connection status and "last updated" timestamps.

## 4. Core Components (Backend)

### Files Router (`server/src/routes/files.ts`)
- `GET /api/files/list`: Lists files by type (CSV/JSON).
- `GET /api/files/read-default`: Reads `sys_parameters.json` or `config.csv`.
- `POST /api/files/write-default`: Saves configuration changes.
- **Security**: `safePath()` prevents directory traversal by ensuring paths remain within `FILES_BASE_DIR`.

### Service Router (`server/src/routes/service.ts`)
- Executes scripts in `SCRIPTS_DIR`: `start.sh`, `stop.sh`, `restart.sh`, `status.sh`.
- Returns stdout/stderr and exit codes to the frontend.

### Monitor Router (`server/src/routes/monitor.ts`)
- Initializes a Kafka consumer using `kafkajs`.
- Discovers topics by reading `sys_parameters.json` and `config.csv`.
- Broadcasters updates to all connected SSE clients.

## 5. Data Models & Schemas

### `SysParameters` (`src/lib/sys-parameters-schema.ts`)
The root configuration object for the application.
- `polling[]`: Array of OPC UA server configurations.
- `posting[]`: Array of destination configurations (MQTT, Redpanda, HTTP).

### `ProtocolSchema` (`src/lib/schema-types.ts`)
Defines how the UI should look.
- `polling`: Sections and fields for the JSON editor.
- `posting`: Different types of posting protocols and their specific fields.
- `csv`: Column definitions for the tag database.

### Configuration Files
- **`sys_parameters.json`**: Main configuration for polling and posting.
- **`config.csv`**: Sensor tag database.
- **Note**: These files are stored in `FILES_BASE_DIR` (defaults to `configs/opcua/`). If they don't exist, the UI will start with empty defaults and create them upon the first successful "Save" operation.

## 6. Directory Structure

```text
/
├── configs/                # Configuration profiles and UI metadata
│   └── opcua/              # Default profile for OPC UA
│       └── schema.json     # Metadata-driven UI definition
├── docs/                   # Documentation and design assets
│   └── mockups/            # Static HTML prototypes of the UI
├── public/                 # Static assets served by Vite (favicon, robots.txt)
├── server/                 # Backend Node.js/Express application
│   ├── scripts/            # Shell scripts for service control (start/stop/status)
│   ├── src/                # Backend source code
│   │   ├── routes/         # Express API route handlers (files, monitor, service)
│   │   └── index.ts        # Backend entry point and middleware setup
│   ├── package.json        # Backend dependencies and scripts
│   └── tsconfig.json       # Backend TypeScript configuration
├── src/                    # Frontend React application
│   ├── components/         # React components
│   │   ├── ui/             # Reusable Shadcn UI primitives
│   │   ├── CSVEditor.tsx   # Spreadsheet-like tag editor
│   │   ├── JSONEditor.tsx  # Dynamic form for sys_parameters.json
│   │   └── MonitorView.tsx # Real-time Kafka data visualizer
│   ├── hooks/              # Custom React hooks (drag-fill, mobile detection)
│   ├── lib/                # Shared logic and utilities
│   │   ├── api.ts          # Axios/Fetch wrappers for backend endpoints
│   │   ├── csv-headers.ts  # CSV parsing, serialization, and validation
│   │   ├── schema-types.ts # TypeScript interfaces for the Protocol Schema
│   │   └── schema.ts       # Global schema instance injected by Vite
│   ├── pages/              # Top-level page components (Index, NotFound)
│   ├── test/               # Vitest test suites and setup
│   ├── App.tsx             # Main application router and providers
│   └── main.tsx            # Frontend entry point
├── .env.example            # Template for frontend environment variables
├── CLAUDE.md               # Project guide for AI assistants (Claude)
├── CODEBASE_GUIDE.md       # Comprehensive system documentation (this file)
├── components.json         # Shadcn UI component configuration
├── eslint.config.js        # ESLint linting rules
├── index.html              # Vite entry HTML template
├── package.json            # Frontend dependencies and build scripts
├── postcss.config.js       # PostCSS configuration for Tailwind
├── tailwind.config.ts      # Tailwind CSS theme and plugin setup
├── tsconfig.json           # Root TypeScript configuration
└── vite.config.ts          # Vite build tool and dev server configuration
```
## 7. Development & Testing

### Local Setup Guide

Follow these steps to set up the project locally for development.

#### Step 1: Clone and Install Dependencies
```bash
git clone <repository-url>
cd opc-ua-configurator
npm install
cd server
npm install
cd ..
```

#### Step 2: Configure Frontend Environment Variables
Create a `.env` file in the root directory. You can copy the contents from `.env.example`.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_BASE_PATH` | The public base path for the application. Used for deployment under sub-paths. | `/apps/lsg-opcua/` |
| `VITE_CONFIG_PROFILE` | The configuration profile folder name under `configs/` to use for schema and defaults. | `opcua` |
| `VITE_API_BASE` | The API prefix used by the frontend to communicate with the backend. | `/api` |
| `VITE_API_TARGET` | The backend URL. Only used by the Vite proxy during development. | `http://localhost:3001` |
| `VITE_APP_NAME` | The application name displayed in the header and the browser tab. | `OPC UA Configurator` |
| `VITE_CSV_TAB_LABEL` | The label for the CSV/Tag management tab. | `Tags` |
| `VITE_MONITOR_TAB_LABEL` | The label for the real-time monitoring tab. | `Live Values` |
| `VITE_STORAGE_KEY_PREFIX` | Prefix for `localStorage` keys to prevent collisions between app instances. | `lsg-opcua` |

#### Step 3: Configure Backend Environment Variables
Create a `server/.env` file. You can copy the contents from `server/.env.example`.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the backend server will listen on. | `3001` |
| `SERVICE_NAME` | The name of the systemd service controlled by the dashboard. | `my-opcua-service` |
| `FILES_BASE_DIR` | Absolute or relative path to the directory where JSON/CSV files are stored. | `./data` |
| `SCRIPTS_DIR` | Directory containing the `start.sh`, `stop.sh`, etc., scripts. | `./scripts` |
| `KAFKA_CLIENT_ID` | Identifier for the Kafka client used in monitoring. | `lsg-opcua-configurator` |
| `KAFKA_GROUP_ID` | Consumer group ID for the monitoring Kafka consumer. | `lsg-opcua-monitor` |

#### Step 4: Running the Application
Open two terminal windows/tabs:

**Terminal 1 (Backend):**
```bash
cd server
npm run dev
```

**Terminal 2 (Frontend):**
```bash
npm run dev
```
The application will be available at `http://localhost:8080/apps/lsg-opcua/` (depending on your `VITE_BASE_PATH`).

### Testing
- **Frontend**: `npm test` runs Vitest suites in `src/test/`.
- **Manual Testing**:
    - **Configuration**: Edit values in the JSON/CSV tabs and click "Save". Verify files in `FILES_BASE_DIR` are updated.
    - **Service Control**: Click Start/Stop/Restart in the header. Check backend logs for script execution.
    - **Monitoring**: Requires a running Kafka/Redpanda instance. Ensure `sys_parameters.json` has correct broker info.

## 8. Internal Interactions
### Saving a Configuration
1. User clicks "Save" in `JSONEditor` or `CSVEditor`.
2. Frontend calls `filesApi.writeDefault()`.
3. Backend `files.ts` validates the path and writes to the filesystem.
4. Frontend shows a success toast.

### Real-time Monitoring
1. `MonitorView` mounts and opens an `EventSource` to `/api/monitor/stream`.
2. Backend `monitor.ts` starts a Kafka consumer if not already running.
3. Consumer reads `sys_parameters.json` and `config.csv` to find brokers and topics.
4. When a Kafka message arrives, it is parsed and broadcasted to all SSE clients.
5. `MonitorView` updates its internal state and re-renders the table.

## 9. AI Agent Instructions

- **Modifying the UI**: If you need to add a new field to the configuration, modify `configs/{profile}/schema.json` first. The UI should pick it up automatically.
- **Extending APIs**: Backend routes are modular. Add new routes in `server/src/routes/` and register them in `server/src/index.ts`. Update `src/lib/api.ts` accordingly.
- **Path Handling**: Always use `safePath()` in backend routes when dealing with file paths to maintain security.
- **State Management**: Use React Query for any data that comes from the server. Use `localStorage` for staging large datasets like CSV edits.
- **Kafka**: The backend uses `kafkajs-lz4` for LZ4 compression. Ensure this is registered before creating the consumer.
