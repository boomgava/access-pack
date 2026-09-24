'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, Menu, nativeTheme } = require('electron');
const { registerIpc } = require('./ipc');

let mainWindow = null;
let batchDirty = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 920,
    minHeight: 600,
    title: 'Пакет доступов',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111317' : '#f4f5f7',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Никаких переходов и новых окон: перетаскивание файла на окно не должно его «открыть»
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.on('close', (e) => {
    if (!batchDirty) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Закрыть', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
      message: 'Закрыть программу?',
      detail: 'Введённые учётки нигде не сохраняются и будут потеряны.',
    });
    if (choice === 1) e.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ACCESS_PACK_SHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(process.env.ACCESS_PACK_SHOT, image.toPNG());
        batchDirty = false;
        app.quit();
      }, Number(process.env.ACCESS_PACK_SHOT_DELAY || 1500));
    });
  }
}

app.whenReady().then(() => {
  // На Mac стандартное меню нужно ради Cmd+C/V в полях; на Windows строка меню не нужна
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  registerIpc({
    getWindow: () => mainWindow,
    setDirty: (value) => {
      batchDirty = value;
    },
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
