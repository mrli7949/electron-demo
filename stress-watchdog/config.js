function createStressWatchdogConfig(overrides = {}) {
  return {
    enabled: true,
    logHeartbeats: true,
    heartbeatTimeoutMs: 6000,
    heartbeatCheckIntervalMs: 2000,
    fileLog: {
      enabled: true,
      filePrefix: 'electron-stress-watchdog',
      maxFileSizeMb: 16,
      maxFiles: 32,
      logHeartbeats: true,
    },
    ...overrides,
  }
}

module.exports = {
  createStressWatchdogConfig,
}
