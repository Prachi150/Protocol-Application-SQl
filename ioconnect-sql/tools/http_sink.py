#!/usr/bin/env python3
"""Tiny HTTP sink for testing the SQL adapter's HTTP posting backend.

Listens on 127.0.0.1:<port> (default 8001), accepts POSTed JSON payloads,
appends each to <outfile> (default tools/sink.log), and prints a one-line
summary. Point sys_parameters.json posting[0] at http://127.0.0.1:8001/.

Usage: python tools/http_sink.py [port] [outfile]
"""
import http.server
import json
import sys
import datetime

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
OUTFILE = sys.argv[2] if len(sys.argv) > 2 else "tools/sink.log"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # silence default logging

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        try:
            payload = json.loads(body)
        except Exception:
            payload = {"_raw": body.decode("utf-8", "replace")}
        record = {"recv_at": datetime.datetime.now().isoformat(), "payload": payload}
        with open(OUTFILE, "a") as f:
            f.write(json.dumps(record) + "\n")
        dev = payload.get("device") if isinstance(payload, dict) else "?"
        print(f"SINK << device={dev} {json.dumps(payload, default=str)}", flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


if __name__ == "__main__":
    print(f"HTTP sink listening on 127.0.0.1:{PORT}, writing {OUTFILE}", flush=True)
    http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
