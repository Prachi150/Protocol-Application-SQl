# ==============================================================================
# posthandler.py — Post Handler (Python, identical across all adapters)
#
# No changes needed for a new protocol adapter. Copy this file verbatim.
# This module is fully protocol-agnostic — it only handles routing data to
# the configured destination (MQTT, HTTP, or Redpanda Kafka) and does not
# know anything about the industrial protocol used to collect the data.
#
# Features:
#   - Non-blocking queue: poll() puts payloads on the queue, background
#     thread drains and posts them so the poll loop never blocks on network
#   - Three posting backends: MQTT, HTTP, Redpanda Kafka
#   - SQLite local backup: payloads are saved locally when the broker is
#     unreachable and replayed automatically when connectivity is restored
#   - Write command server: optional HTTP or MQTT server for receiving
#     write commands routed back to protocol clients (for read-write protocols)
# ==============================================================================
import queue
import sqlite3
import random
import os
import requests as http
import paho.mqtt.client as mqtt
import time
import json
import threading
from pathlib import Path
from logger import get_logger
try:
    from confluent_kafka import Producer as KafkaProducer
    CONFLUENT_KAFKA_AVAILABLE = True
except ImportError:
    CONFLUENT_KAFKA_AVAILABLE = False

import http.server
import socketserver

logger = get_logger(__name__)

class post_handler:
    def __init__(self, config, write_index, cmd_server_config, client_registry):
        self.protocol = config["type"]

        # Command Server properties
        self.write_index = write_index
        self.cmd_server_config = cmd_server_config
        self.client_registry = client_registry
        self._cmd_mqtt_client = None

        self.stringPosting = config["stringPosting"]
        self.stop_event = threading.Event()
        self.data_queue = queue.Queue()
        self.blocking = config["blocking"]


        if self.protocol == 'mqtt':
            self.host = config["host"]
            self.port = config["port"]
            self.keepalive = config["keepalive"]
            self.clientid = config["clientId"]
            self.username = config["username"]
            self.password = config["password"]
            self.qos = config["qos"]
            self.clientId = config["clientId"]
            if self.clientId == "":
                self.clientId = "MOD_FAC_" + str(random.randint(1000, 9999))

            mqttc = mqtt.Client(client_id=self.clientid, clean_session=True, protocol=mqtt.MQTTv311, transport="tcp")
            mqttc.username_pw_set(username=self.username, password=self.password)
            mqttc.on_connect = self.on_connect
            mqttc.on_message = self.on_message
            try:
                mqttc.connect(self.host, self.port, self.keepalive)
            except Exception:
                logger.critical("Failed to connect to MQTT broker", exc_info=True, extra={"ctx": {"host": self.host, "port": self.port}})
                raise
            self.mqttObj = mqttc

        elif self.protocol == "http":
            self.host = config["host"]
            self.port = config["port"]
            self.method = config["method"]
            self.path = config["path"]
            self.headers = config["headers"]
            self.timeout = config["timeout"] / 1000

        elif self.protocol == "redpanda":
            if not CONFLUENT_KAFKA_AVAILABLE:
                logger.critical("confluent-kafka package not available, cannot use Redpanda protocol")
                raise ImportError("confluent-kafka is required for Redpanda posting. Install it with: pip install confluent-kafka")
            producer_conf = {
                "bootstrap.servers": config["bootstrap_servers"],
                "client.id": config.get("client_id", "opcua-protocol-" + str(random.randint(1000, 9999))),
                "acks": str(config.get("acks", "all")),
            }
            security_protocol = config.get("security_protocol", "PLAINTEXT")
            producer_conf["security.protocol"] = security_protocol
            if security_protocol in ("SASL_PLAINTEXT", "SASL_SSL"):
                producer_conf["sasl.mechanism"] = config.get("sasl_mechanism", "SCRAM-SHA-256")
                producer_conf["sasl.username"] = config.get("sasl_username", "")
                producer_conf["sasl.password"] = config.get("sasl_password", "")
            if config.get("compression_type"):
                producer_conf["compression.type"] = config["compression_type"]
            try:
                self.kafkaProducer = KafkaProducer(producer_conf)
            except Exception:
                logger.critical("Failed to initialise Kafka producer", exc_info=True, extra={"ctx": {"bootstrap_servers": config.get("bootstrap_servers")}})
                raise
            self.kafka_delivery_errors = 0

        self.dboverflow = 0
        self.backupFile = config["backupfile"]
        self.localbackup = config["localbackup"]
        if ((self.localbackup) and (self.backupFile is not None)):
            base_dir_env = os.environ.get("FILES_BASE_DIR")
            base_dir = Path(base_dir_env) if base_dir_env else Path(__file__).resolve().parent.parent
            self.backupFile = base_dir / self.backupFile
            self.create_db()

        logger.info("Post handler initialized", extra={"ctx": {
            "protocol": self.protocol,
            "local_backup": self.localbackup,
            "blocking": self.blocking
        }})

        self.bck_thread = threading.Thread(target=self.background)
        self.bck_thread.name = "mqtt_background_handler"
        self.bck_thread.daemon = True
        self.bck_thread.start()

        # Init Command Server
        if self.cmd_server_config and self.cmd_server_config.get("enabled", False):
            self._init_command_server(config)

    def _init_command_server(self, posting_config):
        cmd_type = self.cmd_server_config.get("type")
        if cmd_type == "mqtt":
            # Check for config match to reuse connection
            if posting_config["type"] == "mqtt" and \
               posting_config["host"] == self.cmd_server_config["host"] and \
               posting_config["port"] == self.cmd_server_config["port"] and \
               posting_config["username"] == self.cmd_server_config["username"] and \
               posting_config["password"] == self.cmd_server_config["password"]:
                # Reuse existing MQTT client
                pass # Handled in on_connect
            else:
                # Need dedicated MQTT connection (to be implemented if required)
                logger.warning("Dedicated MQTT command connection not implemented, reusing posting connection")
        elif cmd_type == "http":
            self.http_cmd_thread = threading.Thread(target=self._run_http_command_server)
            self.http_cmd_thread.daemon = True
            self.http_cmd_thread.start()

    def _run_http_command_server(self):
        port = self.cmd_server_config.get("port", 8080)
        path = self.cmd_server_config.get("path", "/write")
        handler_context = self # to pass into the handler

        class CommandHandler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass # Suppress default logging

            def do_POST(self):
                if self.path != path:
                    self.send_error(404, "Not Found")
                    return

                content_length = int(self.headers.get('Content-Length', 0))
                try:
                    body = self.rfile.read(content_length)
                    payload = json.loads(body.decode('utf-8'))
                except Exception:
                    logger.warning("Invalid JSON in HTTP command request", exc_info=True, extra={"ctx": {"path": path}})
                    self.send_error(400, "Bad Request: Invalid JSON")
                    return

                commands = payload.get("commands")
                if not isinstance(commands, list):
                    logger.warning("HTTP command request missing or invalid 'commands' field", extra={"ctx": {"path": path, "type": type(commands).__name__}})
                    self.send_error(400, "Bad Request: 'commands' must be a list")
                    return

                # Execute write batch sequentially blocking this HTTP thread
                status_code, response_body = handler_context.execute_write_batch(commands)

                self.send_response(status_code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(response_body).encode('utf-8'))

        try:
            self.cmd_httpd = socketserver.TCPServer(("", port), CommandHandler)
            logger.info("HTTP command server started", extra={"ctx": {"port": port, "path": path}})
            self.cmd_httpd.serve_forever()
        except Exception:
            logger.error("HTTP command server failed to start", exc_info=True, extra={"ctx": {"port": port}})

    def on_connect(self, client, userdata, flags, reason_code):
        logger.info("MQTT connected", extra={"ctx": {
            "host": self.host,
            "port": self.port,
            "reason_code": str(reason_code)
        }})

        # Command Server MQTT logic
        if self.cmd_server_config and self.cmd_server_config.get("enabled") and self.cmd_server_config.get("type") == "mqtt":
            topic = self.cmd_server_config.get("topic")
            if topic:
                try:
                    client.subscribe(topic)
                    logger.info("Subscribed to MQTT command topic", extra={"ctx": {"topic": topic}})
                except Exception:
                    logger.error("Failed to subscribe to MQTT command topic", exc_info=True, extra={"ctx": {"topic": topic}})

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        try:
            logger.info("Write command received", extra={"ctx": {"topic": topic}})

            # Check if this is the command server topic
            cmd_topic = self.cmd_server_config.get("topic")
            if self.cmd_server_config and self.cmd_server_config.get("enabled") and topic == cmd_topic:
                payload = json.loads(msg.payload.decode('utf-8'))
                commands = payload.get("commands", [])

                status_code, response_body = self.execute_write_batch(commands)

                resp_topic = self.cmd_server_config.get("response_topic")
                if resp_topic:
                    qos = self.cmd_server_config.get("qos", 0)
                    self.mqttObj.publish(topic=resp_topic, payload=json.dumps(response_body), qos=qos)

                success_count = sum(1 for r in response_body.get("results", []) if r.get("status") == 1)
                logger.info("Write batch completed", extra={"ctx": {
                    "topic": topic,
                    "status_code": status_code,
                    "success_count": success_count,
                    "total_commands": len(commands)
                }})

        except Exception as err:
            logger.error("Error processing MQTT message", exc_info=True, extra={"ctx": {"topic": topic}})
            resp_topic = self.cmd_server_config.get('response_topic') if self.cmd_server_config else None
            if resp_topic:
                self.mqttObj.publish(topic=resp_topic, payload=json.dumps({"error": str(err)}), qos=0)

    def execute_write_batch(self, commands):
        """
        Groups commands by server, locks, executes, and returns (HTTP_STATUS_CODE, response_dict).
        """
        logger.info("Executing write batch", extra={"ctx": {"command_count": len(commands)}})

        grouped = {}
        results = [{"status": 0, "error": "Unprocessed"} for _ in range(len(commands))]

        # 1. Group commands by server + resolve metadata
        for i, cmd in enumerate(commands):
            device_id = cmd.get("device_id")
            tag = cmd.get("tag")
            value = cmd.get("value")

            key = (device_id, tag)
            if key not in self.write_index:
                logger.warning("Write command references unknown device/tag", extra={"ctx": {"device_id": device_id, "tag": tag}})
                results[i] = {"status": 0, "error": f"Unknown device/tag: {device_id}/{tag}"}
                continue

            metadata = self.write_index[key]
            server_key = metadata['server']

            if server_key not in self.client_registry:
                logger.warning("Write command references unknown server", extra={"ctx": {"server": server_key}})
                results[i] = {"status": 0, "error": f"Unknown server: {server_key}"}
                continue

            if server_key not in grouped:
                grouped[server_key] = {"indices": [], "batch": []}

            grouped[server_key]["indices"].append(i)
            grouped[server_key]["batch"].append({
                "value": value,
                "metadata": metadata
            })

        # 2. Execute per group
        for server_key, group in grouped.items():
            try:
                opc_client = self.client_registry[server_key]
                batch_results = opc_client.write(group["batch"])

                # Map results back to original positions assuming exact same length
                for batch_idx, original_idx in enumerate(group["indices"]):
                    results[original_idx] = batch_results[batch_idx]
            except Exception:
                logger.error("Error executing write batch for server", exc_info=True, extra={"ctx": {"server": server_key}})
                for original_idx in group["indices"]:
                    results[original_idx] = {"status": 0, "error": "Internal execution error"}

        # 3. Determine Overall HTTP Status
        success_count = sum(1 for r in results if r.get("status") == 1)

        if success_count == len(commands) and len(commands) > 0:
            status_code = 200
        elif success_count > 0:
            status_code = 207 # Multi-Status
        elif sum(1 for r in results if "409 Resource Busy" in str(r.get("error"))) == len(commands) and len(commands) > 0:
            status_code = 409
        elif sum(1 for r in results if "Unknown device/tag" in str(r.get("error"))) == len(commands) and len(commands) > 0:
            status_code = 400
        else:
            status_code = 500

        # Construct final dict (can be expanded to match the HTTP return shape)
        return status_code, {"results": results}


    def stringPayload(self,payload):
        dataItems = payload["data"]
        newData = []
        for item in dataItems:
            for key,value in item.items():
                if key == "value":
                    item[key] = f'{value}'
                    newData.append(item)
        payload["data"] = newData
        return payload

    def _redpanda_topic(self, device_id):
        return "devicesIn." + device_id + ".data"

    def _redpanda_produce(self, topic, pay_str):
        def delivery_cb(err, msg):
            if err:
                logger.error("Redpanda delivery failure", extra={"ctx": {
                    "topic": msg.topic(),
                    "error": str(err)
                }})
                self.kafka_delivery_errors += 1
            else:
                self.kafka_delivery_errors = 0
        self.kafkaProducer.produce(topic, value=pay_str.encode("utf-8"), callback=delivery_cb)
        self.kafkaProducer.poll(0)

    def postOrBackup(self, payload):
        try:
            stat = 0

            if self.stringPosting == True:
                payload = self.stringPayload(payload)

            pay_str = json.dumps(payload)
            logger.debug("Posting payload", extra={"ctx": {
                "device": payload["device"],
                "tag_count": len(payload.get("data", []))
            }})
            topicStr = ""
            http_url = ""
            if self.localbackup:
                conn = sqlite3.connect(self.backupFile)
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM bck")
                count = cur.fetchone()[0]
                if self.protocol == "mqtt":
                    if self.mqttObj.is_connected():
                        if count == 0:
                            try:
                                topicStr = "devicesIn/" + payload["device"] + "/data"
                                self.mqttObj.publish(topic=topicStr, payload=pay_str, qos=self.qos)
                                logger.info("Data posted to MQTT", extra={"ctx": {
                                    "topic": topicStr,
                                    "device": payload["device"]
                                }})
                                stat = 1
                            except Exception:
                                stat = 2
                                logger.error("Error posting to MQTT", exc_info=True, extra={"ctx": {"topic": topicStr}})
                        else:
                            stat = 2
                    else:
                        stat = 2
                elif self.protocol == "http":
                    if count == 0:
                        try:
                            http_url = f"{self.host}:{self.port}{self.path}"
                            response = http.request(method=self.method, url=http_url, data=pay_str, headers=self.headers,timeout=self.timeout)
                            stat = 1 if response.status_code == 200 else 2
                            logger.info("Data posted via HTTP", extra={"ctx": {
                                "url": http_url,
                                "status_code": response.status_code,
                                "device": payload["device"]
                            }})
                        except Exception:
                            stat = 2
                            logger.error("Error posting via HTTP", exc_info=True, extra={"ctx": {"url": http_url}})
                    else:
                        stat = 2
                elif self.protocol == "redpanda":
                    if count == 0:
                        try:
                            topicStr = self._redpanda_topic(payload["device"])
                            self._redpanda_produce(topicStr, pay_str)
                            logger.info("Data posted to Redpanda", extra={"ctx": {
                                "topic": topicStr,
                                "device": payload["device"]
                            }})
                            stat = 1
                        except Exception:
                            stat = 2
                            logger.error("Error posting to Redpanda broker", exc_info=True)
                    else:
                        stat = 2
                else:
                    logger.error("postOrBackup: unrecognized protocol, payload not sent", extra={"ctx": {
                        "protocol": self.protocol,
                        "device": payload["device"]
                    }})

                if stat == 2:
                    file_size = os.path.getsize(self.backupFile)
                    if file_size > 5000000:
                        cur.execute('SELECT * FROM bck LIMIT 1')
                        row = cur.fetchone()
                        cur.execute("DELETE FROM bck WHERE id=?", (row[0],))
                        conn.commit()
                        logger.warning("Backup DB size exceeded limit, deleted oldest record", extra={"ctx": {
                            "file_size_bytes": file_size
                        }})
                        cur.execute("VACUUM")
                        conn.commit()
                    cur.execute("INSERT INTO bck (payload,topic) VALUES (?,?)", (pay_str, topicStr if self.protocol in ("mqtt", "redpanda") else http_url))
                    conn.commit()
                    logger.warning("Post failed, payload saved to backup DB", extra={"ctx": {
                        "device": payload["device"],
                        "protocol": self.protocol
                    }})
                cur.close()
                conn.close()

            else:
                if self.protocol == "mqtt":
                    try:
                        topicStr = "devicesIn/" + payload["device"] + "/data"
                        self.mqttObj.publish(topic=topicStr, payload=pay_str, qos=self.qos)
                        logger.info("Data posted to MQTT", extra={"ctx": {
                            "topic": topicStr,
                            "device": payload["device"]
                        }})
                    except Exception:
                        logger.error("Error posting to MQTT", exc_info=True, extra={"ctx": {"topic": topicStr}})
                elif self.protocol == "http":
                    try:
                        http_url = f"{self.host}:{self.port}{self.path}"
                        response = http.request(method=self.method, url=http_url, data=pay_str, headers=self.headers,timeout=self.timeout)
                        logger.info("Data posted via HTTP", extra={"ctx": {
                            "url": http_url,
                            "status_code": response.status_code,
                            "device": payload["device"]
                        }})
                    except Exception:
                        logger.error("Error posting via HTTP", exc_info=True, extra={"ctx": {"url": http_url}})
                elif self.protocol == "redpanda":
                    try:
                        topicStr = self._redpanda_topic(payload["device"])
                        self._redpanda_produce(topicStr, pay_str)
                        logger.info("Data posted to Redpanda", extra={"ctx": {
                            "topic": topicStr,
                            "device": payload["device"]
                        }})
                    except Exception:
                        logger.error("Error posting to Redpanda broker", exc_info=True)
                else:
                    logger.error("postOrBackup: unrecognized protocol, payload not sent", extra={"ctx": {
                        "protocol": self.protocol,
                        "device": payload["device"]
                    }})

            return stat
        except Exception:
            logger.error("Unexpected error in postOrBackup", exc_info=True)

    def postBackup(self, batch_count):
        try:
            conn = sqlite3.connect(self.backupFile)
            cur = conn.cursor()
            cur.execute("SELECT * FROM bck LIMIT " + str(batch_count))
            rows = cur.fetchall()
            if rows:
                logger.info("Recovering backed-up payloads", extra={"ctx": {
                    "count": len(rows),
                    "protocol": self.protocol
                }})
            for row in rows:
                time.sleep(0.01)
                if self.protocol == "mqtt":
                    self.mqttObj.publish(topic=row[2], payload=row[1], qos=self.qos)
                elif self.protocol == "http":
                    http.request(method=self.method, url=row[2], data=row[1], headers=self.headers,timeout=self.timeout)
                elif self.protocol == "redpanda":
                    self._redpanda_produce(row[2], row[1])
                cur.execute("DELETE FROM bck WHERE id=?", (row[0],))
                conn.commit()
            cur.execute("VACUUM")
            conn.commit()
            cur.close()
            conn.close()
        except Exception:
            logger.error("Error in postBackup (local backup recovery)", exc_info=True)

    def background(self):
        logger.info("Posting background thread started", extra={"ctx": {"protocol": self.protocol}})
        while not self.stop_event.is_set():
            try:
                k=0

                while not self.data_queue.empty():
                    k=k+1
                    self.postOrBackup(self.data_queue.get())
                    time.sleep(0.05)

                if k > 0:
                    logger.debug("Queue drain complete", extra={"ctx": {"items_processed": k}})

                if self.protocol == 'mqtt':
                    rc = self.mqttObj.loop(timeout=1.0)
                    if self.localbackup and self.mqttObj.is_connected():
                        self.postBackup(100)
                    if rc != 0:
                        try:
                            logger.warning("MQTT disconnected in background loop, attempting reconnect")
                            self.mqttObj.connect(self.host, self.port, self.keepalive)
                        except Exception:
                            logger.error("Error reconnecting to MQTT broker", exc_info=True)
                elif self.protocol == 'redpanda':
                    try:
                        self.kafkaProducer.poll(0)
                    except Exception:
                        logger.error("Error polling Kafka producer", exc_info=True)
                    if self.localbackup and self.kafka_delivery_errors == 0:
                        self.postBackup(100)
                    time.sleep(0.1)
                else:
                    time.sleep(1)
            except Exception:
                logger.error("Unexpected exception in background posting loop, continuing", exc_info=True)
                time.sleep(1)

        logger.info("Posting background thread stopping")

    def create_db(self):
        try:
            conn = sqlite3.connect(self.backupFile)
            cur = conn.cursor()
            cur.execute('''CREATE TABLE IF NOT EXISTS bck (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            payload TEXT NOT NULL,
                            topic TEXT NOT NULL)''')
            conn.commit()
            conn.close()
        except Exception:
            logger.error("Failed to create backup DB, local backup disabled", exc_info=True, extra={"ctx": {
                "backup_file": str(self.backupFile)
            }})
            self.localbackup = False

    def close(self):
        self.stop_event.set()
        self.bck_thread.join(timeout=5)
        if hasattr(self, 'cmd_httpd'):
            try:
                 self.cmd_httpd.shutdown()
                 self.cmd_httpd.server_close()
            except Exception:
                 logger.warning("Error shutting down HTTP command server", exc_info=True)
        if self.protocol == "mqtt" and hasattr(self, 'mqttObj'):
            self.mqttObj.disconnect()
        elif self.protocol == "redpanda":
            self.kafkaProducer.flush(timeout=5)
        logger.info("Post handler closed", extra={"ctx": {"protocol": self.protocol}})

    def post(self,datapacket):
        if self.blocking:
            self.postOrBackup(datapacket)
        else:
            self.data_queue.put(datapacket)
