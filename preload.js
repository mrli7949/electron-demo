const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronDemo', {
  navigateTopLevel: (entryUrl) => ipcRenderer.invoke('app:navigate-top-level', entryUrl),
})
