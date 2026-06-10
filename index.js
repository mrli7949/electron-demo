const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron/main')
const path = require('node:path')

const allowedEntryFiles = new Set([
  'index.html',
  'alarm.html',
  'record.html',
  'setting.html',
  'system.html',
  'demo.html',
])

let currentWindow = null
let currentView = null
let isReplacingRenderer = false
const NAVIGATION_READY_EVENT = 'app:top-level-navigation-ready'

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
  return new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
}

function destroyRendererView(view) {
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.destroy()
  }
}

function resizeRendererView(win, view) {
  if (!win || win.isDestroyed() || !view) return
  const [width, height] = win.getContentSize()
  view.setBounds({ x: 0, y: 0, width, height })
}

function notifyRendererViewReady(view) {
  if (!view || view.webContents.isDestroyed()) return

  setTimeout(() => {
    if (!view.webContents.isDestroyed()) {
      view.webContents.send(NAVIGATION_READY_EVENT)
    }
  }, 0)
}

async function loadRendererView(entryUrl) {
  const target = parseEntryUrl(entryUrl)
  const view = createRendererView()

  try {
    await view.webContents.loadFile(path.join(__dirname, 'dist', target.fileName), {
      hash: target.hash,
      query: target.query,
    })
  } catch (error) {
    destroyRendererView(view)
    throw error
  }

  return view
}

async function replaceRendererView(entryUrl) {
  if (!currentWindow || currentWindow.isDestroyed()) {
    throw new Error('Main window is not available')
  }

  const nextView = await loadRendererView(entryUrl)
  if (!currentWindow || currentWindow.isDestroyed()) {
    destroyRendererView(nextView)
    throw new Error('Main window was closed while loading renderer')
  }

  try {
    resizeRendererView(currentWindow, nextView)
    currentWindow.contentView.addChildView(nextView)
  } catch (error) {
    destroyRendererView(nextView)
    throw error
  }

  const previousView = currentView
  currentView = nextView

  if (previousView) {
    currentWindow.contentView.removeChildView(previousView)
    destroyRendererView(previousView)
  }

  notifyRendererViewReady(nextView)
}

const createWindow = async (entryUrl = 'index.html') => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    resizable: false,
    show: false,
  })

  win.on('resize', () => {
    resizeRendererView(win, currentView)
  })

  win.on('closed', () => {
    if (currentWindow === win) {
      destroyRendererView(currentView)
      currentWindow = null
      currentView = null
    }
  })

  currentWindow = win
  currentView = await loadRendererView(entryUrl)
  resizeRendererView(win, currentView)
  win.contentView.addChildView(currentView)
  win.show()
  notifyRendererViewReady(currentView)

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

  if (event.sender !== currentView?.webContents) {
    return { ok: false, reason: 'Source renderer is not available' }
  }

  isReplacingRenderer = true
  try {
    await replaceRendererView(entryUrl)
    return { ok: true }
  } finally {
    isReplacingRenderer = false
  }
})

app.on('window-all-closed', () => {
  if (!isReplacingRenderer && process.platform !== 'darwin') {
    app.quit()
  }
})
