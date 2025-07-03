const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  // syntax: send: send stuff from main process to render process. on: wait to get stuff from main process in render process. invoke: call a function in main process from renderer process and wait for a response.

  selectFile: () => ipcRenderer.invoke('select-file'),
  overlayResizable: (value) => ipcRenderer.send('toggle-resizable', value),
  onToggleResizeBorder: (handler) => ipcRenderer.on('toggle-resize-border', (event, value) => handler(value)),
  overlayOn: (value) => ipcRenderer.send('overlay-on', value),
  overlayShowBorder: (value) => ipcRenderer.send('overlay-show-border', value),
  toggleIds: (value) => ipcRenderer.send('toggle-ids', value),
  onMakeShowBorder: (handler) => ipcRenderer.on('make-show-border', (event, value) => handler(value)),
  sendMousePos: (deltaX, deltaY) => ipcRenderer.send('recieve-mouse-pos', deltaX, deltaY),
  getOverlayPosition: () => ipcRenderer.invoke('get-overlay-position'),
  makeOnBoxChecked: (value) => ipcRenderer.on('make-on-box-checked', value),
  overlayDragToggle: (value) => ipcRenderer.send('recieve-drag-overlay', value),
  overlayDragMouseUp: (endX, endY) => ipcRenderer.send('overlay-drag-end', endX, endY),
  onToggleDragOverlay: (handler) => ipcRenderer.on('toggle-drag-overlay', (event, value) => handler(value)),
  onFileContentUpdate: (handler) => ipcRenderer.on('file-content-update', (event, value) => handler(value)),
  getOverlayHistory: () => ipcRenderer.invoke('get-overlay-history'),
  scrollOverlay: (value) => ipcRenderer.send('scroll-overlay', value),
  onScrollOverlay: (handler) => ipcRenderer.on('make-scroll-overlay', (event, value) => handler(value)),
  updateOverlaySettings: (settings) => ipcRenderer.send('update-overlay-settings', settings),
  onUpdateOverlaySettings: (handler) => ipcRenderer.on('send-overlay-settings', (event, value) => handler(value)),
  getOverlaySettings: () => ipcRenderer.invoke('get-overlay-settings'),
});