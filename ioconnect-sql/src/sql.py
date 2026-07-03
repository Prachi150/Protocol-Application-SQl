# ==============================================================================
# sql.py — SQL (MySQL / MSSQL) protocol client for the IoConnect adapter
#
# Ported from ioconnect-sql-python/sql.py and adapted to the protocol-template
# contract so app.py can drive it exactly like OPC UA / Modbus / S7 clients:
#
#   client = SQLClient(server_entry)          # server_entry = one polling[] entry
#   packets = client.read(packet)             # packet = {device_id, table, columns, tag_configs}
#   client.conn_status                        # bool (1=connected / 0=disconnected)
#   client.close()                            # release the connection
#
# read() returns a protocol-agnostic list:
#   [{ "time": <ms>, "tags": [{"tag": <name>, "value": <v>}, ...],
#      "status": 1|2, "error": None|"<msg>" }]
#   status 1 = fresh rows, status 2 = no new rows since last read.
#
# Incremental polling: each table must expose a monotonic timestamp column,
# tagged "ts" in config.csv. We remember the last-read timestamp per
# (connection, table) in history.json and only pull rows newer than it.
# ==============================================================================
import time
import json
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta

import pyodbc

from logger import get_logger

logger = get_logger(__name__)


class SQLClient:
    def __init__(self, server_entry):
        self.server_entry = server_entry
        proto = server_entry.get("protocol", {})

        # ── Connection identity (flat schema — no nested "mysql"/"mssql" block) ──
        self.sqltype = proto.get("type", "")                 # "mysql" | "mssql"
        self.host = proto.get("server", "")
        self.port = proto.get("port", -1)
        self.database = proto.get("database", None)
        self.username = proto.get("username", None)
        self.password = proto.get("password", None)
        self.row_limit = proto.get("rowlimit", 100) or 100
        self.driver = proto.get("driver", None)
        self.offline_poll_count = proto.get("offline_poll_count", None)
        self.default_last_read_time = proto.get("default_last_read_time", 1704067200000)

        # Timezone used to (a) build the WHERE-clause datetime param and
        # (b) interpret naive datetimes read back from the DB, so the
        # round-trip is self-consistent. Default 330 = IST (+05:30).
        tz_offset_minutes = proto.get("tz_offset_minutes", 330)
        self.TZ = timezone(timedelta(minutes=tz_offset_minutes))

        # ── Connection / retry params (from the polling[] entry) ──
        self.retry_count = server_entry.get("connect_retry_count", 3)
        self.retry_delay = server_entry.get("connect_retry_time", 1000) / 1000  # ms -> s
        self.interpoll_delay = server_entry.get("interpoll_delay", 100) / 1000  # ms -> s
        self.conn_type = server_entry.get("connection_type", "persist")

        # ── Runtime state ──
        self.conn = None
        self.conn_status = False                              # bool (template contract)
        self.conn_key = f"{self.host}:{self.port}/{self.database}"

        # ── Incremental-read history (namespaced by connection to avoid
        #    same-named tables in different databases colliding) ──
        base_dir_env = os.environ.get("FILES_BASE_DIR")
        base_dir = Path(base_dir_env) if base_dir_env else Path(__file__).resolve().parent.parent
        self.HISTORY_FILE = base_dir / "history.json"
        self.last_read_time = self._load_history()

        if self.conn_type == "persist":
            try:
                self.connect()
            except Exception as e:
                # Don't crash construction — app.py will surface conn_status and
                # read() will attempt to (re)connect on demand.
                logger.error("Initial SQL connect failed", exc_info=True,
                             extra={"ctx": {"conn": self.conn_key, "error": str(e)}})

    # ── History persistence ───────────────────────────────────────────────────

    def _load_history(self):
        try:
            if self.HISTORY_FILE.exists():
                with open(self.HISTORY_FILE, "r") as f:
                    return json.load(f).get("last_read_time", {})
        except Exception:
            logger.warning("Could not read history.json, starting fresh", exc_info=True)
        return {}

    def saveHistory(self):
        try:
            # Merge with whatever else is on disk so parallel clients don't clobber
            # each other's keys.
            on_disk = {}
            if self.HISTORY_FILE.exists():
                with open(self.HISTORY_FILE, "r") as f:
                    on_disk = json.load(f).get("last_read_time", {})
            on_disk.update(self.last_read_time)
            with open(self.HISTORY_FILE, "w") as f:
                json.dump({"last_read_time": on_disk}, f)
        except Exception:
            logger.error("Error saving history.json", exc_info=True)

    def _hkey(self, tablename):
        return f"{self.conn_key}/{tablename}"

    # ── Connection lifecycle ──────────────────────────────────────────────────

    def connect(self):
        if (self.host == "") or (self.port in (-1, None)):
            logger.error("SQL connect aborted: missing host/port",
                         extra={"ctx": {"conn": self.conn_key}})
            self.conn_status = False
            return False

        try:
            if self.sqltype == "mssql":
                driver = self.driver or "ODBC Driver 18 for SQL Server"
                conn_str = (
                    f"DRIVER={{{driver}}};SERVER={self.host},{self.port};DATABASE={self.database};"
                    f"UID={self.username};PWD={self.password};Encrypt=yes;TrustServerCertificate=yes;"
                )
            elif self.sqltype == "mysql":
                driver = self.driver or "MySQL ODBC 9.4 Unicode Driver"
                port = self.port or 3306
                conn_str = (
                    f"DRIVER={{{driver}}};"
                    f"SERVER={self.host};PORT={port};DATABASE={self.database};"
                    f"UID={self.username};PWD={self.password};"
                    "OPTION=3;"
                )
            else:
                logger.error("Unsupported SQL type", extra={"ctx": {"type": self.sqltype}})
                self.conn_status = False
                return False

            success = False
            for attempt in range(self.retry_count):
                try:
                    # autocommit=True is essential for a persistent polling
                    # connection: without it, the driver holds one long-lived
                    # transaction and under REPEATABLE READ (MySQL/MariaDB default)
                    # never sees rows committed by other connections after connect.
                    self.conn = pyodbc.connect(conn_str, autocommit=True)
                    success = True
                    break
                except Exception as e:
                    logger.warning("SQL connection attempt failed",
                                   extra={"ctx": {"conn": self.conn_key,
                                                  "attempt": attempt + 1, "error": str(e)}})
                    time.sleep(self.retry_delay)

            self.conn_status = success
            if success:
                logger.info("SQL connected", extra={"ctx": {"conn": self.conn_key}})
            else:
                logger.error("SQL connection failed after retries",
                             extra={"ctx": {"conn": self.conn_key}})
            return success

        except Exception:
            logger.error("Error in SQL connect()", exc_info=True,
                         extra={"ctx": {"conn": self.conn_key}})
            self.conn_status = False
            return False

    def disconnect(self):
        if self.conn:
            try:
                self.conn.close()
            except Exception:
                logger.warning("Error closing SQL connection", exc_info=True)
        self.conn = None
        self.conn_status = False

    def close(self):
        """Template contract: app.py calls close() on shutdown."""
        self.disconnect()
        logger.info("SQL client closed", extra={"ctx": {"conn": self.conn_key}})

    # ── Read one packet (one table) ───────────────────────────────────────────
    #
    # packet = {
    #   "device_id":   "<device>",
    #   "table":       "<table name>",
    #   "columns":     ["<col>", ...],          # DB column names, index-aligned with tag_configs
    #   "tag_configs": [{"tagName": "<tag>", "datatype": "<type>", "resolution": <n>}, ...]
    # }
    # Exactly one tag_config must have tagName == "ts" — it marks the timestamp column.
    def read(self, packet):
        tablename = packet["table"]
        columns = packet["columns"]
        tag_configs = packet["tag_configs"]
        try:
            if not self.conn_status:
                if not self.connect():
                    raise Exception("SQL not connected")

            # Locate the timestamp column
            index_found = None
            for index, tag_config in enumerate(tag_configs):
                if tag_config["tagName"] == "ts":
                    index_found = index
                    break
            if index_found is None:
                raise Exception("Timestamp column ('ts' tag) not found in packet")

            q_table = self._q(tablename)
            ts_col = self._q(columns[index_found])
            column_str = ", ".join(self._q(col) for col in columns)

            hkey = self._hkey(tablename)
            last_read_time = self.last_read_time.get(hkey, self.default_last_read_time)

            # How many unread rows?
            cur = self.conn.cursor()
            cur.execute(self.get_row_count_query(q_table, ts_col),
                        [self.datetime_from_epoch_ms(last_read_time)])
            row_count = cur.fetchall()[0][0]
            cur.close()

            if not row_count or row_count <= 0:
                logger.debug("No new rows", extra={"ctx": {"conn": self.conn_key, "table": tablename}})
                return [{"tags": [], "time": int(time.time() * 1000), "status": 2, "error": None}]

            packets = []
            while row_count > 0:
                count = min(self.row_limit, row_count)
                cur = self.conn.cursor()
                cur.execute(self.get_rows_query(q_table, column_str, ts_col, count),
                            [self.datetime_from_epoch_ms(last_read_time)])
                data = cur.fetchall()
                columns_recv = cur.description
                cur.close()

                if not data:
                    break

                if not (len(columns_recv) == len(columns) == len(data[0])):
                    raise Exception("Column count mismatch between query result and config")

                rows = self.format_packet(data, columns, columns_recv, tag_configs)
                # +4ms to skip past the last row (SQL Server 3.33ms datetime tick rounding)
                last_read_time = rows[-1]["time"] + 4
                packets += rows
                row_count -= count
                time.sleep(self.interpoll_delay)

            self.last_read_time[hkey] = last_read_time
            self.saveHistory()
            logger.info("Rows read", extra={"ctx": {"conn": self.conn_key, "table": tablename,
                                                    "count": len(packets),
                                                    "through_ms": last_read_time}})

            if self.conn_type != "persist":
                self.disconnect()

            return packets

        except Exception as e:
            # On error make sure we drop the (possibly broken) connection so the
            # next cycle reconnects cleanly.
            self.conn_status = False
            raise Exception(f"SQL read error [{tablename}]: {e}")

    # ── Query builders (dialect-specific) ─────────────────────────────────────

    def get_row_count_query(self, q_table, ts_col):
        if self.sqltype in ("mssql", "mysql"):
            return f"SELECT COUNT(*) AS row_count FROM {q_table} WHERE {ts_col} > ?;"
        raise Exception("Unsupported SQL Type")

    def get_rows_query(self, q_table, column_str, ts_col, count):
        if self.sqltype == "mssql":
            return (f"SELECT TOP ({int(count)}) {column_str} FROM {q_table} "
                    f"WHERE {ts_col} > ? ORDER BY {ts_col} ASC")
        elif self.sqltype == "mysql":
            return (f"SELECT {column_str} FROM {q_table} "
                    f"WHERE {ts_col} > ? ORDER BY {ts_col} ASC LIMIT {int(count)}")
        raise Exception("Unsupported SQL Type")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def datetime_from_epoch_ms(self, ms):
        # Integer math in UTC, then convert to the configured TZ (no float rounding).
        dt_utc = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ms)
        return dt_utc.astimezone(self.TZ)

    def format_packet(self, data, columns, columns_recv, tag_configs):
        packets = []
        for row in data:
            packet = {"tags": [], "status": 1, "error": None}
            for col in columns_recv:
                try:
                    index = columns.index(col[0])
                except ValueError:
                    raise Exception(f"Column '{col[0]}' returned by DB is not in the configured column list")

                tag_config = tag_configs[index]
                declared = tag_config.get("datatype", "")
                actual = col[1].__name__ if col[1] is not None else ""
                # Lenient datatype check: only warn on mismatch (never drop the whole
                # batch), and skip entirely when the config leaves datatype blank.
                if declared and actual and declared != actual:
                    logger.debug("Datatype mismatch (using value anyway)",
                                 extra={"ctx": {"column": col[0], "declared": declared, "actual": actual}})

                value = row[index]
                tag_name = tag_config["tagName"]
                if tag_name == "ts":
                    if isinstance(value, datetime):
                        if value.tzinfo is None:
                            value = value.replace(tzinfo=self.TZ)
                        packet["time"] = int(value.timestamp() * 1000)
                    else:
                        packet["time"] = int(value)
                else:
                    packet["tags"].append({"tag": tag_name, "value": value})

            if "time" not in packet:
                packet["time"] = int(time.time() * 1000)
            packets.append(packet)
        return packets

    def _q(self, ident):
        """Safe identifier quoting for table/column names you control."""
        if self.sqltype == "mssql":
            return f"[{ident}]"
        elif self.sqltype == "mysql":
            return f"`{ident}`"
        return ident
