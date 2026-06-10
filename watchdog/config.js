const WATCHDOG_CONFIG = {
  // 总开关。false 时 watchdog 不监听、不恢复、不转发事件。
  enabled: true,

  // Vue 业务心跳超时检测开关。false 时不检查心跳超时。
  heartbeatEnabled: true,

  // 自动恢复开关。false 时只记录事件，不执行 WebContentsView 替换恢复。
  recoveryEnabled: true,

  // Vue 业务心跳超时时间。超过该时间未收到当前 renderer 心跳则请求恢复。
  heartbeatTimeoutMs: 8000,

  // watchdog 内部轮询检查间隔。
  heartbeatCheckIntervalMs: 1000,

  // Electron 报告 renderer unresponsive 后的宽限时间。
  unresponsiveGraceMs: 5000,

  // 单次自动恢复后的冷却时间，避免频繁重建 WebContentsView。
  recoverCooldownMs: 10000,

  // 每分钟最多自动恢复次数，超过后只记录 fatal 事件，不继续恢复。
  maxRecoveriesPerMinute: 3,

  // 控制台是否打印心跳。默认只打印事件，避免心跳刷屏。
  logHeartbeats: false,

  // 文件日志配置。默认写入 app.getPath('userData')/watchdog-zzcd-logs。
  fileLog: {
    enabled: true,
    dirName: 'watchdog-zzcd-logs',
    filePrefix: 'watchdog',
    maxFileSizeMb: 16,
    maxFiles: 32,
    logHeartbeats: false,
  },

  // 外部 Go/C++ watchdog 对接配置。启用后按 JSON Lines 发送到本地 TCP 服务。
  tcp: {
    enabled: false,
    host: '127.0.0.1',
    port: 19090,
    reconnectMs: 3000,
  },
}

function createWatchdogConfig(overrides = {}) {
  return {
    ...WATCHDOG_CONFIG,
    ...overrides,
    tcp: {
      ...WATCHDOG_CONFIG.tcp,
      ...(overrides.tcp || {}),
    },
    fileLog: {
      ...WATCHDOG_CONFIG.fileLog,
      ...(overrides.fileLog || {}),
    },
  }
}

module.exports = {
  WATCHDOG_CONFIG,
  createWatchdogConfig,
}
