# Electron Watchdog 说明

## 设计目标

本目录实现一个轻量级 Electron 看门狗，用于检测当前 renderer 的异常状态，并在需要时请求业务层恢复页面。

当前支持的信号：

- `render-process-gone`：renderer 进程崩溃、OOM、被系统杀掉等。
- `unresponsive` / `responsive`：Chromium 报告 renderer 卡死或恢复响应。
- `watchdog:heartbeat`：`zd-test-client` Vue 业务层主动上报心跳。

## 生命周期边界

watchdog 不拥有 `WebContentsView` 生命周期。

watchdog 不会执行以下操作：

- `new WebContentsView()`
- `addChildView()`
- `removeChildView()`
- `webContents.destroy()`

这些仍然由 `index.js` 的业务层统一管理。watchdog 只负责监听、判断和发出恢复请求：

```js
requestRecovery(reason, context)
```

业务层收到请求后，会先确认 `rendererId` 是否仍然是当前 renderer，再复用已有的 `replaceRendererView(currentRenderer.entryUrl)` 流程恢复页面。

## rendererId

每个 renderer 创建时都会分配一个递增的 `rendererId`。watchdog 只处理当前 active renderer 的事件。

这样可以避免以下问题：

- 旧 renderer 已经被业务层销毁，但迟到事件误伤新 renderer。
- 顶层页面切换时，新旧 `WebContentsView` 交错导致重复恢复。
- 旧页面心跳污染当前页面状态。

## 静态配置

配置写在 `watchdog/config.js`，不依赖启动脚本环境变量。

常用配置：

```js
const WATCHDOG_CONFIG = {
  // 总开关。false 时 watchdog 不监听、不恢复、不转发事件。
  enabled: true,

  // Vue 业务心跳超时检测开关。false 时不检查心跳超时。
  heartbeatEnabled: true,

  // 自动恢复开关。false 时只记录事件，不执行 WebContentsView 替换恢复。
  recoveryEnabled: true,

  // Vue 业务心跳超时时间。
  heartbeatTimeoutMs: 8000,

  // Electron 报告 renderer unresponsive 后的宽限时间。
  unresponsiveGraceMs: 5000,

  // 单次自动恢复后的冷却时间。
  recoverCooldownMs: 10000,

  // 每分钟最多自动恢复次数。
  maxRecoveriesPerMinute: 3,
}
```

## 运行时暂停

watchdog 支持运行时暂停和恢复：

```js
watchdog.pause('top-level-navigation')
watchdog.resume('top-level-navigation')
watchdog.isPaused()
watchdog.setRecoveryEnabled(false)
watchdog.setHeartbeatEnabled(false)
```

暂停原因内部使用 `Set` 管理。多个模块同时暂停时，只有所有原因都恢复后，watchdog 才会继续检测。

示例：

```js
watchdog.pause('navigation')
watchdog.pause('firmware-upgrade')
watchdog.resume('navigation') // 仍处于暂停
watchdog.resume('firmware-upgrade') // 恢复检测
```

## Vue 业务心跳

preload 不做自动心跳。preload 只暴露桥接接口：

```js
window.electronDemo.watchdog.heartbeat(payload)
```

真正的业务心跳由 `zd-test-client` 主动上报。这样心跳含义更清楚：它代表 Vue 应用、路由和业务入口仍然可运行。

浏览器或 Vite 环境没有 `window.electronDemo` 时，前端心跳会自动 no-op。

## JSON Lines 协议

watchdog 的事件和心跳使用一行一个 JSON 的格式，便于未来 Go/C++ 外部看门狗读取。

示例：

```json
{"version":1,"type":"heartbeat","app":"electron-demo","ts":1791620000000,"pid":1234,"source":"renderer","rendererId":2,"entryUrl":"demo.html#/memoryLeakTest/jsMemoryLeak","payload":{"source":"zzcd-client","seq":12,"route":"/memoryLeakTest/jsMemoryLeak"}}
{"version":1,"type":"event","app":"electron-demo","ts":1791620001000,"pid":1234,"source":"electron-main","level":"error","reason":"render-process-gone","rendererId":2,"details":{"reason":"oom","exitCode":0}}
```

默认只输出事件到控制台，不打印心跳，避免刷屏。需要心跳日志时可在 `watchdog/config.js` 中设置：

```js
logHeartbeats: true
```

## 文件日志

生产环境通常不能依赖控制台输出。双击启动、桌面图标启动或后台服务启动时，`console.log` 不一定容易查看，因此 watchdog 默认启用文件日志。

文件日志目录：

```js
path.join(app.getPath('userData'), 'watchdog-zzcd-logs')
```

Ubuntu 上通常类似：

```txt
/home/用户名/.config/electron-pure-kehua/watchdog-zzcd-logs
```

它不是 Linux 根目录下的 `/watchdog-zzcd-logs`。

文件日志配置位于 `watchdog/config.js`：

```js
fileLog: {
  enabled: true,
  dirName: 'watchdog-zzcd-logs',
  filePrefix: 'watchdog',
  maxFileSizeMb: 16,
  maxFiles: 32,
  logHeartbeats: false,
}
```

日志轮转策略：

- 单个日志文件最大 `16MB`。
- 最多保留 `32` 个文件。
- 总日志大小约为 `16MB * 32 = 512MB`。
- 超过文件数量后自动删除最旧日志。
- 默认只写事件，不写心跳，避免日志快速膨胀。

日志文件示例：

```txt
watchdog-20260610-163000-001.log
watchdog-20260610-164500-002.log
```

## TCP 转发

如需对接 Go/C++ 外部看门狗，可在 `watchdog/config.js` 中启用 TCP：

```js
tcp: {
  enabled: true,
  host: '127.0.0.1',
  port: 19090,
  reconnectMs: 3000,
}
```

启用后，Electron 主进程会把 JSON Lines 消息发送到该 TCP 服务。

## JS Heap 上限

`index.js` 中设置了：

```js
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256')
```

这个配置限制的是 V8 JS heap old space 约 256MB，不等于窗口总内存 256MB。DOM、图片、GPU、字体缓存、Chromium 内部结构等仍会额外占用内存。

## 当前未实现项

本版暂不做 renderer 总内存观测，也不读取 `app.getAppMetrics()`。后续如果需要按进程内存阈值恢复，可以在 watchdog 中扩展当前 renderer 的内存采样逻辑。
