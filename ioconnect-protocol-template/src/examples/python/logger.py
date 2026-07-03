# ==============================================================================
# logger.py — Structured JSON Logger (Python, identical across all adapters)
#
# No changes needed for a new protocol adapter. Copy this file verbatim.
# SERVICE_NAME is injected at runtime from env/.env.api by install.sh.
# Falls back to "protocol-opcua" if the env var is not set (local dev only).
#
# Log records are single-line JSON written to stdout (captured by journald)
# and optionally to a rotating file if LOG_DIR is set.
# ==============================================================================
import logging
import logging.handlers
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

SERVICE_NAME = os.environ.get("SERVICE_NAME", "protocol-opcua")


class _StructuredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_obj = {
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "service": SERVICE_NAME,
            "file": record.filename,
            "function": record.funcName,
            "thread": record.threadName,
            "message": record.getMessage(),
        }
        ctx = getattr(record, "ctx", None)
        if ctx:
            log_obj.update(ctx)
        if record.exc_info:
            log_obj["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_obj, default=str)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        formatter = _StructuredFormatter()
        level = os.environ.get("LOG_LEVEL", "INFO").upper()

        stdout_handler = logging.StreamHandler(sys.stdout)
        stdout_handler.setFormatter(formatter)
        logger.addHandler(stdout_handler)

        log_dir = os.environ.get("LOG_DIR")
        if log_dir:
            log_path = Path(log_dir) / f"{SERVICE_NAME}.log"
            file_handler = logging.handlers.RotatingFileHandler(
                log_path, maxBytes=10 * 1024 * 1024, backupCount=5
            )
            file_handler.setFormatter(formatter)
            logger.addHandler(file_handler)

        logger.setLevel(getattr(logging, level, logging.INFO))
        logger.propagate = False
    return logger
