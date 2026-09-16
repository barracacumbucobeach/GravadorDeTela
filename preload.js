'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onMaximizedChanged: (cb) => on('win:maximized-changed', cb),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

  // Capture sources
  listSources: () => ipcRenderer.invoke('sources:list'),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  setPendingSource: (data) => ipcRenderer.invoke('recording:setPendingSource', data),

  // Cursor tracking
  startCursorTracking: () => ipcRenderer.send('cursor:start'),
  stopCursorTracking: () => ipcRenderer.send('cursor:stop'),
  onCursorUpdate: (cb) => on('cursor:update', cb),

  // Streaming writer (shared by recorder + editor export)
  streamBegin: () => ipcRenderer.invoke('stream:begin'),
  streamChunk: (sessionId, buffer) => ipcRenderer.invoke('stream:chunk', { sessionId, buffer }),
  streamEnd: (sessionId) => ipcRenderer.invoke('stream:end', { sessionId }),
  streamAbort: (sessionId) => ipcRenderer.invoke('stream:abort', { sessionId }),
  onConvertProgress: (cb) => on('convert:progress', cb),

  // Recording finalize + library
  finalizeRecording: (tempPath, meta) => ipcRenderer.invoke('recording:finalize', { tempPath, meta }),
  listRecordings: () => ipcRenderer.invoke('recordings:list'),
  deleteRecording: (id) => ipcRenderer.invoke('recordings:delete', id),
  renameRecording: (id, newName) => ipcRenderer.invoke('recordings:rename', { id, newName }),
  revealRecording: (filePath) => ipcRenderer.invoke('recordings:reveal', filePath),
  getRecordingsDir: () => ipcRenderer.invoke('app:getRecordingsDir'),
  openRecordingsDir: () => ipcRenderer.invoke('app:openRecordingsDir'),

  // Import / export
  openVideoDialog: () => ipcRenderer.invoke('dialog:openVideo'),
  finalizeExport: (tempPath, suggestedName, duration) =>
    ipcRenderer.invoke('export:finalize', { tempPath, suggestedName, duration })
});
