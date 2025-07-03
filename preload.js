const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  // send sends messages to the main process from the renderer process
  // sends message froom main renderer process to the main process to toggle the resizable state of the overlay
  overlayResizable: (value) => ipcRenderer.send('toggle-resizable', value),
  // on is for listening to events sent from the main process in the renderer process
  // listens for the 'toggle-resize-border' event from the main process
  // overlayresizable sends message from main renderer to main process, main process relays the message to the overlay renderer process so this is set up to listen for the event
  onToggleResizeBorder: (handler) => ipcRenderer.on('toggle-resize-border', (event, value) => handler(value)),
  overlayOn: (value) => ipcRenderer.send('overlay-on', value),
  overlayShowBorder: (value) => ipcRenderer.send('overlay-show-border', value),
  toggleIds: (value) => ipcRenderer.send('toggle-ids', value),
  onMakeShowBorder: (handler) => ipcRenderer.on('make-show-border', (event, value) => handler(value)),
  setOverlayPositionPercent: (xPercent, yPercent) => ipcRenderer.send('set-overlay-position-percent', xPercent, yPercent),
  // event, data are parameters passed to the handler function with param data when the event is triggered
  onFileContentUpdate: (handler) => ipcRenderer.on('file-content-update', (event, value) => handler(value)),
  getOverlayHistory: () => ipcRenderer.invoke('get-overlay-history'),
  scrollOverlay: (value) => ipcRenderer.send('scroll-overlay', value),
  onScrollOverlay: (handler) => ipcRenderer.on('scroll-overlay', (event, value) => handler(value)),
});