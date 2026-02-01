const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execSync } = require('child_process');

let mainWindow;
let pythonProcess;

const isDev = !app.isPackaged;

function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = log;
  log.transports.file.level = 'info';

  autoUpdater.on('error', (error) => {
    log.error(`[Updater] ${error?.message || error}`);
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Actualizacion fallida',
        message: 'No se pudo completar la actualizacion automaticamente.',
        detail: String(error?.message || error),
      });
    }
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    log.error(`[Updater] ${error?.message || error}`);
  });
}

const backendLogPath = () => path.join(app.getPath('userData'), 'backend.log');

function appendBackendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(backendLogPath(), line);
  } catch (error) {
    console.log('[Backend] Failed to write log:', error.message);
  }
}

// Kill Python process tree on Windows
function killPythonProcess() {
  if (pythonProcess && pythonProcess.pid) {
    try {
      // Windows: use taskkill to kill the entire process tree
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${pythonProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        pythonProcess.kill('SIGTERM');
      }
      console.log('[Backend] Process killed successfully');
    } catch (error) {
      console.log('[Backend] Process already terminated or error:', error.message);
    }
    pythonProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 650,
    frame: false,
    transparent: false,
    backgroundColor: '#050505',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, '../public/icon.ico'),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) {
      event.preventDefault();
      try {
        const parsed = new URL(url);
        let filePath = decodeURIComponent(parsed.pathname || '');
        if (process.platform === 'win32' && filePath.startsWith('/')) {
          filePath = filePath.slice(1);
        }
        filePath = filePath.replace(/\r?\n/g, '').replace(/\r/g, '');
        if (filePath) {
          mainWindow.webContents.send('file-drop', filePath);
        }
      } catch (error) {
        // ignore
      }
      return;
    }

    const allowed = isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file:');
    if (!allowed) {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function resolveBackendExe() {
  const packagedPath = path.join(process.resourcesPath, 'backend', 'gravitydown-engine.exe');
  if (fs.existsSync(packagedPath)) return packagedPath;

  const siblingPath = path.join(path.dirname(process.execPath), 'backend', 'gravitydown-engine.exe');
  if (fs.existsSync(siblingPath)) return siblingPath;

  return packagedPath;
}

function waitForBackend(retries = 25, delay = 400) {
  return new Promise((resolve) => {
    const attempt = (remaining) => {
      const req = http.get('http://127.0.0.1:8765/', (res) => {
        res.resume();
        resolve(true);
      });

      req.on('error', () => {
        if (remaining <= 0) return resolve(false);
        setTimeout(() => attempt(remaining - 1), delay);
      });
    };

    attempt(retries);
  });
}

function startPythonBackend() {
  if (isDev) {
    // Development: Use Python from venv
    const backendPath = path.join(__dirname, '../../backend');
    const pythonExe = path.join(backendPath, 'venv/Scripts/python.exe');

    pythonProcess = spawn(pythonExe, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8765'], {
      cwd: backendPath,
      env: { ...process.env },
    });
  } else {
    // Production: Use compiled executable
    const backendExe = resolveBackendExe();
    const backendDir = path.dirname(backendExe);

    pythonProcess = spawn(backendExe, [], {
      cwd: backendDir,
      env: { ...process.env },
    });
  }

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Backend] ${data}`);
    appendBackendLog(data.toString());
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error] ${data}`);
    appendBackendLog(data.toString());
  });

  pythonProcess.on('error', (error) => {
    appendBackendLog(`Process error: ${error.message}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`[Backend] Process exited with code ${code}`);
    appendBackendLog(`Process exited with code ${code}`);
  });
}


// Window control IPC handlers
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow?.close();
});

ipcMain.on('open-folder', (_, folderPath) => {
  const resolvedPath = folderPath.startsWith('~') ? folderPath.replace('~', app.getPath('home')) : folderPath;
  shell.openPath(resolvedPath);
});

ipcMain.on('open-path', (_, filePath) => {
  const resolvedPath = filePath.startsWith('~') ? filePath.replace('~', app.getPath('home')) : filePath;
  shell.openPath(resolvedPath);
});

ipcMain.on('show-in-folder', (_, filePath) => {
  const resolvedPath = filePath.startsWith('~') ? filePath.replace('~', app.getPath('home')) : filePath;
  shell.showItemInFolder(resolvedPath);
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) {
    return null;
  } else {
    return result.filePaths[0];
  }
});

ipcMain.handle('select-file', async (_, kind = 'video') => {
  const filtersByKind = {
    video: { name: 'Videos', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'] },
    audio: { name: 'Audios', extensions: ['mp3', 'aac', 'wav', 'flac', 'ogg', 'opus', 'm4a'] },
    image: { name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'] },
    any: { name: 'Archivos', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'mp3', 'aac', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'] },
  };
  const filter = filtersByKind[kind] || filtersByKind.video;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [filter]
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.on('file-drop', (_, filePath) => {
  if (mainWindow) {
    mainWindow.webContents.send('file-drop', filePath || '');
  }
});

ipcMain.handle('stat-file', async (_, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return { size: stats.size };
  } catch (error) {
    return null;
  }
});

app.whenReady().then(() => {
  startPythonBackend();
  
  // Wait for backend to start
  setTimeout(createWindow, 2000);
  setupAutoUpdater();

  waitForBackend().then((ready) => {
    if (!ready) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Backend no disponible',
        message: 'El motor de descargas no pudo iniciarse. Revisa antivirus o permisos.',
        detail: `Log: ${backendLogPath()}`
      });
    }
  });
});

app.on('window-all-closed', () => {
  killPythonProcess();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  killPythonProcess();
});

