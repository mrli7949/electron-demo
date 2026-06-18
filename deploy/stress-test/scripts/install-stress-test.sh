#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

sudo mkdir -p /opt/zd-stress-test/stress-agent-server
sudo mkdir -p /etc/zd-stress-test
sudo mkdir -p /var/log/zd-stress-test

if [ -f "$DEPLOY_DIR/../../../zd-test-client/stress-agent-server/dist/stress-agent-server-linux-arm64" ]; then
  sudo cp "$DEPLOY_DIR/../../../zd-test-client/stress-agent-server/dist/stress-agent-server-linux-arm64" /opt/zd-stress-test/stress-agent-server/
fi

sudo cp "$DEPLOY_DIR/systemd/zd-stress-agent.service" /etc/systemd/system/
sudo cp "$DEPLOY_DIR/systemd/zd-electron-demo.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl disable zd-stress-agent.service >/dev/null 2>&1 || true
sudo systemctl disable zd-electron-demo.service >/dev/null 2>&1 || true

echo "Installed stress test services. They are not enabled for boot."
