# ==============================================================================
# metrics.py — Prometheus Metrics (Python, identical across all adapters)
#
# Copy this file for a new Python protocol adapter. Only the metric name
# prefix needs changing. Search for "sql_" and replace it with your
# protocol slug (e.g. "modbus_", "s7_", "myproto_").
#
# All 10 metric names are set in __init__ below. Changing the prefix here
# automatically updates the Grafana dashboard — remember to update the
# dashboard PromQL expressions to match (see monitoring/grafana/).
# ==============================================================================
from prometheus_client import start_http_server, Histogram, Counter, Gauge
import threading
from logger import get_logger

logger = get_logger(__name__)

class Metrics:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(Metrics, cls).__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # ── High-Resolution Buckets ───────────────────────────────────────────
        self.latency_buckets = [
            1, 2, 5, 10, 25, 50, 75, 100, 125, 150, 175, 200, 225,
            250, 275, 300, 375, 400, 425, 450, 475, 500, 1000, 2500, 5000
        ]
        self.jitter_buckets = self.latency_buckets
        self.cycle_dur_buckets = self.latency_buckets

        # ── Histograms ──
        # REPLACE: change all "sql_" prefixes below to your protocol slug (e.g. "modbus_", "s7_", "myproto_")
        self.latency_family = Histogram(
            'sql_poll_latency_ms',
            'Time spent in a single OPC UA read() call (milliseconds)',
            labelnames=['server', 'device_id', 'poll_rate_ms'],
            buckets=self.latency_buckets
        )

        self.jitter_family = Histogram(
            'sql_poll_jitter_ms',
            'Absolute deviation of actual poll interval from configured rate (milliseconds)',
            labelnames=['server', 'poll_rate_ms'],
            buckets=self.jitter_buckets
        )

        self.cycle_dur_family = Histogram(
            'sql_poll_cycle_duration_ms',
            'Total time for a complete poll cycle across all packets in a rate group (milliseconds)',
            labelnames=['server', 'poll_rate_ms'],
            buckets=self.cycle_dur_buckets
        )

        # ── Counters ──
        self.tags_family = Counter(
            'sql_tags_polled_total',
            'Total number of OPC UA tags read',
            labelnames=['server', 'device_id', 'poll_rate_ms', 'status']
        )

        self.requests_family = Counter(
            'sql_poll_requests_total',
            'Total number of OPC UA poll requests issued',
            labelnames=['server', 'device_id', 'poll_rate_ms', 'result']
        )

        # ── Gauges ──
        self.conn_status_family = Gauge(
            'sql_connection_status',
            'OPC UA connection status (1=connected, 0=disconnected)',
            labelnames=['server']
        )

        self.latency_peak_family = Gauge(
            'sql_poll_latency_peak_ms',
            'Lifetime peak (max) poll latency in milliseconds (resets on process restart)',
            labelnames=['server', 'device_id', 'poll_rate_ms']
        )

        self.latency_min_family = Gauge(
            'sql_poll_latency_min_ms',
            'Lifetime minimum poll latency in milliseconds (resets on process restart)',
            labelnames=['server', 'device_id', 'poll_rate_ms']
        )

        self.jitter_peak_family = Gauge(
            'sql_poll_jitter_peak_ms',
            'Lifetime peak (max) poll jitter in milliseconds (resets on process restart)',
            labelnames=['server', 'poll_rate_ms']
        )

        self.jitter_min_family = Gauge(
            'sql_poll_jitter_min_ms',
            'Lifetime minimum poll jitter in milliseconds (resets on process restart)',
            labelnames=['server', 'poll_rate_ms']
        )

        self._initialized = True

    def start(self, port=9464):
        start_http_server(port)
        logger.info("Prometheus metrics server started", extra={"ctx": {"port": port}})

    # ── Histogram observations ───────────────────────────────────────────────

    def observe_latency(self, server, device_id, poll_rate_ms, value_ms):
        self.latency_family.labels(
            server=server, device_id=device_id, poll_rate_ms=poll_rate_ms
        ).observe(value_ms)

    def observe_jitter(self, server, poll_rate_ms, value_ms):
        self.jitter_family.labels(
            server=server, poll_rate_ms=poll_rate_ms
        ).observe(value_ms)

    def observe_cycle_duration(self, server, poll_rate_ms, value_ms):
        self.cycle_dur_family.labels(
            server=server, poll_rate_ms=poll_rate_ms
        ).observe(value_ms)

    # ── Counter increments ───────────────────────────────────────────────────

    def inc_tags_polled(self, server, device_id, poll_rate_ms, status, count=1):
        self.tags_family.labels(
            server=server, device_id=device_id, poll_rate_ms=poll_rate_ms, status=status
        ).inc(count)

    def inc_poll_requests(self, server, device_id, poll_rate_ms, result):
        self.requests_family.labels(
            server=server, device_id=device_id, poll_rate_ms=poll_rate_ms, result=result
        ).inc()

    # ── Gauge ────────────────────────────────────────────────────────────────

    def set_connection_status(self, server, value):
        self.conn_status_family.labels(server=server).set(value)

    def update_latency_peak(self, server, device_id, poll_rate_ms, value_ms):
        gauge = self.latency_peak_family.labels(
            server=server, device_id=device_id, poll_rate_ms=poll_rate_ms
        )
        if value_ms > gauge._value.get():
            gauge.set(value_ms)

    def update_latency_min(self, server, device_id, poll_rate_ms, value_ms):
        gauge = self.latency_min_family.labels(
            server=server, device_id=device_id, poll_rate_ms=poll_rate_ms
        )
        current = gauge._value.get()
        if current == 0.0 or value_ms < current:
            gauge.set(value_ms)

    def update_jitter_peak(self, server, poll_rate_ms, value_ms):
        gauge = self.jitter_peak_family.labels(
            server=server, poll_rate_ms=poll_rate_ms
        )
        if value_ms > gauge._value.get():
            gauge.set(value_ms)

    def update_jitter_min(self, server, poll_rate_ms, value_ms):
        gauge = self.jitter_min_family.labels(
            server=server, poll_rate_ms=poll_rate_ms
        )
        current = gauge._value.get()
        if current == 0.0 or value_ms < current:
            gauge.set(value_ms)

    def init_device_counters(self, server, device_id, poll_rate_ms):
        """Pre-initialize counters so 'bad' status exists with 0 from start."""
        self.tags_family.labels(
            server=server, device_id=device_id, poll_rate_ms=poll_rate_ms, status='bad'
        ).inc(0)
        self.tags_family.labels(
            server=server, device_id=device_id, poll_rate_ms=poll_rate_ms, status='good'
        ).inc(0)

metrics = Metrics()
