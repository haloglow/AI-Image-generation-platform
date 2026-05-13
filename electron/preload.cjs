const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('imageApp', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  generateImage: (payload) => ipcRenderer.invoke('image:generate', payload),
  saveImage: (payload) => ipcRenderer.invoke('image:save', payload),
})
