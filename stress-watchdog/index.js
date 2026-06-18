const { createEvent, createHeartbeat } = require('../watchdog/protocol')
const { createConsoleTransport } = require('../watchdog/transports/consoleTransport')
const { createFileTransport } = require('../watchdog/transports/fileTransport')
const { createStressWatchdogConfig } = require('./config')

function createStressWatchdog(options = {}) {
  const config = createStressWatchdogConfig(options.config)
  const renderers = new Map()
  let activeRendererId = null
  let enabled = config.enabled

  const transports = [createConsoleTransport({ logHeartbeats: config.logHeartbeats })]
  if (config.fileLog.enabled && options.logDir) {
    transports.push(
      createFileTransport({
        logDir: options.logDir,
        filePrefix: config.fileLog.filePrefix,
        maxFileSizeBytes: config.fileLog.maxFileSizeMb * 1024 * 1024,
        maxFiles: config.fileLog.maxFiles,
        logHeartbeats: config.fileLog.logHeartbeats,
      }),
    )
  }

  function send(message) {
    if (!enabled) return
    for (const transport of transports) {
      transport.send(message)
    }
  }

  function getActiveRenderer() {
    if (activeRendererId === null) return null
    return renderers.get(activeRendererId) || null
  }

  function reportEvent(payload = {}) {
    send(
      createEvent({
        source: 'electron-stress-watchdog',
        ...payload,
      }),
    )
  }

  function attach(webContents, metadata) {
    if (!enabled) return null

    const renderer = {
      ...metadata,
      webContents,
      lastHeartbeatAt: Date.now(),
      state: 'loading',
    }
    renderers.set(renderer.id, renderer)

    webContents.on('did-finish-load', () => {
      if (renderer.id !== activeRendererId) return
      renderer.state = 'ready'
      renderer.lastHeartbeatAt = Date.now()
      reportEvent({
        level: 'info',
        reason: 'renderer-ready',
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
      })
    })

    webContents.on('unresponsive', () => {
      if (renderer.id !== activeRendererId) return
      reportEvent({
        level: 'warning',
        reason: 'renderer-unresponsive',
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
      })
    })

    webContents.on('responsive', () => {
      if (renderer.id !== activeRendererId) return
      renderer.lastHeartbeatAt = Date.now()
      reportEvent({
        level: 'info',
        reason: 'renderer-responsive',
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
      })
    })

    webContents.on('render-process-gone', (event, details) => {
      if (renderer.id !== activeRendererId) return
      renderer.state = 'gone'
      reportEvent({
        level: 'error',
        reason: 'render-process-gone',
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
        details,
      })
    })

    return renderer
  }

  function detach(rendererId) {
    renderers.delete(rendererId)
    if (activeRendererId === rendererId) {
      activeRendererId = null
    }
  }

  function markActive(rendererId) {
    activeRendererId = rendererId
    const renderer = renderers.get(rendererId)
    if (renderer) {
      renderer.state = 'ready'
      renderer.lastHeartbeatAt = Date.now()
      reportEvent({
        level: 'info',
        reason: 'renderer-active',
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
      })
    }
  }

  function receiveHeartbeat(event, payload = {}) {
    const renderer = getActiveRenderer()
    if (!renderer || event.sender !== renderer.webContents) {
      return { ok: false, reason: 'inactive-renderer' }
    }

    renderer.lastHeartbeatAt = Date.now()
    send(
      createHeartbeat({
        source: 'stress-test-renderer',
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
        payload,
      }),
    )
    return { ok: true }
  }

  const timer = setInterval(() => {
    const renderer = getActiveRenderer()
    if (!renderer || renderer.state !== 'ready') return

    const elapsedMs = Date.now() - renderer.lastHeartbeatAt
    if (elapsedMs <= config.heartbeatTimeoutMs) return

    reportEvent({
      level: 'warning',
      reason: 'stress-heartbeat-timeout',
      rendererId: renderer.id,
      entryUrl: renderer.entryUrl,
      details: {
        elapsedMs,
        timeoutMs: config.heartbeatTimeoutMs,
      },
    })
    renderer.lastHeartbeatAt = Date.now()
  }, config.heartbeatCheckIntervalMs)

  function close() {
    clearInterval(timer)
    for (const transport of transports) {
      transport.close?.()
    }
  }

  reportEvent({
    level: 'info',
    reason: 'electron-main-start',
    details: {
      agentUrl: options.agentUrl,
    },
  })

  return {
    attach,
    detach,
    markActive,
    receiveHeartbeat,
    reportEvent,
    close,
  }
}

module.exports = {
  createStressWatchdog,
}
