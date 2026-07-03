"""
Structured, daily-rotating, JSON loggers per component/class.

Features
- Per-class/component files (e.g., logs/S7Client/S7Client-2025-09-17.log)
- One file per day with date in filename
- Automatic midnight rollover (local timezone) + retention cleanup (default 30 days)
- Thread-safe; safe to call from many threads
- JSON Lines format, easy to parse in a React log viewer later
- Custom "subclass" field (user-defined category), plus rich context (thread, module, file, line, etc.)
- Supports a TRACE level below DEBUG

Quick start
-----------
from structured_logger import LogManager, TRACE

log = LogManager(base_dir="./logs", retention_days=30, console=True)
logger = log.get_logger(component="S7Client", subclass="communication")

logger.trace("Connecting to PLC ...")
logger.info("Session established", extra={"peer":"10.16.16.114", "pdu":480})
logger.warning("Slow response detected")
logger.error("Read failure", exc_info=True)

# On shutdown (optional, helps flush streams and stop the midnight thread):
log.shutdown()

Notes
-----
- Midnight rollover occurs in the machine's local timezone. Timestamps are ISO-8601 with timezone offset.
- Retention cleanup runs when the new daily file is created (exactly at midnight via an internal timer).
- To avoid a background timer thread, set `background_rollover=False` in LogManager; rollover then occurs on the first log after midnight.
- For multi-process logging, you will need an inter-process-safe handler (not provided here). This module is thread-safe within a single process.
"""
from __future__ import annotations

import io
import json
import logging
import threading
from datetime import datetime, timedelta, date, time
from pathlib import Path
from typing import Optional, Dict, Any

# ---------------------------
# TRACE level (lower than DEBUG)
# ---------------------------
TRACE = 5
logging.addLevelName(TRACE, "TRACE")

def _trace(self: logging.Logger, msg, *args, **kwargs):
    if self.isEnabledFor(TRACE):
        self._log(TRACE, msg, args, **kwargs)

logging.Logger.trace = _trace  # type: ignore[attr-defined]

# ---------------------------
# JSON formatter for structured logs
# ---------------------------
class JSONFormatter(logging.Formatter):
    """Formats LogRecord as a JSON line suitable for ingestion by tools/UIs."""

    def __init__(self, *, include_exc: bool = True) -> None:
        super().__init__()
        self.include_exc = include_exc

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created).astimezone().isoformat(timespec="milliseconds")
        payload: Dict[str, Any] = {
            "timestamp": ts,
            # The spec asked for "class (trace, warning, error)"; we mirror that as both level & class
            "level": record.levelname,
            "class": record.levelname.lower(),
            "subclass": getattr(record, "subclass", None),  # user-customizable category
            "message": record.getMessage(),
            "logger": record.name,
            "thread": record.threadName,
            "process": record.process,
            "module": record.module,
            "func": record.funcName,
            "file": record.pathname,
            "line": record.lineno,
            "ts_unix": record.created,
        }
        # Merge any extra context provided by user (excluding reserved names)
        for key, value in getattr(record, "__extra__", {}).items():
            if key not in payload:
                payload[key] = value

        if record.exc_info and self.include_exc:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)

# ---------------------------
# Daily per-component file handler with retention cleanup
# ---------------------------
class DailyPerComponentFileHandler(logging.Handler):
    """Writes JSON log lines to a date-named file per component.

    Path layout: {base_dir}/{component}/{component}-YYYY-MM-DD.log

    Rotation: at local midnight (optionally via a background timer).
    Retention: delete files older than `retention_days` when a new file is created.
    """

    def __init__(
        self,
        *,
        base_dir: Path | str,
        component: str,
        retention_days: int = 30,
        background_rollover: bool = True,
    ) -> None:
        super().__init__()
        self.base_dir = Path(base_dir) / component
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.component = component
        self.retention_days = int(retention_days)
        self._current_date: Optional[date] = None
        self._stream: Optional[io.TextIOWrapper] = None
        self._stop_event = threading.Event()
        self._rollover_thread: Optional[threading.Thread] = None

        # Open today's file and optionally start the midnight rollover thread
        with self.lock:
            self._open_for_today()
        if background_rollover:
            self._start_midnight_thread()

    # ---- file helpers ----
    def _filename_for_date(self, d: date) -> Path:
        return self.base_dir / f"{self.component}-{d.isoformat()}.log"

    def _open_for_today(self) -> None:
        now = datetime.now().astimezone()
        today = now.date()
        if self._current_date != today:
            # Close old stream
            if self._stream:
                try:
                    self._stream.flush()
                finally:
                    self._stream.close()
            self._current_date = today
            self.base_dir.mkdir(parents=True, exist_ok=True)
            self._stream = open(self._filename_for_date(today), mode="a", encoding="utf-8")
            # Clean up older files right after creating the new daily file
            self._cleanup_old_files()

    def _cleanup_old_files(self) -> None:
        cutoff = self._current_date - timedelta(days=self.retention_days)  # type: ignore[operator]
        if cutoff is None:
            return
        prefix = f"{self.component}-"
        for p in self.base_dir.glob(f"{self.component}-*.log"):
            name = p.name
            if not name.startswith(prefix):
                continue
            datestr = name[len(prefix):-4]  # strip prefix and .log
            try:
                d = date.fromisoformat(datestr)
            except Exception:
                continue
            if d < cutoff:
                try:
                    p.unlink()
                except Exception:
                    # Avoid raising during cleanup; continue
                    pass

    # ---- midnight rollover thread ----
    def _start_midnight_thread(self) -> None:
        t = threading.Thread(target=self._midnight_loop, name=f"Rollover-{self.component}", daemon=True)
        self._rollover_thread = t
        t.start()

    def _seconds_until_next_midnight_local(self) -> float:
        now = datetime.now().astimezone()
        tomorrow = (now + timedelta(days=1)).date()
        next_midnight = datetime.combine(tomorrow, time.min).astimezone()
        return max(0.0, (next_midnight - now).total_seconds())

    def _midnight_loop(self) -> None:
        while not self._stop_event.is_set():
            sleep_for = self._seconds_until_next_midnight_local()
            # Sleep in small chunks to allow timely shutdown
            remaining = sleep_for
            while remaining > 0 and not self._stop_event.is_set():
                chunk = min(300, remaining)  # 5 min chunks
                self._stop_event.wait(chunk)
                remaining -= chunk
            if self._stop_event.is_set():
                break
            with self.lock:
                # Trigger open (which rotates & cleans up)
                self._open_for_today()

    # ---- logging.Handler API ----
    def emit(self, record: logging.LogRecord) -> None:
        try:
            # Pull any user-supplied extra dict from record
            extra_payload = {}
            if hasattr(record, "__extra__") and isinstance(record.__extra__, dict):
                extra_payload = record.__extra__
            # Ensure subclass key exists for schema stability
            if not hasattr(record, "subclass"):
                record.subclass = None  # type: ignore[attr-defined]
            with self.lock:
                self._open_for_today()
                if not self._stream:
                    return
                line = self.format(record)
                self._stream.write(line + "\n")
                self._stream.flush()
        except Exception:
            self.handleError(record)

    def close(self) -> None:
        try:
            self._stop_event.set()
            if self._rollover_thread and self._rollover_thread.is_alive():
                self._rollover_thread.join(timeout=2.0)
            with self.lock:
                if self._stream:
                    try:
                        self._stream.flush()
                    finally:
                        self._stream.close()
                self._stream = None
        finally:
            super().close()

# ---------------------------
# Logger adapter that injects a subclass and optional extra dict
# ---------------------------
class SubclassAdapter(logging.LoggerAdapter):
    def __init__(self, logger: logging.Logger, *, subclass: Optional[str] = None):
        # We'll store only subclass; extra payload is provided per-log via .bind()
        super().__init__(logger, {"subclass": subclass})

    def process(self, msg, kwargs):
        # Merge per-call context under __extra__ to avoid clobbering standard fields
        extra = kwargs.get("extra", {})
        subclass = self.extra.get("subclass")
        # Preserve a dedicated __extra__ map for arbitrary keys
        payload = dict(extra.get("__extra__", {}))
        # Allow direct extras to flow through as well
        for k, v in extra.items():
            if k not in ("__extra__", "subclass"):
                payload[k] = v
        kwargs["extra"] = {"subclass": extra.get("subclass", subclass), "__extra__": payload}
        return msg, kwargs

    # Convenience to derive a child adapter with updated subclass
    def with_subclass(self, subclass: Optional[str]):
        return SubclassAdapter(self.logger, subclass=subclass)

# ---------------------------
# LogManager: central factory for per-component JSON loggers
# ---------------------------
class LogManager:
    def __init__(
        self,
        *,
        base_dir: str | Path = "./logs",
        retention_days: int = 30,
        console: bool = False,
        background_rollover: bool = True,
        level: int = logging.INFO,
    ) -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.retention_days = int(retention_days)
        self.console = console
        self.background_rollover = background_rollover
        self.level = level
        self._fmt = JSONFormatter()
        self._loggers: Dict[str, logging.Logger] = {}
        self._handlers: Dict[str, DailyPerComponentFileHandler] = {}
        if console:
            self._console_handler = logging.StreamHandler()
            self._console_handler.setFormatter(self._fmt)
            self._console_handler.setLevel(level)
        else:
            self._console_handler = None

    def get_logger(self, *, component: str, subclass: Optional[str] = None) -> SubclassAdapter:
        """Get a structured logger for a component/class, optionally tagged with a subclass.

        `component` typically matches your Python class name or service name, and maps to its file.
        """
        logger = self._loggers.get(component)
        if logger is None:
            logger = logging.getLogger(component)
            logger.setLevel(self.level)
            handler = DailyPerComponentFileHandler(
                base_dir=self.base_dir,
                component=component,
                retention_days=self.retention_days,
                background_rollover=self.background_rollover,
            )
            handler.setFormatter(self._fmt)
            handler.setLevel(self.level)
            logger.addHandler(handler)
            if self._console_handler is not None:
                logger.addHandler(self._console_handler)
            # Avoid log propagation to root
            logger.propagate = False
            self._loggers[component] = logger
            self._handlers[component] = handler
        return SubclassAdapter(logger, subclass=subclass)

    def set_level(self, level: int) -> None:
        self.level = level
        for lg in self._loggers.values():
            lg.setLevel(level)
        for h in self._handlers.values():
            h.setLevel(level)
        if self._console_handler is not None:
            self._console_handler.setLevel(level)

    def shutdown(self) -> None:
        # Close handlers and detach from their loggers
        for component, lg in list(self._loggers.items()):
            for h in list(lg.handlers):
                try:
                    h.flush()
                except Exception:
                    pass
                try:
                    h.close()
                except Exception:
                    pass
                lg.removeHandler(h)
        self._loggers.clear()
        self._handlers.clear()

