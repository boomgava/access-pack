'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  demo: process.env.ACCESS_PACK_DEMO || '',
  demoOut: process.env.ACCESS_PACK_OUT || '',
  platform: process.platform,
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  importLogo: (srcPath) => ipcRenderer.invoke('settings:importLogo', srcPath),
  logoPreview: (logoFile) => ipcRenderer.invoke('settings:logoPreview', logoFile),
  importBackground: (srcPath) => ipcRenderer.invoke('settings:importBackground', srcPath),
  backgroundPreview: (file) => ipcRenderer.invoke('settings:backgroundPreview', file),
  mascots: () => ipcRenderer.invoke('themes:mascots'),
  mascotImage: (id) => ipcRenderer.invoke('themes:mascotImage', id),
  listLibrary: (dir) => ipcRenderer.invoke('library:list', dir),
  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  openLink: (url) => ipcRenderer.invoke('shell:openLink', url),
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  build: (req) => ipcRenderer.invoke('build:run', req),
  buildMemos: (req) => ipcRenderer.invoke('memos:run', req),
  saveMailPassword: (value) => ipcRenderer.invoke('mail:savePassword', value),
  hasMailPassword: () => ipcRenderer.invoke('mail:hasPassword'),
  keychainReady: () => ipcRenderer.invoke('mail:keychainReady'),
  testMail: () => ipcRenderer.invoke('mail:test'),
  sendMail: (req) => ipcRenderer.invoke('mail:send', req),
  listHistory: () => ipcRenderer.invoke('history:list'),
  deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  onBuildProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('build:progress', handler);
    return () => ipcRenderer.removeListener('build:progress', handler);
  },
  setDirty: (value) => ipcRenderer.send('batch:dirty', Boolean(value)),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
