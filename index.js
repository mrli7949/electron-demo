const { app, BrowserWindow } = require('electron/main')
const path = require('node:path')

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    resizable: false,
  })

  win.loadFile('home/index.html')
  // win.loadFile('purepage/index.html')
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})