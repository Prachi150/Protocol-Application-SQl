# ==============================================================================
# csvparser.py — SQL adapter config merger (config.csv + sys_parameters.json)
#
# Produces the poll_config structure app.py expects, identical in shape to the
# OPC/Modbus/S7 adapters:
#
#   [ { ...<polling[] entry>...,                         # protocol + connection params
#       "pollrates": [
#         { "rate": <ms>,
#           "packets": [
#             { "device_id": "<device>",
#               "table":     "<table>",
#               "columns":     ["<col>", ...],           # index-aligned with tag_configs
#               "tag_configs": [{"tagName","datatype","resolution"}, ...] }
#           ] }
#       ] } ]
#
# One server entry is emitted per polling[] entry (i.e. per server:port/database
# connection); its CSV rows are grouped by lograte, then by (device, table) into
# packets. Each packet must contain exactly one row whose tag is "ts" — that
# marks the timestamp column used for incremental reads (see sql.py).
#
# config.csv columns:
#   device, server, port, database, table, column, tag, datatype, resolution, lograte
# ==============================================================================
import csv
from logger import get_logger

logger = get_logger(__name__)


def _norm(value):
    return str(value).strip() if value is not None else ""


def _load_rows(config_path):
    """Read config.csv, dropping blank and #-comment lines, returning stripped dict rows."""
    with open(config_path, newline="", encoding="utf-8-sig") as f:
        lines = [ln for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
    reader = csv.DictReader(lines)
    rows = []
    for raw in reader:
        rows.append({(_norm(k)): (v.strip() if isinstance(v, str) else v)
                     for k, v in raw.items() if k is not None})
    return rows


def read(config_path, polling):
    """Merge config.csv into the sys_parameters.json polling[] list -> poll_config."""
    rows = _load_rows(config_path)
    logger.info("Loaded config.csv", extra={"ctx": {"row_count": len(rows), "path": str(config_path)}})

    poll_config = []

    for entry in polling:
        proto = entry.get("protocol", {})
        conn_key = (_norm(proto.get("server")), _norm(proto.get("port")), _norm(proto.get("database")))

        # Rows belonging to this connection (match on server:port/database)
        matched = [r for r in rows
                   if (_norm(r.get("server")), _norm(r.get("port")), _norm(r.get("database"))) == conn_key]

        if not matched:
            logger.warning("Polling entry has no matching config.csv rows — skipped",
                           extra={"ctx": {"server": conn_key[0], "port": conn_key[1], "database": conn_key[2]}})
            continue

        # rate -> {(device, table) -> packet}
        rate_map = {}
        for r in matched:
            lograte = _norm(r.get("lograte"))
            try:
                rate = int(float(lograte))
            except (TypeError, ValueError):
                logger.warning("Row skipped: invalid lograte",
                               extra={"ctx": {"device": r.get("device"), "table": r.get("table"), "lograte": lograte}})
                continue

            device = _norm(r.get("device"))
            table = _norm(r.get("table"))
            pkt_key = (device, table)

            group = rate_map.setdefault(rate, {})
            packet = group.setdefault(pkt_key, {
                "device_id": device,
                "table": table,
                "columns": [],
                "tag_configs": [],
            })

            packet["columns"].append(_norm(r.get("column")))
            tag_config = {"tagName": _norm(r.get("tag")), "datatype": _norm(r.get("datatype"))}
            resolution = _norm(r.get("resolution"))
            if resolution != "":
                try:
                    tag_config["resolution"] = int(float(resolution))
                except (TypeError, ValueError):
                    pass
            packet["tag_configs"].append(tag_config)

        # Assemble pollrates (sorted by rate), validating the ts column
        pollrates = []
        for rate in sorted(rate_map):
            packets = list(rate_map[rate].values())
            for packet in packets:
                if not any(tc["tagName"] == "ts" for tc in packet["tag_configs"]):
                    logger.error("Packet missing required 'ts' timestamp tag — it will fail to read",
                                 extra={"ctx": {"device": packet["device_id"], "table": packet["table"]}})
            pollrates.append({"rate": rate, "packets": packets})

        server_entry = dict(entry)
        server_entry["pollrates"] = pollrates
        poll_config.append(server_entry)

        logger.info("Built server entry", extra={"ctx": {
            "server": conn_key[0], "database": conn_key[2],
            "rate_groups": len(pollrates),
            "packets": sum(len(pr["packets"]) for pr in pollrates),
        }})

    return poll_config


def build_write_index(poll_config, base_dir):
    """SQL polling is read-only — no writable tags, so the write index is empty.

    Kept for parity with the template so app.py's command-server plumbing and
    posthandler.execute_write_batch() have a valid (empty) index to consult.
    """
    return {}
