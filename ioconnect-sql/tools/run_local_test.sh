#!/bin/bash
# ==============================================================================
# run_local_test.sh — one-command end-to-end test of the SQL adapter against the
# built-in local test database (no real SQL connection needed).
#
# It:
#   1. makes sure the local test DB (factory.Pipes) exists
#   2. starts a tiny HTTP receiver that prints whatever the adapter posts
#   3. runs the adapter once  -> reads existing rows, posts them
#   4. inserts 3 new rows      -> simulates live data
#   5. runs the adapter again  -> posts ONLY the new rows (incremental)
#
# Usage:  bash tools/run_local_test.sh
# ==============================================================================
set -e
cd "$(dirname "$0")/.."               # -> ioconnect-sql/
PY=./venv/bin/python
SOCK=/var/run/mysqld/mysqld.sock

echo "──────────────────────────────────────────────────────────────"
echo "STEP 1  Ensure the local test database exists"
echo "──────────────────────────────────────────────────────────────"
sudo mysql --socket="$SOCK" >/dev/null 2>&1 <<'SQL'
CREATE DATABASE IF NOT EXISTS factory;
CREATE USER IF NOT EXISTS 'iosense'@'127.0.0.1' IDENTIFIED BY 'iosense_pw';
GRANT ALL PRIVILEGES ON factory.* TO 'iosense'@'127.0.0.1'; FLUSH PRIVILEGES;
USE factory;
CREATE TABLE IF NOT EXISTS Pipes (
  id INT AUTO_INCREMENT PRIMARY KEY, reading_ts DATETIME(3) NOT NULL,
  pipe_id INT NOT NULL, flow_min DOUBLE NOT NULL, flow_max DOUBLE NOT NULL, INDEX idx_ts (reading_ts));
INSERT INTO Pipes (reading_ts,pipe_id,flow_min,flow_max)
  SELECT '2026-07-02 09:00:00.000',11,1.111,9.911
  WHERE NOT EXISTS (SELECT 1 FROM Pipes);
SQL
echo "  rows currently in factory.Pipes: $(sudo mysql --socket="$SOCK" -N -e 'SELECT COUNT(*) FROM factory.Pipes;')"

echo "──────────────────────────────────────────────────────────────"
echo "STEP 2  Start the HTTP receiver (stand-in for the platform)"
echo "──────────────────────────────────────────────────────────────"
# make sure posting[0] = http so we can see the output locally
$PY - <<'PY'
import json; p="data/sys_parameters.json"; d=json.load(open(p))
d["posting"].sort(key=lambda x: 0 if x["type"]=="http" else 1)
json.dump(d, open(p,"w"), indent=2)
PY
pkill -f "tools/http_sink.py" 2>/dev/null || true
rm -f tools/sink.log
$PY tools/http_sink.py 8001 tools/sink.log &
SINK_PID=$!
sleep 1

show_payloads () { cat tools/sink.log 2>/dev/null | $PY -c "import sys,json;[print('   ',json.dumps(json.loads(l)['payload'])) for l in sys.stdin]"; }

echo "──────────────────────────────────────────────────────────────"
echo "STEP 3  Run the adapter — reads the DB, posts every row"
echo "──────────────────────────────────────────────────────────────"
rm -f data/history.json
FILES_BASE_DIR=./data METRICS_PORT=9470 timeout 8 $PY src/app.py 2>&1 | grep -iE "SQL connected|Rows read|Rows queued" | sed 's/^/  /' || true
echo "  → receiver got:"; show_payloads

echo "──────────────────────────────────────────────────────────────"
echo "STEP 4  Insert 3 NEW rows (simulate live data)"
echo "──────────────────────────────────────────────────────────────"
$PY tools/db_insert.py 3 5 | sed 's/^/  /'
rm -f tools/sink.log

echo "──────────────────────────────────────────────────────────────"
echo "STEP 5  Run again — posts ONLY the new rows (incremental)"
echo "──────────────────────────────────────────────────────────────"
FILES_BASE_DIR=./data METRICS_PORT=9470 timeout 8 $PY src/app.py 2>&1 | grep -iE "Rows read|Rows queued" | sed 's/^/  /' || true
echo "  → receiver got (only the new rows):"; show_payloads

kill $SINK_PID 2>/dev/null || true
echo "──────────────────────────────────────────────────────────────"
echo "DONE.  history.json now remembers how far it read:"
cat data/history.json; echo
echo "──────────────────────────────────────────────────────────────"
