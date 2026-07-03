import { APP_BASE } from './path';

const API_BASE = APP_BASE + '/api';

// Thrown when the backend responds but returns an error — backend IS reachable.
// Plain Error (network/parse failure) means the backend could not be reached.
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data: { success?: boolean; message?: string } & Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status}). The API may be unreachable.`);
  }
  if (!res.ok || !data.success) {
    throw new ApiError(data.message || `Request failed with status ${res.status}`);
  }
  return data as T;
}

// File operations
export const filesApi = {
  list: (type?: "csv" | "json") =>
    request<{ success: boolean; files: string[] }>(
      `/files/list${type ? `?type=${type}` : ""}`
    ),

  read: (path: string) =>
    request<{ success: boolean; content: string; filename: string }>(
      `/files/read?path=${encodeURIComponent(path)}`
    ),

  write: (path: string, content: string) =>
    request<{ success: boolean; message: string }>("/files/write", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    }),

  saveAs: (path: string, content: string) =>
    request<{ success: boolean; message: string }>("/files/save-as", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    }),
  readDefault: (type: "csv" | "json") =>
    request<{ success: boolean; content: string; filename: string }>(
      `/files/read-default?type=${type}`
    ),

  writeDefault: (type: "csv" | "json", content: string) =>
    request<{ success: boolean; message: string }>("/files/write-default", {
      method: "POST",
      body: JSON.stringify({ type, content }),
    }),
};

// Monitor
export interface TagSnapshot {
  device: string;
  tag: string;
  value: string;
  timestamp: string;
}

export const monitorApi = {
  snapshot: () =>
    request<{ success: boolean; tags: TagSnapshot[] }>("/monitor/snapshot"),
};

export const getMonitorStreamUrl = () => `${API_BASE}/monitor/stream`;

export const logsApi = {
  fetch: (lines = 200) =>
    request<{ success: boolean; lines: string[]; source: string }>(
      `/logs?lines=${lines}`
    ),
};

export const getLogsStreamUrl = () => `${API_BASE}/logs/stream`;

// Auto Onboard
export interface UnsNode {
  uns_id: string;
  uns_path: string;
}

export interface OnboardAssignment {
  device_id: string;
  sensor_id: string;
  [key: string]: string;
}

export const onboardApi = {
  preflight: () =>
    request<{ success: boolean; asset_id: string; uns_nodes: UnsNode[] }>("/onboard/preflight"),

  batch: (rows: Record<string, string>[], uns_id: string) =>
    request<{ success: boolean; assignments: OnboardAssignment[] }>("/onboard/batch", {
      method: "POST",
      body: JSON.stringify({ rows, uns_id }),
    }),
};

// Service control
export const serviceApi = {
  start: () =>
    request<{ success: boolean; message: string }>("/service/start", {
      method: "POST",
    }),

  stop: () =>
    request<{ success: boolean; message: string }>("/service/stop", {
      method: "POST",
    }),

  restart: () =>
    request<{ success: boolean; message: string }>("/service/restart", {
      method: "POST",
    }),

  status: () =>
    request<{ success: boolean; status: string; message: string }>("/service/status"),

  getDefaultBroker: () => 
    request<{ success: boolean; broker: Record<string, string> }>("/service/default-broker"),
};
