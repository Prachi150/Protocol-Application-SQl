#!/usr/bin/env python3
"""Insert N new rows into factory.Pipes to simulate live data.

Each new row's reading_ts is (current max reading_ts + step_seconds), so the
timestamps advance monotonically regardless of wall-clock — which is exactly
what the adapter's incremental WHERE ts > last_read_time relies on.

Usage: python tools/db_insert.py [count] [step_seconds]
"""
import sys
import pyodbc
from datetime import timedelta

COUNT = int(sys.argv[1]) if len(sys.argv) > 1 else 1
STEP = int(sys.argv[2]) if len(sys.argv) > 2 else 5

CONN = ("DRIVER={MariaDB Unicode};SERVER=127.0.0.1;PORT=3306;"
        "DATABASE=factory;UID=iosense;PWD=iosense_pw;OPTION=3;")

conn = pyodbc.connect(CONN)
cur = conn.cursor()
cur.execute("SELECT MAX(reading_ts) FROM `Pipes`")
last = cur.fetchone()[0]

for i in range(1, COUNT + 1):
    last = last + timedelta(seconds=STEP)
    pipe_id = 100 + i
    flow_min = round(10 + i * 0.5, 3)
    flow_max = round(90 + i * 0.5, 3)
    cur.execute(
        "INSERT INTO `Pipes` (reading_ts, pipe_id, flow_min, flow_max) VALUES (?, ?, ?, ?)",
        [last, pipe_id, flow_min, flow_max],
    )
    print(f"inserted reading_ts={last} pipe_id={pipe_id} flow_min={flow_min} flow_max={flow_max}")

conn.commit()
conn.close()
