# 压力测试部署说明

这个目录里的服务只用于手动压力测试。默认不要把它们设置为开机自启，避免影响正常演示或生产运行。

## 安装

```bash
./scripts/install-stress-test.sh
```

安装脚本会把 systemd 服务文件复制到 `/etc/systemd/system/`，并尝试把压力测试 agent 程序复制到 `/opt/zd-stress-test/stress-agent-server/`。

## 启动 stress-agent

```bash
./scripts/start-stress-test.sh
```

手动启动 Electron：

```bash
/usr/bin/electron-pure-kehua-zero
```

如果希望 systemd 同时托管压力测试版 Electron，可以执行：

```bash
sudo systemctl start zd-electron-demo.service
```

## 两个 service 的用途

`systemd/zd-stress-agent.service`：

- 启动压力测试 agent server。
- 默认监听 `127.0.0.1:18080`。
- 日志根目录是 `/var/log/zd-stress-test`。
- Electron 内部的 stress watchdog 会通过 `ZD_STRESS_AGENT=http://127.0.0.1:18080` 访问它。

`systemd/zd-electron-demo.service`：

- 压力测试专用 Electron 启动服务。
- 依赖 `zd-stress-agent.service`，启动它时会先启动 agent。
- 设置 `ZD_STRESS_AGENT` 和 `ZD_STRESS_LOG_ROOT`，让 Electron 压力测试模块能找到 agent 和日志目录。
- 它不是正式运行服务；正式运行当前使用 `electron-zzcd-watchdog.service`。

## 停止

```bash
./scripts/stop-stress-test.sh
```

## 收集日志

```bash
./scripts/collect-stress-logs.sh
```
