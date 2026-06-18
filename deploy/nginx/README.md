# nginx 静态前端部署

这个目录记录 `zd-test-client` 前端在开发板上的 nginx 部署方式。目标是让 Electron 不再通过 `file://` 读取前端包，而是固定加载：

```text
http://127.0.0.1:18088/index.html
```

这样 `/config/...`、axios `baseURL: '/'`、多页面入口和静态资源都会按普通 Web 站点规则解析。

## 目录约定

```text
/opt/zd-test-client/www      # 前端 dist 解压后的站点根目录
/etc/nginx/sites-available/zd-test-client.conf
/etc/nginx/sites-enabled/zd-test-client.conf
```

## 板子上安装 nginx 站点

先确保板子已安装 nginx：

```bash
apt-get update
apt-get install -y nginx
```

复制本目录的 `zd-test-client-nginx.conf` 到板子后执行：

```bash
cp zd-test-client-nginx.conf /etc/nginx/sites-available/zd-test-client.conf
ln -sf /etc/nginx/sites-available/zd-test-client.conf /etc/nginx/sites-enabled/zd-test-client.conf
nginx -t
systemctl enable nginx
systemctl restart nginx
```

## 部署前端包

在 Mac 本地构建 `zd-test-client`：

```bash
cd /Users/lishaoguang/Documents/client-demo/zd-test-client
npm run build
tar -czf /tmp/zd-test-client-dist.tar.gz -C dist .
scp /tmp/zd-test-client-dist.tar.gz root@192.168.10.2:/tmp/
```

在板子上解压：

```bash
mkdir -p /opt/zd-test-client/www
rm -rf /opt/zd-test-client/www/*
tar -xzf /tmp/zd-test-client-dist.tar.gz -C /opt/zd-test-client/www
chown -R root:root /opt/zd-test-client
chmod -R a+rX /opt/zd-test-client/www
nginx -t
systemctl restart nginx
```

## 验证

```bash
curl -I http://127.0.0.1:18088/index.html
curl -I http://127.0.0.1:18088/config/generatedConfigRender/simpleNav.json
systemctl status nginx --no-pager
```

Electron 服务启动后会直接访问 nginx：

```bash
systemctl restart electron-zzcd-watchdog
journalctl -u electron-zzcd-watchdog -f
```

