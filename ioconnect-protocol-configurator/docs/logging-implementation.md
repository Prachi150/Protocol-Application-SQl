# Structured Logging — Implementation Reference

## Overview

Every log line is a single JSON object written to **stdout**. The application does not write to log files directly — it relies on the host (systemd journal, Docker, Kubernetes) to capture stdout and ship it to whatever log aggregator you use (Loki, ELK, CloudWatch, etc.).

---

## Log Schema

| Field | Type | Always Present | Description |
|---|---|---|---|
| `time` | string | Yes | ISO-8601 UTC with millisecond precision, e.g. `2026-05-07T10:23:41.123+00:00` |
| `level` | string | Yes | `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` |
| `service` | string | Yes | Service name — defaults to `protocol-opcua`, override with `SERVICE_NAME` env var |
| `file` | string | Yes | Source file, e.g. `opc.py` |
| `function` | string | Yes | Function name, e.g. `connect` |
| `thread` | string | Yes | Thread name — critical for tracing across poll and background threads |
| `message` | string | Yes | Human-readable summary of the event |
| `exception` | string | On errors | Full Python traceback, only present when `exc_info=True` |
| *(context fields)* | various | Contextual | See per-module details below |

### Example log lines

Startup:
```json
{"time":"2026-05-07T10:23:41.001+00:00","level":"INFO","service":"protocol-opcua","file":"app.py","function":"main","thread":"MainThread","message":"System parameters loaded","path":"/opt/app/sys_parameters.json"}
```

Successful poll:
```json
{"time":"2026-05-07T10:23:41.512+00:00","level":"INFO","service":"protocol-opcua","file":"app.py","function":"poll","thread":"Thread-1","message":"Poll read completed","server":"opc.tcp://192.168.1.10:4840","device_id":"PUMP_01","rate_ms":1000,"elapsed_ms":12.45}
```

Connection failure with traceback:
```json
{"time":"2026-05-07T10:23:41.900+00:00","level":"ERROR","service":"protocol-opcua","file":"opc.py","function":"connect","thread":"MainThread","message":"All connection attempts exhausted","host":"opc.tcp://192.168.1.10:4840","attempts":3}
```

---

## Log Levels

| Level | When to use |
|---|---|
| `DEBUG` | High-frequency per-operation detail (per-tag data received, per-post queue drain). Off by default. |
| `INFO` | Lifecycle events: startup, connected, poll cycle start/end, data posted successfully. |
| `WARNING` | Degraded but non-fatal: tag errors, reconnect attempts, stale subscription data, backup DB used. |
| `ERROR` | Failures with attempted recovery: poll failed, post failed, disconnect on error, subscription issues. Always includes `exception` traceback. |
| `CRITICAL` | Fatal startup failures that cause the process to exit: no broker config, package missing. |

---

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `INFO` | Set to `DEBUG` for verbose per-tag logs, `WARNING` to silence INFO in production |
| `SERVICE_NAME` | `protocol-opcua` | Appears in every log line's `service` field — useful if you run multiple instances |

---

## How to add logs in new code

```python
from logger import get_logger

logger = get_logger(__name__)   # one per module, at module level

# Basic levels
logger.debug("High-frequency operational detail")
logger.info("Lifecycle event happened")
logger.warning("Something degraded but recoverable")
logger.error("Failure — include exc_info in except blocks", exc_info=True)
logger.critical("Process cannot continue")

# Adding structured context via extra={"ctx": {...}}
# All keys in ctx are merged into the top-level JSON object.
logger.info("Poll read completed", extra={"ctx": {
    "server": server_url,
    "device_id": packet["device_id"],
    "elapsed_ms": round(elapsed, 2)
}})

# In except blocks — always use exc_info=True to capture the traceback
try:
    risky_operation()
except Exception:
    logger.error("Operation failed", exc_info=True, extra={"ctx": {"server": server_url}})
```

**Rules:**
1. Never use `print()` — it loses level, timestamp, file, function, and thread.
2. Always use `exc_info=True` inside `except` blocks.
3. Never log credentials, passwords, or full payloads at INFO or above — use DEBUG.
4. Keep `message` short and consistent — structured fields carry the variable data.

---

## Context Fields by Module

### `app.py`
| Field | Present on |
|---|---|
| `server` | poll cycle events |
| `rate_ms` | cycle start/end |
| `device_id` | per-packet events |
| `elapsed_ms` | poll read completed |
| `cycle_elapsed_ms` | cycle finished |
| `tag_count` | payload queued |
| `signal` | shutdown signal |
| `path` | sys_params loaded |
| `broker`, `type` | broker resolution |
| `server_count`, `config_path` | poll config loaded |
| `thread` | thread started |

### `opc.py`
| Field | Present on |
|---|---|
| `host` | all connection/disconnect events |
| `poll_type` | connected |
| `attempt`, `max_attempts`, `error` | connection attempt failed |
| `subscription` | subscription events |
| `node_ids` | subscription add/remove |
| `node_id` | format_packet errors |
| `index`, `array_length` | array OOB |
| `type` | unhandled data type |
| `tag`, `received_type`, `configured_type` | incompatible data type |
| `node_count` | get_datavalues empty |

### `posthandler.py`
| Field | Present on |
|---|---|
| `protocol` | init, background thread, close |
| `local_backup`, `blocking` | init |
| `host`, `port`, `reason_code` | MQTT connect |
| `topic` | MQTT subscribe/message/write |
| `status_code`, `success_count`, `total_commands` | write batch done |
| `command_count` | write batch start |
| `server` | batch exec error |
| `device` | all post events |
| `url`, `status_code` | HTTP post |
| `file_size_bytes` | DB overflow |
| `count` | backup recovery |
| `items_processed` | queue drain |
| `backup_file` | DB create error |
| `port`, `path` | HTTP command server |

### `csvparser.py`
| Field | Present on |
|---|---|
| `csv_path` | read start |
| `row_count` | CSV parsed |
| `out_path`, `server_count` | config saved |
| `server_count` | merge complete, write index start |
| `path`, `key_count` | write index saved |

### `metrics.py`
| Field | Present on |
|---|---|
| `port` | metrics server started |

---

## What changed vs before

### Replaced
- **97 `print()` calls** across 5 files replaced with structured `logger.*()` calls.
- Inconsistent prefixes (`[OPCUA]`, `######`, plain text) unified into the `file` + `function` fields automatically.
- Exception handlers that did `print(e)` now use `exc_info=True` to capture full tracebacks.

### Added (new log points not previously logged)
- `app.py`: broker resolution, poll config loaded, per-thread start, main loop ready
- `opc.py`: `close()` called, heartbeat thread started, `_subscribe()` when client absent, `get_datavalues()` empty result, `SubHandler.datachange_notification()` at DEBUG
- `posthandler.py`: init summary, background thread start, queue drain count, `postBackup()` record count, HTTP command server bad-JSON warning
- `csvparser.py`: CSV read start, row count, config saved, merge complete, write index start

---

## Logger Module (`src/logger.py`)

```
get_logger(name) -> logging.Logger
```

- One `StreamHandler` to `sys.stdout` per logger name (no duplicates on re-import).
- `_StructuredFormatter` serialises every `LogRecord` to a single-line JSON string.
- Extra structured fields are passed via `extra={"ctx": {...}}` — all keys merge into the top-level JSON.
- `exc_info` tracebacks are formatted as a string in the `exception` field.
- `propagate = False` prevents duplicate lines from the root logger.
- Level controlled by `LOG_LEVEL` env var (default `INFO`).
