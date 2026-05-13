const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { generateImage, getPublicConfig, getSuggestedFileName } = require('./imageClient.cjs')

const isMac = process.platform === 'darwin'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#020617',
    title: '对话生图',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('config:get', async () => getPublicConfig())

ipcMain.handle('image:generate', async (_event, payload) => {
  return generateImage(payload)
})

ipcMain.handle('image:save', async (_event, payload = {}) => {
  const { image } = payload

  if (!image || !image.saveData) {
    throw new Error('没有可保存的图片数据')
  }

  const suggestedName = payload.suggestedName || getSuggestedFileName('image', image.mimeType)
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '保存图片',
    defaultPath: suggestedName,
    filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })

  if (canceled || !filePath) {
    return { canceled: true }
  }

  if (image.saveData.type === 'base64') {
    await fs.writeFile(filePath, Buffer.from(image.saveData.base64, 'base64'))
  } else if (image.saveData.type === 'url') {
    const response = await fetch(image.saveData.url)

    if (!response.ok) {
      throw new Error(`下载图片失败：${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    await fs.writeFile(filePath, Buffer.from(arrayBuffer))
  } else {
    throw new Error('不支持的图片保存类型')
  }

  return {
    canceled: false,
    filePath,
  }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})
