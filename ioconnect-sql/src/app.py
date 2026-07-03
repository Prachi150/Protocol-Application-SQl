# ==============================================================================
# app.py — IoConnect SQL Protocol Adapter Main Entry Point
#
# Adapted from ioconnect-protocol-template/src/examples/python/app.py.
# Differences from the verbatim template (all clearly marked below):
#   • Imports/instantiates SQLClient instead of OPCUAClient.
#   • client_registry is keyed by a composite "server:port/database" so multiple
#     databases on the same host don't collide.
#   • SQL semantics in poll(): read() returns many historical rows, each with its
#     OWN timestamp, so we post ONE payload per row (stamped with the row's time)
#     rather than collapsing them into a single poll-time snapshot. status 2
#     (no new rows since last read) posts nothing.
#
# What this file does:
#   1. Loads sys_parameters.json and config.csv via csvparser.py
#   2. Starts the Prometheus metrics HTTP server
#   3. Resolves the broker destination (env var overrides JSON config)
#   4. Instantiates one SQL client per server entry in the poll config
#   5. Shares one post_handler instance across all servers
#   6. Spawns one polling thread per server, then blocks until SIGTERM/SIGINT
#   7. On shutdown: joins threads, flushes post_handler, closes protocol clients
# ==============================================================================
import os
import time
import json
import threading
from pathlib import Path
import csvparser as pollConfigFunc
from sql import SQLClient                            # SQL (MySQL/MSSQL) protocol client
import signal
from posthandler import post_handler
from metrics import metrics
from logger import get_logger

logger = get_logger(__name__)


def server_key_of(server_entry):
    """Composite key: unique per SQL connection (multiple DBs share a host)."""
    proto = server_entry['protocol']
    return f"{proto.get('server')}:{proto.get('port')}/{proto.get('database')}"

# ─── Polling Logic ────────────────────────────────────────────────────────────

def poll(config : list, protocol_obj : SQLClient, post_obj : post_handler, stop_event : threading.Event, server_url : str):

    config.sort(key=lambda x: x['rate'])

    last_cycle_time = time.monotonic()*1000
    for rate_config in config:
        rate_config["nextdue"] = last_cycle_time
        rate_config["last_actual_poll_time"] = None    # for jitter tracking

    # ── Pre-initialize counters for all devices ──
    # This ensures the "bad" tag counter exists from the start so
    # Grafana's Bad Tag Rate % shows 0% instead of "No data".
    for rate_config in config:
        poll_rate_str = str(rate_config['rate'])
        for packet in rate_config["packets"]:
            metrics.init_device_counters(server_url, packet["device_id"], poll_rate_str)

    logger.info("Poll loop started", extra={"ctx": {"server": server_url, "rate_groups": len(config)}})

    while not stop_event.is_set():
        try:
            curr_time = time.monotonic()*1000

            # update connection status gauge every iteration
            metrics.set_connection_status(server_url, 1 if protocol_obj.conn_status else 0)

            if curr_time-last_cycle_time > 300:    #cheap rate limiter
                for rate_config in config:

                    if curr_time > rate_config["nextdue"]:
                        poll_ts = int(time.time()*1000)
                        poll_rate_str = str(rate_config['rate'])

                        logger.info("Poll cycle starting", extra={"ctx": {
                            "server": server_url,
                            "rate_ms": rate_config["rate"]
                        }})

                        # ── jitter calculation ──
                        if rate_config["last_actual_poll_time"] is not None:
                            actual_interval_ms = (time.monotonic() * 1000) - (rate_config["last_actual_poll_time"] * 1000)
                            expected_interval_ms = rate_config["rate"]
                            jitter_ms = abs(actual_interval_ms - expected_interval_ms)

                            metrics.observe_jitter(server_url, poll_rate_str, jitter_ms)
                            metrics.update_jitter_peak(server_url, poll_rate_str, jitter_ms)
                            metrics.update_jitter_min(server_url, poll_rate_str, jitter_ms)

                        rate_config["last_actual_poll_time"] = time.monotonic()

                        # ── cycle duration timing ──
                        cycle_start = time.monotonic()

                        for packet in rate_config["packets"]:
                            tags = None
                            try:
                                read_start = time.monotonic()
                                tags = protocol_obj.read(packet)
                                read_elapsed_ms = (time.monotonic() - read_start) * 1000

                                logger.info("Poll read completed", extra={"ctx": {
                                    "server": server_url,
                                    "device_id": packet["device_id"],
                                    "rate_ms": rate_config["rate"],
                                    "elapsed_ms": round(read_elapsed_ms, 2)
                                }})

                                # ── latency metric ──
                                metrics.observe_latency(server_url, packet["device_id"], poll_rate_str, read_elapsed_ms)
                                metrics.update_latency_peak(server_url, packet["device_id"], poll_rate_str, read_elapsed_ms)
                                metrics.update_latency_min(server_url, packet["device_id"], poll_rate_str, read_elapsed_ms)

                                # ── request counter (success) ──
                                metrics.inc_poll_requests(server_url, packet["device_id"], poll_rate_str, 'success')

                            except Exception:
                                logger.error("Poll read failed", exc_info=True, extra={"ctx": {
                                    "server": server_url,
                                    "device_id": packet["device_id"]
                                }})
                                # ── request counter (error) ──
                                metrics.inc_poll_requests(server_url, packet["device_id"], poll_rate_str, 'error')

                            # ── SQL semantics: read() returns a list of historical
                            #    rows, each with its OWN timestamp. Post one payload
                            #    per row (stamped with the row's time) instead of
                            #    collapsing them into a single poll-time snapshot.
                            #    status 2 = no new rows since last read → post nothing.
                            good_count = 0
                            bad_count = 0
                            rows_posted = 0

                            if tags is not None:
                                for row in tags:
                                    row_status = row.get("status")
                                    if row_status == 1:
                                        row_tags = row.get("tags", [])
                                        good_count += len(row_tags)
                                        data_packet = row_tags + [
                                            {"tag": "RSSI", "value": 22},
                                            {"tag": "Status", "value": 1},
                                        ]
                                        payload = {
                                            "device": packet["device_id"],
                                            "time": row.get("time", poll_ts),
                                            "data": data_packet,
                                        }
                                        post_obj.post(payload)
                                        rows_posted += 1
                                    elif row_status == 2:
                                        # No new rows since last read — nothing to post.
                                        pass
                                    else:
                                        bad_count += 1
                                        logger.warning("Row read returned error", extra={"ctx": {
                                            "server": server_url,
                                            "device_id": packet["device_id"],
                                            "error": row.get("error")
                                        }})

                                # ── tags polled counters ──
                                if good_count > 0:
                                    metrics.inc_tags_polled(server_url, packet["device_id"], poll_rate_str, 'good', good_count)
                                if bad_count > 0:
                                    metrics.inc_tags_polled(server_url, packet["device_id"], poll_rate_str, 'bad', bad_count)

                                if rows_posted > 0:
                                    logger.info("Rows queued for posting", extra={"ctx": {
                                        "server": server_url,
                                        "device_id": packet["device_id"],
                                        "rows_posted": rows_posted,
                                        "tags_total": good_count
                                    }})
                            else:
                                logger.warning("Empty result received from SQL read", extra={"ctx": {
                                    "server": server_url,
                                    "device_id": packet["device_id"]
                                }})

                        # ── cycle duration metric ──
                        cycle_elapsed_ms = (time.monotonic() - cycle_start) * 1000
                        metrics.observe_cycle_duration(server_url, poll_rate_str, cycle_elapsed_ms)

                        logger.info("Poll cycle finished", extra={"ctx": {
                            "server": server_url,
                            "rate_ms": rate_config["rate"],
                            "cycle_elapsed_ms": round(cycle_elapsed_ms, 2)
                        }})

                        rate_config["nextdue"] = curr_time + (rate_config["rate"])
                        last_cycle_time = curr_time

            time.sleep(0.001)
        except Exception:
            logger.error("Unexpected exception in poll loop iteration, continuing", exc_info=True, extra={"ctx": {"server": server_url}})
            time.sleep(1)

def signal_handler_factory(stop_event):
    def handler(sig, frame):
        logger.info("Shutdown signal received", extra={"ctx": {"signal": sig}})
        stop_event.set()
    return handler

def main():
    # Determine base directory for configuration files
    base_dir_env = os.environ.get("FILES_BASE_DIR",None)
    if base_dir_env:
        base_dir = Path(base_dir_env)
    else:
        # Fallback for local execution when moved to src/
        base_dir = Path(__file__).resolve().parent.parent

    config_path = base_dir / "config.csv"
    sys_path = base_dir / "sys_parameters.json"

    stop_event = threading.Event()
    signal_handler = signal_handler_factory(stop_event)
    signal.signal(signal.SIGINT, signal_handler)   # Ctrl+C
    signal.signal(signal.SIGTERM, signal_handler)  # kill <pid>

    try:
        with open(sys_path, 'r') as f:
            sys_params = json.load(f)
    except FileNotFoundError:
        logger.critical("sys_parameters.json not found", extra={"ctx": {"path": str(sys_path)}})
        return
    except Exception:
        logger.critical("Failed to load sys_parameters.json", exc_info=True, extra={"ctx": {"path": str(sys_path)}})
        return

    logger.info("System parameters loaded", extra={"ctx": {"path": str(sys_path)}})

    # Read METRICS_PORT from the environment (injected by systemd via .env)
    # Fallback to 9464 for local dev if the variable isn't set.
    metrics_port = int(os.environ.get("METRICS_PORT", 9464))

    # ── Start Prometheus metrics HTTP server ──
    try:
        metrics.start(metrics_port)
    except Exception:
        logger.critical("Failed to start Prometheus metrics server", exc_info=True, extra={"ctx": {"port": metrics_port}})
        return

    # ── Resolve Broker Configuration ──
    # Precedence: HTTP_POST_URL env > REDPANDA_KAFKA_ADDRESS env > posting[0] in file.
    http_post_url = os.environ.get("HTTP_POST_URL")
    os_broker_address = os.environ.get("REDPANDA_KAFKA_ADDRESS")
    json_posting = sys_params.get("posting", [])

    posting_config = None

    if http_post_url:
        # Route all payloads to a single HTTP endpoint (used for local monitoring
        # via the configurator's /api/monitor/ingest, or any HTTP collector).
        from urllib.parse import urlparse
        u = urlparse(http_post_url)
        posting_config = {
            "type": "http",
            "host": f"{u.scheme}://{u.hostname}",
            "port": u.port or (443 if u.scheme == "https" else 80),
            "method": "POST",
            "timeout": 2000,
            "path": u.path or "/",
            "headers": {"Content-Type": "application/json"},
            "localbackup": False,
            "backupfile": "",
            "blocking": False,
            "stringPosting": True,
        }
        logger.info("Using HTTP post endpoint from environment", extra={"ctx": {"url": http_post_url}})
    elif os_broker_address:
        posting_config = {
            "type": "redpanda",
            "bootstrap_servers": os_broker_address,
            "security_protocol": os.environ.get("REDPANDA_KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"),
            "sasl_mechanism": os.environ.get("REDPANDA_KAFKA_SASL_MECHANISM", ""),
            "sasl_username": os.environ.get("REDPANDA_KAFKA_SASL_USERNAME", ""),
            "sasl_password": os.environ.get("REDPANDA_KAFKA_SASL_PASSWORD", ""),
            "client_id": os.environ.get("REDPANDA_KAFKA_CLIENT_ID", "ioconnect-sql"),
            "acks": os.environ.get("REDPANDA_KAFKA_ACKS", "all"),
            "compression_type": os.environ.get("REDPANDA_KAFKA_COMPRESSION_TYPE", "lz4"),
            "backupfile": "",
            "localbackup": False,
            "blocking": False,
            "stringPosting": True,
        }
        logger.info("Using Redpanda broker from environment", extra={"ctx": {"broker": os_broker_address}})
    elif len(json_posting) > 0:
        posting_config = json_posting[0]
        logger.info("Using broker from sys_parameters.json", extra={"ctx": {"type": posting_config.get("type")}})

    if not posting_config:
        logger.critical("No broker configuration found in OS environment or sys_parameters.json, exiting")
        return

    try:
        poll_config = pollConfigFunc.read(config_path, sys_params["polling"])
    except Exception:
        logger.critical("Failed to load poll config from CSV", exc_info=True, extra={"ctx": {"config_path": str(config_path)}})
        return

    logger.info("Poll config loaded", extra={"ctx": {
        "server_count": len(poll_config),
        "config_path": str(config_path)
    }})

    try:
        write_index = pollConfigFunc.build_write_index(poll_config, base_dir)
    except Exception:
        logger.critical("Failed to build write index", exc_info=True)
        return

    cmd_server_config = sys_params.get("command_server", None)

    threads = []
    client_registry = {}

    # 1. Instantiate protocol clients and build registry
    for server_entry in poll_config:
        server_key = server_key_of(server_entry)
        try:
            protocol_obj = SQLClient(server_entry)
        except Exception:
            logger.critical("Failed to instantiate protocol client", exc_info=True, extra={"ctx": {"server": server_key}})
            return
        client_registry[server_key] = protocol_obj

    # 2. Initialize post_handler
    try:
        post_obj = post_handler(posting_config, write_index, cmd_server_config, client_registry)
    except Exception:
        logger.critical("Failed to initialise post_handler", exc_info=True)
        return

    # 3. Start polling threads
    for server_entry in poll_config:
        server_key = server_key_of(server_entry)
        protocol_obj = client_registry[server_key]

        t = threading.Thread(target=poll, args=(server_entry['pollrates'], protocol_obj, post_obj, stop_event, server_key))
        t.daemon = True
        t.start()
        threads.append(t)
        logger.info("Poll thread started", extra={"ctx": {"server": server_key, "thread": t.name}})

    logger.info("All poll threads running, waiting for stop signal")

    try:
        while not stop_event.is_set():
            time.sleep(1)
    except KeyboardInterrupt:
        stop_event.set()

    for t in threads:
        t.join(timeout=5)

    try:
        post_obj.close()
        for obj in client_registry.values():
            obj.close()
    except Exception:
        logger.error("Error during shutdown", exc_info=True)

    logger.info("Shutdown complete")

if __name__ == "__main__":
    main()
