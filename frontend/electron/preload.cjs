const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
    selectFiles: (kind) => ipcRenderer.invoke('select-files', kind),
    onFileDrop: (callback) => {
      const listener = (_, path) => callback(path);
      ipcRenderer.on('file-drop', listener);
      return () => ipcRenderer.removeListener('file-drop', listener);
    },
    /**
     * Returns the absolute filesystem path for a File object obtained via drag & drop or
     * an <input type="file">. In Electron 32+ the legacy `File.path` property was removed,
     * so this is the only supported way to get a real path from the renderer.
     */
    getPathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return null;
      }
    },
    statFile: (path) => ipcRenderer.invoke('stat-file', path),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    onUpdateStatus: (callback) => {
      const listener = (_, payload) => callback(payload);
      ipcRenderer.on('update-status', listener);
      return () => ipcRenderer.removeListener('update-status', listener);
    },

    // Companion extension (Chrome cookies sync)
    getCompanionExtensionInfo: () => ipcRenderer.invoke('companion-extension-info'),
    exportCompanionExtension: () => ipcRenderer.invoke('companion-extension-export'),
});
