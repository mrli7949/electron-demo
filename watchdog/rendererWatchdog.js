const { createEvent, createHeartbeat } = require('./protocol')

function createRendererWatchdog(options) {
  const { config, transports, requestRecovery } = options
  const renderers = new Map()
  const recoveryTimes = []
  const pausedReasons = new Set()
  let activeRendererId = null
  let recoveryInFlight = false
  let enabled = config.enabled
  let heartbeatEnabled = config.heartbeatEnabled
  let recoveryEnabled = config.recoveryEnabled

  function send(message) {
    if (!enabled) return

    for (const transport of transports) {
      transport.send(message)
    }
  }

  function isPaused() {
    return pausedReasons.size > 0
  }

  function canObserve() {
    return enabled && !isPaused()
  }

  function getActiveRenderer() {
    if (activeRendererId === null) return null
    return renderers.get(activeRendererId) || null
  }

  function trimRecoveryTimes() {
    const cutoff = Date.now() - 60 * 1000
    while (recoveryTimes.length > 0 && recoveryTimes[0] < cutoff) {
      recoveryTimes.shift()
    }
  }

  async function askRecovery(reason, renderer, details = {}) {
    if (!canObserve()) return
    if (!renderer || renderer.id !== activeRendererId) return
    if (renderer.state === 'destroying') return

    send(
      createEvent({
        source: 'electron-main',
        level: 'error',
        reason,
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
        recoveryEnabled,
        details,
      }),
    )

    if (!recoveryEnabled) {
      return
    }

    const now = Date.now()
    if (recoveryInFlight || now - renderer.lastRecoveryAt < config.recoverCooldownMs) {
      return
    }

    trimRecoveryTimes()
    if (recoveryTimes.length >= config.maxRecoveriesPerMinute) {
      send(
        createEvent({
          source: 'electron-main',
          level: 'fatal',
          reason: 'recovery-rate-limit',
          rendererId: renderer.id,
          details: {
            maxRecoveriesPerMinute: config.maxRecoveriesPerMinute,
          },
        }),
      )
      return
    }

    recoveryInFlight = true
    renderer.lastRecoveryAt = now
    recoveryTimes.push(now)

    try {
      await requestRecovery(reason, {
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
        details,
      })
    } catch (error) {
      send(
        createEvent({
          source: 'electron-main',
          level: 'fatal',
          reason: 'recovery-failed',
          rendererId: renderer.id,
          entryUrl: renderer.entryUrl,
          details: {
            message: error.message,
          },
        }),
      )
    } finally {
      recoveryInFlight = false
    }
  }

  function attach(webContents, metadata) {
    if (!enabled) return null

    const renderer = {
      ...metadata,
      webContents,
      state: 'loading',
      lastHeartbeatAt: Date.now(),
      lastRecoveryAt: 0,
      unresponsiveAt: null,
    }

    renderers.set(renderer.id, renderer)

    webContents.on('did-finish-load', () => {
      if (!canObserve()) return
      if (renderer.id !== activeRendererId) return
      renderer.state = 'ready'
      renderer.lastHeartbeatAt = Date.now()
      send(
        createEvent({
          source: 'electron-main',
          level: 'info',
          reason: 'renderer-ready',
          rendererId: renderer.id,
          entryUrl: renderer.entryUrl,
        }),
      )
    })

    webContents.on('unresponsive', () => {
      if (!canObserve()) return
      if (renderer.id !== activeRendererId) return
      renderer.unresponsiveAt = Date.now()
      send(
        createEvent({
          source: 'electron-main',
          level: 'warning',
          reason: 'renderer-unresponsive',
          rendererId: renderer.id,
          entryUrl: renderer.entryUrl,
        }),
      )
    })

    webContents.on('responsive', () => {
      if (!canObserve()) return
      if (renderer.id !== activeRendererId) return
      renderer.unresponsiveAt = null
      renderer.lastHeartbeatAt = Date.now()
      send(
        createEvent({
          source: 'electron-main',
          level: 'info',
          reason: 'renderer-responsive',
          rendererId: renderer.id,
          entryUrl: renderer.entryUrl,
        }),
      )
    })

    webContents.on('render-process-gone', (event, details) => {
      if (!canObserve()) return
      if (renderer.id !== activeRendererId) return
      renderer.state = 'gone'
      askRecovery('render-process-gone', renderer, details)
    })

    return renderer
  }

  function detach(rendererId) {
    if (!enabled) return

    const renderer = renderers.get(rendererId)
    if (!renderer) return

    renderer.state = 'destroying'
    renderers.delete(rendererId)
    if (activeRendererId === rendererId) {
      activeRendererId = null
    }
  }

  function markActive(rendererId) {
    if (!enabled) return

    activeRendererId = rendererId
    const renderer = renderers.get(rendererId)
    if (renderer) {
      renderer.state = 'ready'
      renderer.lastHeartbeatAt = Date.now()
    }
  }

  function receiveHeartbeat(event, payload = {}) {
    if (!enabled) return { ok: false, reason: 'watchdog-disabled' }
    if (!heartbeatEnabled) return { ok: true, reason: 'heartbeat-disabled' }
    if (isPaused()) return { ok: true, reason: 'watchdog-paused' }

    const renderer = getActiveRenderer()
    if (!renderer || event.sender !== renderer.webContents) {
      return { ok: false, reason: 'inactive-renderer' }
    }

    renderer.lastHeartbeatAt = Date.now()
    send(
      createHeartbeat({
        source: 'renderer',
        rendererId: renderer.id,
        entryUrl: renderer.entryUrl,
        payload,
      }),
    )
    return { ok: true }
  }

  const timer = setInterval(() => {
    if (!canObserve()) return

    const renderer = getActiveRenderer()
    if (!renderer || renderer.state !== 'ready') return

    const now = Date.now()
    if (heartbeatEnabled && now - renderer.lastHeartbeatAt > config.heartbeatTimeoutMs) {
      askRecovery('heartbeat-timeout', renderer, {
        elapsedMs: now - renderer.lastHeartbeatAt,
        timeoutMs: config.heartbeatTimeoutMs,
      })
      return
    }

    if (
      renderer.unresponsiveAt !== null &&
      now - renderer.unresponsiveAt > config.unresponsiveGraceMs
    ) {
      askRecovery('unresponsive-timeout', renderer, {
        elapsedMs: now - renderer.unresponsiveAt,
        timeoutMs: config.unresponsiveGraceMs,
      })
    }
  }, config.heartbeatCheckIntervalMs)

  function close() {
    clearInterval(timer)
    renderers.clear()
    activeRendererId = null
    for (const transport of transports) {
      transport.close()
    }
  }

  function pause(reason = 'manual') {
    pausedReasons.add(reason)
    send(
      createEvent({
        source: 'electron-main',
        level: 'info',
        reason: 'watchdog-paused',
        details: {
          pausedReason: reason,
          pausedReasons: Array.from(pausedReasons),
        },
      }),
    )
  }

  function resume(reason = 'manual') {
    pausedReasons.delete(reason)
    send(
      createEvent({
        source: 'electron-main',
        level: 'info',
        reason: 'watchdog-resumed',
        details: {
          resumedReason: reason,
          pausedReasons: Array.from(pausedReasons),
        },
      }),
    )
  }

  function setRecoveryEnabled(nextEnabled) {
    recoveryEnabled = Boolean(nextEnabled)
  }

  function setHeartbeatEnabled(nextEnabled) {
    heartbeatEnabled = Boolean(nextEnabled)
  }

  return {
    attach,
    detach,
    markActive,
    receiveHeartbeat,
    pause,
    resume,
    isPaused,
    setRecoveryEnabled,
    setHeartbeatEnabled,
    close,
  }
}

module.exports = {
  createRendererWatchdog,
}
