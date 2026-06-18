const { contextBridge, ipcRenderer } = require('electron')

const NAVIGATION_FLAG_KEY = 'electron-demo:top-level-navigation-transition'
const NAVIGATION_READY_EVENT = 'app:top-level-navigation-ready'
const FADE_IN_MS = 160
const FADE_OUT_MS = 180

let navigationOverlay = null
let navigationOverlayStyle = null
let removeOverlayTimer = null

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function setNavigationFlag() {
  try {
    window.localStorage.setItem(NAVIGATION_FLAG_KEY, '1')
  } catch {
    // Ignore storage failures; the overlay still works for the current page.
  }
}

function clearNavigationFlag() {
  try {
    window.localStorage.removeItem(NAVIGATION_FLAG_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function hasNavigationFlag() {
  try {
    return window.localStorage.getItem(NAVIGATION_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function ensureNavigationOverlayStyle() {
  if (navigationOverlayStyle && document.contains(navigationOverlayStyle)) return

  navigationOverlayStyle = document.createElement('style')
  navigationOverlayStyle.id = 'electron-demo-navigation-transition-style'
  navigationOverlayStyle.textContent = `
    #electron-demo-navigation-transition {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: all;
      background: #06111c;
      opacity: 0;
      transition: opacity ${FADE_IN_MS}ms ease;
      will-change: opacity;
    }
  `

  const styleParent = document.head || document.documentElement
  styleParent.appendChild(navigationOverlayStyle)
}

function ensureNavigationOverlay() {
  if (navigationOverlay && document.contains(navigationOverlay)) {
    return navigationOverlay
  }

  ensureNavigationOverlayStyle()

  navigationOverlay = document.createElement('div')
  navigationOverlay.id = 'electron-demo-navigation-transition'
  navigationOverlay.setAttribute('aria-hidden', 'true')

  const overlayParent = document.body || document.documentElement
  overlayParent.appendChild(navigationOverlay)
  return navigationOverlay
}

function showNavigationOverlay({ immediate = false } = {}) {
  if (removeOverlayTimer !== null) {
    clearTimeout(removeOverlayTimer)
    removeOverlayTimer = null
  }

  const overlay = ensureNavigationOverlay()
  overlay.style.transitionDuration = immediate ? '0ms' : `${FADE_IN_MS}ms`

  if (immediate) {
    overlay.style.opacity = '1'
    return
  }

  overlay.style.opacity = '0'
  requestAnimationFrame(() => {
    overlay.style.opacity = '1'
  })
}

function hideNavigationOverlay() {
  clearNavigationFlag()

  if (!navigationOverlay || !document.contains(navigationOverlay)) return

  if (removeOverlayTimer !== null) {
    clearTimeout(removeOverlayTimer)
    removeOverlayTimer = null
  }

  navigationOverlay.style.transitionDuration = `${FADE_OUT_MS}ms`
  navigationOverlay.style.opacity = '0'
  removeOverlayTimer = setTimeout(() => {
    navigationOverlay?.remove()
    navigationOverlay = null
    removeOverlayTimer = null
  }, FADE_OUT_MS)
}

function installPendingNavigationOverlay() {
  if (!hasNavigationFlag()) return

  if (document.documentElement) {
    showNavigationOverlay({ immediate: true })
    return
  }

  window.addEventListener(
    'DOMContentLoaded',
    () => {
      showNavigationOverlay({ immediate: true })
    },
    { once: true },
  )
}

installPendingNavigationOverlay()

ipcRenderer.on(NAVIGATION_READY_EVENT, () => {
  hideNavigationOverlay()
})

function sendWatchdogHeartbeat(payload = {}) {
  ipcRenderer.send('watchdog:heartbeat', payload)
}

function sendStressHeartbeat(payload = {}) {
  ipcRenderer.send('stress-watchdog:heartbeat', payload)
}

contextBridge.exposeInMainWorld('electronDemo', {
  navigateTopLevel: async (entryUrl) => {
    setNavigationFlag()
    showNavigationOverlay()
    await wait(FADE_IN_MS)

    try {
      const result = await ipcRenderer.invoke('app:navigate-top-level', entryUrl)
      if (!result?.ok) {
        hideNavigationOverlay()
      }
      return result
    } catch (error) {
      hideNavigationOverlay()
      throw error
    }
  },
  watchdog: {
    heartbeat: sendWatchdogHeartbeat,
  },
  stressTest: {
    agentUrl: process.env.ZD_STRESS_AGENT || 'http://127.0.0.1:18080',
    heartbeat: sendStressHeartbeat,
  },
})
