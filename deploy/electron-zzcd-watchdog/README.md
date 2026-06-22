# 正式 Electron 看门狗服务

`electron-zzcd-watchdog.service` 是板子上正式运行 Electron 的 systemd 服务文件。它负责：

- 开机进入图形环境后启动 Electron。
- Electron 主进程退出后自动重新拉起。
- 通过 systemd cgroup 限制 Electron 进程组内存。
- 提供统一的 `systemctl` 和 `journalctl` 运维入口。

这个服务和 `deploy/stress-test/` 下的压测服务不是一回事。当前正式服务只启动 `/opt/electron-demo/electron-pure-kehua-zero`，不会启动压力测试 agent。

## 服务行为

服务核心配置：

```ini
WorkingDirectory=/opt/electron-demo
ExecStart=/opt/electron-demo/electron-pure-kehua-zero
Restart=always
RestartSec=3
MemoryHigh=470M
MemoryMax=500M
OOMPolicy=stop
```

`Restart=always` 表示只要 Electron 主进程结束，systemd 就会在 `RestartSec=3` 后重新启动它。因此手动关闭 Electron 窗口时，应用会退出，systemd 随后会把它重新拉起。

如果希望“崩溃自动拉起，但正常关闭窗口不自动拉起”，可以把服务里的重启策略改成：

```ini
Restart=on-failure
```

## 和应用内部 watchdog 的关系

这里有两层保护：

- systemd 服务：负责 Electron 主进程退出后的整进程重启。
- Electron 应用内部 watchdog：负责 renderer 心跳、卡死、崩溃、内存检测，优先重建当前 `WebContentsView`。

当 renderer 内存达到硬恢复阈值时，应用会主动退出当前进程，交给 systemd 重新拉起。`index.js` 里的内存阈值需要和本服务文件的 `MemoryHigh`、`MemoryMax` 保持一致。

## 安装或更新

确认 Electron 已部署到：

```sh
/opt/electron-demo
```

确认前端 nginx 已能访问：

```sh
curl -I http://127.0.0.1:18088/index.html
```

安装服务：

```sh
sudo cp electron-zzcd-watchdog.service /etc/systemd/system/electron-zzcd-watchdog.service
sudo systemctl daemon-reload
sudo systemctl enable electron-zzcd-watchdog
sudo systemctl restart electron-zzcd-watchdog
```

更新 Electron 包时建议先停服务，再替换 `/opt/electron-demo`：

```sh
sudo systemctl stop electron-zzcd-watchdog || true
if [ -d /opt/electron-demo ]; then
  sudo mv /opt/electron-demo "/opt/electron-demo.bak.$(date +%Y%m%d-%H%M%S)"
fi
sudo tar -xzf /tmp/electron-pure-kehua-zero-linux-arm64.tar.gz -C /opt
sudo mv /opt/electron-pure-kehua-zero-linux-arm64 /opt/electron-demo
sudo chmod +x /opt/electron-demo/electron-pure-kehua-zero
sudo chown root:root /opt/electron-demo/chrome-sandbox
sudo chmod 4755 /opt/electron-demo/chrome-sandbox
sudo systemctl restart electron-zzcd-watchdog
```

如果从 `deploy` 根目录执行，则复制命令是：

```sh
sudo cp electron-zzcd-watchdog/electron-zzcd-watchdog.service /etc/systemd/system/electron-zzcd-watchdog.service
```

## 常用命令

查看状态：

```sh
systemctl status electron-zzcd-watchdog
```

实时查看日志：

```sh
journalctl -u electron-zzcd-watchdog -f
```

重启服务：

```sh
sudo systemctl restart electron-zzcd-watchdog
```

临时停止服务，不会被 `Restart=always` 立即拉起：

```sh
sudo systemctl stop electron-zzcd-watchdog
```

禁止开机自启：

```sh
sudo systemctl disable electron-zzcd-watchdog
```

重新启用开机自启：

```sh
sudo systemctl enable electron-zzcd-watchdog
```

## 手动启动 Electron

调试时可以绕过 systemd 手动启动：

```sh
cd /opt/electron-demo
DISPLAY=:0 \
XAUTHORITY=/home/firefly/.Xauthority \
XDG_RUNTIME_DIR=/run/user/1000 \
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
./electron-pure-kehua-zero
```

手动启动前建议先停掉 systemd 服务，避免单实例锁冲突：

```sh
sudo systemctl stop electron-zzcd-watchdog
```
