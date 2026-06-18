#!/bin/sh
set -eu

sudo systemctl start zd-stress-agent.service

echo "stress-agent started."
echo "Start Electron manually with:"
echo "  /usr/bin/electron-pure-kehua-zero"
echo "Optional Electron service:"
echo "  sudo systemctl start zd-electron-demo.service"
