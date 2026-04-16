/**
 * preload.js — Electron Preload Script
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__electronBridge', {
  isElectron:      true,
  getSettings:     ()         => ipcRenderer.invoke('get-settings'),
  saveSettings:    (data)     => ipcRenderer.invoke('save-settings', data),
  generateOverlay: (settings) => ipcRenderer.invoke('generate-overlay', settings),
  showInFolder:    (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openMainApp:     ()         => ipcRenderer.invoke('open-main-app'),
  reopenSetup:     ()         => ipcRenderer.invoke('reopen-setup'),
});
