const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron/main')
const path = require('node:path')
const { createWatchdog } = require('./watchdog')

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256')

const allowedEntryFiles = new Set([
  'index.html',
  'alarm.html',
  'record.html',
  'setting.html',
  'system.html',
  'demo.html',
])

let currentWindow = null
let currentRenderer = null
let isReplacingRenderer = false
let nextRendererId = 1
const NAVIGATION_READY_EVENT = 'app:top-level-navigation-ready'

const watchdog = createWatchdog({
  logDir: path.join(app.getPath('userData'), 'watchdog-zzcd-logs'),
  requestRecovery: async (reason, context) => {
    await recoverCurrentRenderer(reason, context)
  },
})

function parseEntryUrl(rawUrl) {
  if (typeof rawUrl !== 'string') {
    throw new Error('Entry URL must be a string')
  }

  const targetUrl = rawUrl.trim()
  if (!targetUrl) {
    throw new Error('Entry URL cannot be empty')
  }

  if (/^(?:[a-z]+:)?\/\//i.test(targetUrl)) {
    throw new Error('External URLs are not allowed')
  }

  const parsedUrl = new URL(targetUrl, 'file:///')
  const fileName = path.posix.basename(parsedUrl.pathname)
  if (parsedUrl.pathname !== `/${fileName}` || !allowedEntryFiles.has(fileName)) {
    throw new Error(`Entry URL is not allowed: ${targetUrl}`)
  }

  return {
    fileName,
    hash: parsedUrl.hash ? parsedUrl.hash.slice(1) : undefined,
    query: parsedUrl.search ? Object.fromEntries(parsedUrl.searchParams.entries()) : undefined,
  }
}

function createRendererView() {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  view.webContents.setBackgroundColor('#06111c')
  return view
}

function destroyRenderer(renderer) {
  if (!renderer) return

  watchdog.detach(renderer.id)

  if (renderer.view && !renderer.view.webContents.isDestroyed()) {
    renderer.view.webContents.destroy()
  }
}

function resizeRendererView(win, renderer) {
  if (!win || win.isDestroyed() || !renderer?.view) return
  const [width, height] = win.getContentSize()
  renderer.view.setBounds({ x: 0, y: 0, width, height })
}

function notifyRendererViewReady(renderer) {
  if (!renderer?.view || renderer.view.webContents.isDestroyed()) return

  setTimeout(() => {
    if (!renderer.view.webContents.isDestroyed()) {
      renderer.view.webContents.send(NAVIGATION_READY_EVENT)
    }
  }, 0)
}

async function loadRendererView(entryUrl) {
  const target = parseEntryUrl(entryUrl)
  const view = createRendererView()
  const renderer = {
    id: nextRendererId++,
    entryUrl,
    view,
    webContents: view.webContents,
    createdAt: Date.now(),
  }

  watchdog.attach(view.webContents, {
    id: renderer.id,
    entryUrl: renderer.entryUrl,
  })

  try {
    await view.webContents.loadFile(path.join(__dirname, 'dist', target.fileName), {
      hash: target.hash,
      query: target.query,
    })
  } catch (error) {
    destroyRenderer(renderer)
    throw error
  }

  return renderer
}

async function replaceRendererView(entryUrl) {
  if (!currentWindow || currentWindow.isDestroyed()) {
    throw new Error('Main window is not available')
  }

  const nextRenderer = await loadRendererView(entryUrl)
  if (!currentWindow || currentWindow.isDestroyed()) {
    destroyRenderer(nextRenderer)
    throw new Error('Main window was closed while loading renderer')
  }

  try {
    resizeRendererView(currentWindow, nextRenderer)
    currentWindow.contentView.addChildView(nextRenderer.view)
  } catch (error) {
    destroyRenderer(nextRenderer)
    throw error
  }

  const previousRenderer = currentRenderer
  currentRenderer = nextRenderer
  watchdog.markActive(nextRenderer.id)

  if (previousRenderer) {
    currentWindow.contentView.removeChildView(previousRenderer.view)
    destroyRenderer(previousRenderer)
  }

  notifyRendererViewReady(nextRenderer)
}

async function recoverCurrentRenderer(reason, context) {
  if (isReplacingRenderer) return
  if (!currentRenderer || context.rendererId !== currentRenderer.id) return

  console.error('[watchdog] recovery requested:', reason, context)

  isReplacingRenderer = true
  try {
    await replaceRendererView(currentRenderer.entryUrl)
  } finally {
    isReplacingRenderer = false
  }
}

const createWindow = async (entryUrl = 'index.html') => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    resizable: false,
    show: false,
    backgroundColor: '#06111c',
  })

  win.on('resize', () => {
    resizeRendererView(win, currentRenderer)
  })

  win.on('closed', () => {
    if (currentWindow === win) {
      destroyRenderer(currentRenderer)
      currentWindow = null
      currentRenderer = null
    }
  })

  currentWindow = win
  currentRenderer = await loadRendererView(entryUrl)
  watchdog.markActive(currentRenderer.id)
  resizeRendererView(win, currentRenderer)
  win.contentView.addChildView(currentRenderer.view)
  win.show()
  notifyRendererViewReady(currentRenderer)

  return win
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error('Failed to create main window:', error)
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error('Failed to create main window:', error)
        app.quit()
      })
    }
  })
})

ipcMain.handle('app:navigate-top-level', async (event, entryUrl) => {
  if (isReplacingRenderer) {
    return { ok: true, reason: 'A renderer replacement is already running' }
  }

  if (event.sender !== currentRenderer?.webContents) {
    return { ok: false, reason: 'Source renderer is not available' }
  }

  isReplacingRenderer = true
  watchdog.pause('top-level-navigation')
  try {
    await replaceRendererView(entryUrl)
    return { ok: true }
  } finally {
    watchdog.resume('top-level-navigation')
    isReplacingRenderer = false
  }
})

ipcMain.on('watchdog:heartbeat', (event, payload) => {
  watchdog.receiveHeartbeat(event, payload)
})

app.on('window-all-closed', () => {
  if (!isReplacingRenderer && process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  watchdog.close()
})
