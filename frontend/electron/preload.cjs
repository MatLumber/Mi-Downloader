const { contextBridge, ipcRenderer } = require('electron');

// Drag and drop is handled in renderer; navigation is blocked in main.

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    
    // File system
    openPath: (path) => ipcRenderer.send('open-path', path),
    showItemInFolder: (path) => ipcRenderer.send('show-in-folder', path),
    openFolder: (path) => ipcRenderer.send('open-folder', path),
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    selectFile: (kind) => ipcRenderer.invoke('select-file', kind),
    onFileDrop: (callback) => ipcRenderer.on('file-drop', (_, path) => callback(path)),
    statFile: (path) => ipcRenderer.invoke('stat-file', path),
});
