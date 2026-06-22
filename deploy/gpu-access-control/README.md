# 方案 B：限制 Electron 访问 GPU 设备

目标是在不修改 Electron 业务代码、不关闭系统级 GPU/DRM 显示栈的前提下，让 Electron 进程看起来像运行在“无 GPU 访问权限”的环境里。

## 当前实测结论

2026-06-22 已在 rk3568 arm 开发板上验证路径 1：`systemd DevicePolicy=closed` 白名单方案。

结论：路径 1 生效。`electron-zzcd-watchdog.service` 正常运行，30 秒稳定性复查无重启，Electron 进程组 fd 中未发现 `/dev/dri/*` 或 `/dev/mali0`。

实测记录见：

```text
path1-device-policy-result-2026-06-22.md
```

## 背景

当前开发板检测到 GPU/DRM 相关设备：

```text
/dev/mali0
/dev/dri/card0
/dev/dri/card1
/dev/dri/renderD128
/dev/dri/renderD129
/sys/devices/platform/fde60000.gpu
```

Electron 代码里已经调用 `app.disableHardwareAcceleration()` 和 `disable-gpu`，但这只影响 Electron/Chromium 自身是否主动使用 GPU，不会关闭系统 GPU 驱动，也不会阻止其他进程访问 `/dev/dri` 或 `/dev/mali0`。

## 目标

- 不改 Electron 业务逻辑。
- 不禁用内核 GPU 驱动。
- 不影响系统桌面、HDMI、X11 或 DRM/KMS 显示输出。
- 只限制 `electron-zzcd-watchdog.service` 启动的 Electron 进程访问 GPU 设备节点。
- 用 systemd 配置完成，便于回滚和对比测试。

## 不做的事情

- 不修改设备树。
- 不 blacklist Mali/DRM 驱动。
- 不卸载内核模块。
- 不删除 `/dev/dri` 或 `/dev/mali0`。
- 不修改 Electron 的 GPU 开关代码。
- 不做一键执行脚本，先只记录方案。

## 可选实现路径

### 路径 1：systemd DevicePolicy 白名单

思路：对 `electron-zzcd-watchdog.service` 设置设备访问策略，只允许必要设备，明确不把 GPU 节点加入白名单。

计划配置形态：

```ini
[Service]
DevicePolicy=closed

# 示例：只开放 Electron/X11 运行可能需要的基础设备。
# 实际清单需要在板子上验证后收敛。
DeviceAllow=/dev/null rw
DeviceAllow=/dev/zero rw
DeviceAllow=/dev/full rw
DeviceAllow=/dev/random r
DeviceAllow=/dev/urandom r
DeviceAllow=/dev/tty rw
DeviceAllow=/dev/pts/* rw
DeviceAllow=/dev/shm rw

# 不添加以下设备：
# /dev/mali0
# /dev/dri/card*
# /dev/dri/renderD*
```

风险：

- `DevicePolicy=closed` 比较严格，可能误伤 X11、字体、共享内存、音频、输入设备等运行依赖。
- 需要逐步试探最小可用白名单。
- 如果 Electron 通过 X server 间接使用 GPU，这个策略不一定能完全模拟无 GPU 系统，因为 X server 本身仍可访问 GPU。

### 路径 2：systemd BindPaths/TemporaryFileSystem 遮蔽设备节点

思路：对 Electron 服务挂载一个受限视图，让 `/dev/dri` 或 `/dev/mali0` 对该服务不可见。

可能配置形态：

```ini
[Service]
TemporaryFileSystem=/dev/dri:ro
InaccessiblePaths=/dev/mali0
```

风险：

- systemd 版本和内核挂载命名空间能力会影响可用性。
- 遮蔽 `/dev/dri` 可能影响 Chromium、X11 或 Electron 的启动路径。
- 需要确认 Ubuntu 20.04 板子上的 systemd 是否支持对应指令。

### 路径 3：用户/权限隔离

思路：让 Electron 运行用户不属于 `video`、`render` 等组，从权限层面无法打开 GPU 节点。

计划检查：

```sh
id firefly
ls -l /dev/dri /dev/mali0
```

可能动作：

```sh
gpasswd -d firefly video
gpasswd -d firefly render
```

风险：

- 可能影响当前桌面会话、X11 权限或其他图形程序。
- 组权限变化通常需要重新登录或重启服务才能完全生效。
- 如果 `/dev/mali0` 权限是 `666`，仅移除用户组无效。

## 推荐验证顺序

先只做诊断，不改配置：

```sh
ls -l /dev/dri /dev/mali0
id firefly
systemctl status electron-zzcd-watchdog
pgrep -af '^/opt/electron-demo/electron-pure-kehua-zero'
```

观察 Electron 当前是否打开 GPU 设备：

```sh
MAIN_PID="$(systemctl show electron-zzcd-watchdog -p MainPID --value)"
find /proc/"$MAIN_PID"/fd -lname '/dev/dri/*' -o -lname '/dev/mali0' 2>/dev/null
```

如果要覆盖所有 Electron 子进程：

```sh
for pid in $(pgrep -f '^/opt/electron-demo/electron-pure-kehua-zero'); do
  echo "== $pid =="
  find /proc/"$pid"/fd -lname '/dev/dri/*' -o -lname '/dev/mali0' 2>/dev/null
done
```

再做最小试验：

1. 复制当前 service 为备份。
2. 新增 systemd drop-in，不直接改主 service。
3. 从权限隔离或设备遮蔽开始，小步验证。
4. 每次改完执行 `systemctl daemon-reload` 和 `systemctl restart electron-zzcd-watchdog`。
5. 检查 Electron 是否能启动、页面是否显示、日志是否报 GPU/DRM 权限错误。

## 回滚策略

所有实验都建议放在 drop-in 文件：

```text
/etc/systemd/system/electron-zzcd-watchdog.service.d/gpu-access-control.conf
```

回滚时删除该文件并重载：

```sh
sudo rm -f /etc/systemd/system/electron-zzcd-watchdog.service.d/gpu-access-control.conf
sudo systemctl daemon-reload
sudo systemctl restart electron-zzcd-watchdog
```

## 暂定结论

优先考虑路径 1 或路径 2，因为它们只约束 Electron 服务，不会全局关闭开发板 GPU。真正系统级禁用 GPU 应单独作为方案 C 评估，避免误伤显示栈。
