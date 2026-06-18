#!/bin/sh
set -eu

curl -fsS -X POST http://127.0.0.1:18080/stress/stop >/dev/null 2>&1 || true
sudo systemctl stop zd-electron-demo.service >/dev/null 2>&1 || true
sudo systemctl stop zd-stress-agent.service >/dev/null 2>&1 || true

echo "stress test stopped."
