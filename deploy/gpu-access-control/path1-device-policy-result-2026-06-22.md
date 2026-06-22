# 路径 1 实测记录：systemd DevicePolicy 限制 Electron GPU 访问

测试日期：2026-06-22

测试设备：rk3568 arm 开发板

测试目标：验证不修改 Electron 业务代码、不关闭系统 GPU/DRM 显示栈的前提下，是否可以只限制 `electron-zzcd-watchdog.service` 启动的 Electron 进程访问 GPU 设备节点。

## 结论

路径 1 生效。

通过 systemd drop-in 为 `electron-zzcd-watchdog.service` 配置 `DevicePolicy=closed` 后，Electron 服务可以正常启动并保持运行，且 Electron 进程组不再打开 `/dev/dri/*` 或 `/dev/mali0`。

这个结果表示：当前方案可以限制正式 Electron 服务访问 GPU 设备节点。它不是系统级禁用 GPU，系统桌面、X11、HDMI、DRM/KMS 以及其他进程仍可能继续使用 GPU。

## 前置状态

开发板检测到的 GPU/DRM 设备：

```text
/dev/mali0
/dev/dri/card0
/dev/dri/card1
/dev/dri/renderD128
/dev/dri/renderD129
/sys/devices/platform/fde60000.gpu
```

Electron 代码中已有软件侧 GPU 开关：

```js
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
```

但仅靠上述 Electron/Chromium 开关时，运行中的 Electron 仍会打开 GPU/DRM 设备。

## 基线检查

先停掉手动或桌面启动的 Electron，再通过正式 systemd 服务启动：

```sh
pkill -TERM -f '^/opt/electron-demo/electron-pure-kehua-zero' || true
systemctl start electron-zzcd-watchdog
```

切换到 systemd 托管后的基线状态：

```text
electron-zzcd-watchdog.service: active/running
MainPID=29752
ControlGroup=/system.slice/electron-zzcd-watchdog.service
```

基线 GPU fd 检查结果：

```text
29782 gpu-process -> /dev/dri/renderD128
29787 broker      -> /dev/dri/renderD128
```

说明：在未加入 `DevicePolicy` 限制时，即使 Electron 已配置 `disable-gpu`，Electron 子进程仍会打开 `/dev/dri/renderD128`。

## 实施配置

drop-in 文件路径：

```text
/etc/systemd/system/electron-zzcd-watchdog.service.d/gpu-access-control.conf
```

实测配置内容：

```ini
[Service]
# GPU access experiment path 1: close the service device cgroup and allow only basic runtime devices.
DevicePolicy=closed
DeviceAllow=/dev/null rw
DeviceAllow=/dev/zero rw
DeviceAllow=/dev/full rw
DeviceAllow=/dev/random r
DeviceAllow=/dev/urandom r
DeviceAllow=/dev/tty rw
DeviceAllow=/dev/ptmx rw
DeviceAllow=/dev/pts/ptmx rw
```

应用配置：

```sh
systemctl daemon-reload
systemctl restart electron-zzcd-watchdog
```

## 验证结果

服务状态：

```text
SubState=running
Result=success
ExecMainStatus=0
NRestarts=0
DevicePolicy=closed
DropInPaths=/etc/systemd/system/electron-zzcd-watchdog.service.d/gpu-access-control.conf
```

30 秒稳定性复查：

```text
MainPID=30215
SubState=running
Result=success
NRestarts=0
MemoryCurrent=153137152
```

GPU fd 复查结果：

```text
gpu fd targets: none
```

验证命令：

```sh
for pid in $(pgrep -f '^/opt/electron-demo/electron-pure-kehua-zero'); do
  hits=$(find /proc/"$pid"/fd -lname '/dev/dri/*' -o -lname '/dev/mali0' 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "-- $pid --"
    for fd in $hits; do
      printf '%s -> ' "$fd"
      readlink "$fd"
    done
  fi
done
```

## 现象说明

路径 1 使用的是 systemd device cgroup 权限控制。它限制的是服务进程打开设备节点的权限，不会隐藏设备节点本身。

因此，在服务进程的 mount namespace 里执行 `ls /dev/dri /dev/mali0` 仍然可能看到设备节点；这不代表 GPU 访问限制失效。路径 1 的关键验证标准是：

- `systemctl show electron-zzcd-watchdog -p DevicePolicy -p DeviceAllow` 显示 `DevicePolicy=closed`，且未放行 `/dev/dri/*`、`/dev/mali0`。
- Electron 进程组 fd 检查不再出现 `/dev/dri/*` 或 `/dev/mali0`。
- 服务保持 `active/running`，没有反复重启。

## 后续测试文档可引用表述

前置测试条件可写为：

```text
Electron 正式服务已通过 systemd DevicePolicy 限制 GPU 设备访问：
服务 drop-in 配置 DevicePolicy=closed，仅放行基础运行设备，未放行 /dev/dri/* 和 /dev/mali0。
经验证，electron-zzcd-watchdog.service 正常运行，30 秒稳定性复查无重启，Electron 进程组 fd 中未发现 /dev/dri/* 或 /dev/mali0，说明 Electron 服务侧 GPU 设备访问限制已生效。
该限制仅作用于 electron-zzcd-watchdog.service，不是系统级禁用 GPU。
```

## 回滚

如需撤销本次实验配置：

```sh
rm -f /etc/systemd/system/electron-zzcd-watchdog.service.d/gpu-access-control.conf
systemctl daemon-reload
systemctl restart electron-zzcd-watchdog
```
