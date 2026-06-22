# Electron Demo 部署资料

这个目录保存板子侧部署需要的配置、脚本和说明。当前正式运行链路是：

1. nginx 提供 `zd-test-client` 静态前端。
2. Electron 从 `http://127.0.0.1:18088/index.html` 加载页面。
3. systemd 通过 `electron-zzcd-watchdog.service` 托管 Electron 进程，并在进程退出后自动拉起。

## 目录说明

`electron-zzcd-watchdog/`

正式运行使用的 Electron systemd 服务。包含：

- `electron-zzcd-watchdog.service`：板子上的正式 Electron 服务文件。
- `README.md`：安装、更新、停止、日志查看和自动拉起策略说明。

`nginx/`

`zd-test-client` 静态站点的 nginx 部署资料。Electron 当前依赖这里提供的本地 HTTP 服务。

`gpu-access-control/`

限制 Electron 访问 GPU 设备的方案记录。当前只做计划，不包含可执行实现。

`stress-test/`

压力测试专用部署资料。这里的 `zd-stress-agent.service` 和 `zd-electron-demo.service` 只用于手动压测，不是当前正式开机运行服务。

## 常用顺序

先部署前端静态文件和 nginx：

```sh
sudo mkdir -p /opt/zd-test-client/www
sudo tar -xzf /tmp/zd-test-client-dist.tar.gz -C /opt/zd-test-client/www
sudo cp nginx/zd-test-client-nginx.conf /etc/nginx/sites-available/zd-test-client.conf
sudo ln -sf /etc/nginx/sites-available/zd-test-client.conf /etc/nginx/sites-enabled/zd-test-client.conf
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

再部署 Electron 包和正式服务：

```sh
sudo systemctl stop electron-zzcd-watchdog || true
sudo mkdir -p /opt
if [ -d /opt/electron-demo ]; then
  sudo mv /opt/electron-demo "/opt/electron-demo.bak.$(date +%Y%m%d-%H%M%S)"
fi
sudo tar -xzf /tmp/electron-pure-kehua-zero-linux-arm64.tar.gz -C /opt
sudo mv /opt/electron-pure-kehua-zero-linux-arm64 /opt/electron-demo
sudo chmod +x /opt/electron-demo/electron-pure-kehua-zero
sudo chown root:root /opt/electron-demo/chrome-sandbox
sudo chmod 4755 /opt/electron-demo/chrome-sandbox
sudo cp electron-zzcd-watchdog/electron-zzcd-watchdog.service /etc/systemd/system/electron-zzcd-watchdog.service
sudo systemctl daemon-reload
sudo systemctl enable electron-zzcd-watchdog
sudo systemctl restart electron-zzcd-watchdog
```

更多服务细节见 `electron-zzcd-watchdog/README.md`。
