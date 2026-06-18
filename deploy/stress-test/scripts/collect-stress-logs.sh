#!/bin/sh
set -eu

OUT_DIR=${1:-/var/log/zd-stress-test/collected-$(date +%Y%m%d-%H%M%S)}
sudo mkdir -p "$OUT_DIR"

sudo journalctl -u zd-stress-agent.service > "$OUT_DIR/systemd-agent.txt" || true
sudo journalctl -u zd-electron-demo.service > "$OUT_DIR/systemd-electron.txt" || true

echo "Collected logs into $OUT_DIR"
