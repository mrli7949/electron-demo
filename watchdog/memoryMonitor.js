const fs = require('node:fs')

function kbToMb(value) {
  if (!Number.isFinite(value)) return null
  return Number((value / 1024).toFixed(1))
}

function readLinuxProcessMemory(pid) {
  if (process.platform !== 'linux' || !pid) return {}

  const result = {}

  try {
    const smapsRollup = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8')
    const pssMatch = smapsRollup.match(/^Pss:\s+(\d+)\s+kB/im)
    const rssMatch = smapsRollup.match(/^Rss:\s+(\d+)\s+kB/im)

    if (pssMatch) {
      result.pssMb = kbToMb(Number(pssMatch[1]))
    }
    if (rssMatch) {
      result.rssMb = kbToMb(Number(rssMatch[1]))
    }
  } catch {
    // 部分内核或权限配置不会暴露 smaps_rollup，后续回退读取 status。
  }

  if (result.rssMb === undefined) {
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
      const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB/im)
      if (rssMatch) {
        result.rssMb = kbToMb(Number(rssMatch[1]))
      }
    } catch {
      // 即使 /proc 不可用，也不能影响应用继续运行。
    }
  }

  return result
}

function getRendererOsPid(webContents) {
  if (!webContents || webContents.isDestroyed()) return null

  if (typeof webContents.getOSProcessId === 'function') {
    const pid = webContents.getOSProcessId()
    return pid > 0 ? pid : null
  }

  return null
}

function createMetricSnapshot(app, renderer) {
  const rendererPid = getRendererOsPid(renderer?.webContents)
  const metrics = app.getAppMetrics()
  const totalWorkingSetKb = metrics.reduce((total, metric) => {
    return total + (metric.memory?.workingSetSize || 0)
  }, 0)
  const rendererMetric = metrics.find((metric) => metric.pid === rendererPid)
  const linuxMemory = readLinuxProcessMemory(rendererPid)
  const rendererWorkingSetMb = kbToMb(rendererMetric?.memory?.workingSetSize)

  return {
    rendererId: renderer?.id,
    entryUrl: renderer?.entryUrl,
    rendererPid,
    rendererMemoryMb:
      linuxMemory.pssMb ?? linuxMemory.rssMb ?? rendererWorkingSetMb,
    rendererPssMb: linuxMemory.pssMb,
    rendererRssMb: linuxMemory.rssMb,
    rendererWorkingSetMb,
    browserWorkingSetMb: kbToMb(totalWorkingSetKb),
    metricCount: metrics.length,
  }
}

function createMemoryMonitor(options) {
  const {
    app,
    limits,
    getCurrentRenderer,
    isRecoveryBusy,
    reportEvent,
    requestRecovery,
    requestHardExit,
  } = options

  let timer = null
  let lastWarningAt = 0
  let lastRecoverAt = 0
  let recoveryCount = 0

  function report(level, reason, snapshot, extra = {}) {
    reportEvent({
      source: 'electron-main',
      level,
      reason,
      rendererId: snapshot.rendererId,
      entryUrl: snapshot.entryUrl,
      details: {
        ...snapshot,
        limits,
        ...extra,
      },
    })
  }

  async function check() {
    const renderer = getCurrentRenderer()
    if (!renderer || !renderer.webContents || renderer.webContents.isDestroyed()) return

    const snapshot = createMetricSnapshot(app, renderer)
    const rendererMemoryMb = snapshot.rendererMemoryMb
    const browserWorkingSetMb = snapshot.browserWorkingSetMb
    const now = Date.now()

    if (
      browserWorkingSetMb !== null &&
      browserWorkingSetMb >= limits.browserMemoryWarningMb &&
      now - lastWarningAt > limits.memoryCheckIntervalMs * 6
    ) {
      lastWarningAt = now
      report('warning', 'browser-memory-warning', snapshot)
    }

    if (rendererMemoryMb === null) return

    if (rendererMemoryMb >= limits.rendererMemoryHardRecoverMb) {
      requestHardExit('renderer-memory-hard-limit', {
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
        details: snapshot,
      })
      return
    }

    if (
      rendererMemoryMb >= limits.rendererMemoryRecoverMb &&
      !isRecoveryBusy() &&
      now - lastRecoverAt > limits.memoryRecoverCooldownMs
    ) {
      lastRecoverAt = now
      recoveryCount += 1
      report('error', 'renderer-memory-recover', snapshot, { recoveryCount })
      await requestRecovery('renderer-memory-recover', {
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
        details: snapshot,
      })
      return
    }

    if (
      rendererMemoryMb >= limits.rendererMemoryWarningMb &&
      now - lastWarningAt > limits.memoryCheckIntervalMs * 6
    ) {
      lastWarningAt = now
      report('warning', 'renderer-memory-warning', snapshot)
    }
  }

  function start() {
    if (timer !== null) return

    timer = setInterval(() => {
      check().catch((error) => {
        reportEvent({
          source: 'electron-main',
          level: 'error',
          reason: 'memory-monitor-check-failed',
          details: {
            message: error.message,
          },
        })
      })
    }, limits.memoryCheckIntervalMs)
  }

  function stop() {
    if (timer === null) return

    clearInterval(timer)
    timer = null
  }

  return {
    start,
    stop,
  }
}

module.exports = {
  createMemoryMonitor,
}
