# Electron ZZCD Watchdog Service

`electron-zzcd-watchdog.service` is a Linux systemd template for the board.
It provides boot startup, process restart, and cgroup memory limits for Electron.

Install on the board after adjusting `User`, `Group`, `WorkingDirectory`,
`ExecStart`, `DISPLAY`, and `XAUTHORITY`:

```sh
sudo cp electron-zzcd-watchdog.service /etc/systemd/system/electron-zzcd-watchdog.service
sudo systemctl daemon-reload
sudo systemctl enable electron-zzcd-watchdog
sudo systemctl start electron-zzcd-watchdog
```

Useful commands:

```sh
systemctl status electron-zzcd-watchdog
journalctl -u electron-zzcd-watchdog -f
sudo systemctl restart electron-zzcd-watchdog
sudo systemctl stop electron-zzcd-watchdog
sudo systemctl disable electron-zzcd-watchdog
```
