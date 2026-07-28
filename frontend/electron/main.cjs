const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { resolveComponents, repairComponents } = require('./repair.cjs');

let mainWindow;
let pythonProcess;

const isDev = !app.isPackaged;

// ---------------------------------------------------------------------------
// Backend endpoint discovery
//
// The engine no longer hardcodes 8765: it binds the first free port in
// [8765, 8789) and advertises the result on stdout and in an endpoint file
// under %LOCALAPPDATA%\GravityDown. A stale engine from a crashed session (or
// any unrelated process) squatting on 8765 used to leave the app permanently
// dead with a generic "backend no disponible" dialog.
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 8765;
const PORT_SCAN_RANGE = 24;

let backendPort = DEFAULT_PORT;
let backendReady = false;
let backendRestarts = 0;
let shuttingDown = false;
// Set by ensureBackend() once component resolution has run; may point at a
// repaired copy under userData rather than the install directory.
let resolvedEnginePath = null;

const MAX_BACKEND_RESTARTS = 3;

const backendBaseUrl = () => `http://127.0.0.1:${backendPort}`;

function endpointFilePath() {
  const base = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
  return path.join(base, 'GravityDown', 'backend-endpoint.json');
}

function readEndpointFile() {
  try {
    const raw = fs.readFileSync(endpointFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Number.isInteger(parsed.port)) return parsed.port;
  } catch {
    // Absent or mid-write — the stdout banner and the port probe both cover us.
  }
  return null;
}

/** Resolve GET / on a port and report whether it is *our* engine answering. */
function probeEngine(port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          // A foreign server could stream forever; we only need the header.
          if (body.length < 4096) body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body).name === 'GravityDown API');
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

/** Find an already-running engine, if any, so we never spawn a second one. */
async function discoverRunningEngine() {
  const fromFile = readEndpointFile();
  if (fromFile && (await probeEngine(fromFile))) return fromFile;

  for (let offset = 0; offset < PORT_SCAN_RANGE; offset += 1) {
    const port = DEFAULT_PORT + offset;
    if (port === fromFile) continue;
    if (await probeEngine(port)) return port;
  }
  return null;
}

function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'MatLumber',
    repo: 'Mi-Downloader',
    private: false,
  });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = log;
  log.transports.file.level = 'info';

  const notifyRenderer = (payload) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', payload);
    }
  };

  autoUpdater.on('checking-for-update', () => {
    log.info('[Updater] Checking for updates...');
    appendUpdaterLog('Checking for updates');
    notifyRenderer({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info(`[Updater] Update available: ${info?.version || ''}`);
    appendUpdaterLog(`Update available: ${info?.version || ''}`);
    notifyRenderer({ status: 'available', version: info?.version || '' });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info(`[Updater] No updates: ${info?.version || ''}`);
    appendUpdaterLog(`No updates: ${info?.version || ''}`);
    notifyRenderer({ status: 'idle' });
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info(`[Updater] Download ${progress.percent?.toFixed(1)}%`);
    appendUpdaterLog(`Download ${progress.percent?.toFixed(1)}%`);
    notifyRenderer({ status: 'downloading', percent: progress.percent || 0 });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[Updater] Update downloaded. Installing...');
    appendUpdaterLog(`Update downloaded: ${info?.version || ''}`);
    notifyRenderer({ status: 'downloaded', version: info?.version || '' });
    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true);
    }, 2500);
  });

  autoUpdater.on('error', (error) => {
    log.error(`[Updater] ${error?.message || error}`);
    appendUpdaterLog(`Error: ${error?.message || error}`);
    notifyRenderer({ status: 'error', message: String(error?.message || error) });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      log.error(`[Updater] ${error?.message || error}`);
      appendUpdaterLog(`Check failed: ${error?.message || error}`);
    });
  }, 2000);
}

const backendLogPath = () => path.join(app.getPath('userData'), 'backend.log');
const updaterLogPath = () => path.join(app.getPath('userData'), 'logs', 'updater.log');

function appendBackendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(backendLogPath(), line);
  } catch (error) {
    console.log('[Backend] Failed to write log:', error.message);
  }
}

function appendUpdaterLog(message) {
  try {
    const logPath = updaterLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch (error) {
    console.log('[Updater] Failed to write log:', error.message);
  }
}

// Kill Python process tree on Windows.
//
// The tree matters: the engine spawns ffmpeg children, and killing only the
// parent leaves them running with the output file open.
function killPythonProcess() {
  if (pythonProcess && pythonProcess.pid) {
    // Suppress the auto-restart that the 'close' handler would otherwise
    // trigger — this exit is intentional.
    const child = pythonProcess;
    pythonProcess = null;
    child.removeAllListeners('close');
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
      console.log('[Backend] Process killed successfully');
    } catch (error) {
      console.log('[Backend] Process already terminated or error:', error.message);
    }
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
    // In dev the icon lives in public/; Vite copies it into dist/ for the
    // packaged build, and `files` only ships dist/ and electron/.
    icon: isDev
      ? path.join(__dirname, '../public/icon.ico')
      : path.join(__dirname, '../dist/icon.ico'),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // The renderer boots before the engine is guaranteed up; push it the current
  // endpoint as soon as it can receive messages, then on every change.
  mainWindow.webContents.on('did-finish-load', () => {
    notifyRendererBackend();
    replayRepairStatus();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // Handle file drop via navigation (older Electron versions)
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
        if (filePath && mainWindow) {
          console.log('[Main] File drop via navigation:', filePath);
          mainWindow.webContents.send('file-drop', filePath);
        }
      } catch (error) {
        console.error('[Main] Error parsing file URL:', error);
      }
      return;
    }

    const allowed = isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file:');
    if (!allowed) {
      event.preventDefault();
    }
  });

  // Handle drag-and-drop events more reliably
  mainWindow.webContents.on('did-create-window', (window) => {
    window.close();
  });

  // Intercept drag-and-drop at the session level for better reliability
  const session = mainWindow.webContents.session;
  session.on('will-download', (event, item, webContents) => {
    event.preventDefault();
  });

  // Use webRequest API to intercept file:// URLs from drag-and-drop
  // This is more reliable than will-navigate in newer Electron versions
  session.webRequest.onBeforeRequest({ urls: ['file://*'] }, (details, callback) => {
    try {
      const url = new URL(details.url);
      let filePath = decodeURIComponent(url.pathname || '');

      // Fix Windows paths (remove leading slash from /C:/path)
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }

      // Clean up the path
      filePath = filePath.replace(/\r?\n/g, '').replace(/\r/g, '');

      const normalizedFilePath = path.normalize(filePath);
      const appRoot = path.normalize(path.join(__dirname, '../dist'));
      const isAppFile = normalizedFilePath.startsWith(appRoot) || normalizedFilePath.includes('app.asar');

      // Allow the app's own files (HTML, JS, CSS, assets)
      if (isAppFile) {
        callback({ cancel: false });
        return;
      }

      // Forward any media file (video, audio, image) — let the renderer filter by current screen
      const mediaExtensions = /\.(mp4|mkv|webm|avi|mov|m4v|mp3|aac|wav|flac|ogg|opus|m4a|png|jpe?g|webp|bmp|tiff?)$/i;
      if (mediaExtensions.test(filePath) && mainWindow) {
        console.log('[Main] File drop via webRequest:', filePath);
        mainWindow.webContents.send('file-drop', filePath);
      }

      // Cancel navigation to dropped files
      callback({ cancel: true });
    } catch (error) {
      console.error('[Main] Error parsing file URL in webRequest:', error);
      callback({ cancel: false });
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

/** Where the installer puts ffmpeg/ffprobe (electron-builder `extraResources`). */
function installedFfmpegDir() {
  return isDev
    ? path.join(__dirname, '../../backend/ffmpeg')
    : path.join(process.resourcesPath, 'ffmpeg');
}

/** Current location of every runtime component, install dir first. */
function currentComponents() {
  return resolveComponents({
    isDev,
    installedEngine: isDev ? null : resolveBackendExe(),
    installedFfmpegDir: installedFfmpegDir(),
  });
}

const COMPONENT_LABELS = {
  engine: 'el motor de descargas',
  ffmpeg: 'ffmpeg (compresión y conversión)',
};

/**
 * Detect and re-download missing components before starting the engine.
 *
 * Everything ships inside the install, so this normally finds nothing. It
 * matters when a component went missing afterwards — antivirus quarantine of
 * the unsigned engine exe being by far the most common cause — and for users
 * upgrading from a build that never shipped a piece newer code needs. Rather
 * than a dead app with a generic error, the missing piece is fetched into the
 * per-user data directory (writable without admin, outside the folder the
 * antivirus is watching).
 */
async function ensureComponentsPresent() {
  let components = currentComponents();
  if (components.missing.length === 0) return components;

  appendBackendLog(`Missing components: ${components.missing.join(', ')} — attempting repair`);

  const describe = components.missing.map((c) => COMPONENT_LABELS[c] || c).join(' y ');
  notifyRepair({ phase: 'start', components: components.missing, message: `Falta ${describe}. Descargando…` });

  const { repaired, failed } = await repairComponents({
    missing: components.missing,
    version: app.getVersion(),
    onProgress: (event) => {
      if (event.phase === 'download' && typeof event.percent === 'number') {
        notifyRepair({ phase: 'download', component: event.component, percent: event.percent });
      } else if (event.phase === 'failed') {
        appendBackendLog(`Repair failed for ${event.component}: ${event.message}`);
      }
    },
  });

  if (repaired.length) appendBackendLog(`Repaired: ${repaired.join(', ')}`);

  components = currentComponents();
  notifyRepair({
    phase: components.missing.length === 0 ? 'done' : 'failed',
    repaired,
    failed,
    message:
      components.missing.length === 0
        ? 'Componentes restaurados.'
        : `No se pudo restaurar ${components.missing.map((c) => COMPONENT_LABELS[c] || c).join(' y ')}.`,
  });

  return components;
}

/**
 * Poll the engine until it answers. The budget is generous on purpose: on a
 * cold start Windows Defender scans the ~23 MB PyInstaller bundle before the
 * first line of Python executes, which regularly takes 15-25s on the first
 * launch after an update. The previous 10s budget surfaced a hard error dialog
 * on machines where the backend was merely slow.
 */
function waitForBackend(retries = 90, delay = 400) {
  return new Promise((resolve) => {
    const attempt = async (remaining) => {
      if (shuttingDown) return resolve(false);

      // Re-read the endpoint file on every pass. It is the authoritative
      // channel — the stdout banner can be lost entirely, because the frozen
      // engine runs as a GUI-subsystem process whose stdout may be null.
      const advertised = readEndpointFile();
      if (advertised && advertised !== backendPort) backendPort = advertised;

      if (await probeEngine(backendPort, 1200)) return resolve(true);
      if (remaining <= 0) return resolve(false);
      setTimeout(() => attempt(remaining - 1), delay);
    };
    attempt(retries);
  });
}

function resolveDevPython() {
  const backendPath = path.join(__dirname, '../../backend');
  const venvPython = path.join(backendPath, 'venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPython)) return venvPython;
  // Fall back to whatever python is on PATH so a fresh clone can run the app
  // before anyone has created the venv.
  return process.platform === 'win32' ? 'python' : 'python3';
}

function startPythonBackend() {
  if (shuttingDown) return;

  // Dev and prod both go through main.py's own entry point so the port
  // selection and endpoint-file publishing behave identically. Invoking
  // `uvicorn main:app` directly (the old dev path) bypassed both.
  if (isDev) {
    const backendPath = path.join(__dirname, '../../backend');
    pythonProcess = spawn(resolveDevPython(), ['main.py'], {
      cwd: backendPath,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
  } else {
    // Prefer whatever component resolution settled on — that may be a repaired
    // copy under userData when the installed one was quarantined.
    const backendExe = resolvedEnginePath || resolveBackendExe();
    if (!fs.existsSync(backendExe)) {
      appendBackendLog(`Engine binary missing at ${backendExe}`);
      return;
    }
    pythonProcess = spawn(backendExe, [], {
      cwd: path.dirname(backendExe),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });
  }

  pythonProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[Backend] ${text}`);
    appendBackendLog(text);

    // The engine announces its bound port on the first line. Reading it here
    // is faster and more reliable than polling the endpoint file.
    const match = text.match(/GRAVITYDOWN_ENDPOINT http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      backendPort = Number(match[1]);
      appendBackendLog(`Engine bound to port ${backendPort}`);
      notifyRendererBackend();
    }
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
    pythonProcess = null;
    if (shuttingDown) return;

    // Crash recovery. A backend that dies mid-session (OOM during a 4K merge,
    // antivirus quarantine, an unhandled extractor bug) used to leave the UI
    // permanently disconnected with no way back short of restarting the app.
    if (backendRestarts < MAX_BACKEND_RESTARTS) {
      backendRestarts += 1;
      appendBackendLog(`Restarting engine (attempt ${backendRestarts}/${MAX_BACKEND_RESTARTS})`);
      setTimeout(() => {
        startPythonBackend();
        waitForBackend(40).then((ready) => {
          backendReady = ready;
          notifyRendererBackend();
        });
      }, 1000 * backendRestarts);
    } else {
      backendReady = false;
      notifyRendererBackend();
    }
  });
}

function notifyRendererBackend() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('backend-status', {
      ready: backendReady,
      baseUrl: backendBaseUrl(),
      port: backendPort,
      restarts: backendRestarts,
    });
  }
}

// Repair starts before the renderer has finished loading, so its messages would
// otherwise be sent into the void. Keep the last one and replay it once the
// window is ready — a first launch that has to re-download a quarantined
// component must not look like a hang.
let lastRepairStatus = null;

function notifyRepair(payload) {
  lastRepairStatus = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('repair-status', payload);
  }
}

function replayRepairStatus() {
  if (lastRepairStatus && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('repair-status', lastRepairStatus);
  }
}

/**
 * Bring the engine up: reuse one that is already listening, otherwise spawn.
 * Returns true once the API answers.
 */
async function ensureBackend() {
  // Repair before spawning: waiting 36s for a binary that does not exist helps
  // nobody, and most of the time we can simply fetch it back.
  const components = await ensureComponentsPresent();

  if (components.missing.includes('engine')) {
    backendReady = false;
    notifyRendererBackend();
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Falta el motor de descargas',
      message: 'No se encontró el motor y no se pudo descargar automáticamente.',
      detail:
        'Casi siempre es el antivirus, que pone en cuarentena el ejecutable por no estar firmado.\n\n' +
        'Añade una excepción para la carpeta de GravityDown y reinstala, o comprueba tu conexión ' +
        'y vuelve a intentarlo.\n\n' +
        `Log: ${backendLogPath()}`,
      buttons: ['Reintentar', 'Ver log', 'Cerrar'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice === 0) return ensureBackend();
    if (choice === 1) shell.openPath(backendLogPath());
    return false;
  }

  // ffmpeg missing is degraded, not fatal: downloading still works, only
  // Compress/Convert are affected. The Settings panel surfaces the state.
  if (components.missing.includes('ffmpeg')) {
    appendBackendLog('Continuing without ffmpeg — compress/convert will be unavailable');
  }

  // Point the engine at whichever ffmpeg we ended up with. `_find_binary` in
  // main.py checks FFMPEG_PATH/FFPROBE_PATH first, so a repaired copy under
  // userData is picked up without the engine knowing anything about repair.
  if (components.ffmpegDir) {
    process.env.FFMPEG_PATH = path.join(components.ffmpegDir, 'ffmpeg.exe');
    process.env.FFPROBE_PATH = path.join(components.ffmpegDir, 'ffprobe.exe');
  }
  resolvedEnginePath = components.engine;

  const existing = await discoverRunningEngine();
  if (existing) {
    // Reusing an orphan from a previous crashed session is strictly better than
    // spawning a second engine that would then fail to bind.
    backendPort = existing;
    appendBackendLog(`Reusing engine already listening on ${existing}`);
    backendReady = true;
    notifyRendererBackend();
    return true;
  }

  startPythonBackend();
  backendReady = await waitForBackend();

  if (!backendReady) {
    const fromFile = readEndpointFile();
    if (fromFile && fromFile !== backendPort && (await probeEngine(fromFile))) {
      backendPort = fromFile;
      backendReady = true;
    }
  }

  notifyRendererBackend();
  return backendReady;
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

const FILE_KIND_FILTERS = {
  video: { name: 'Videos', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'] },
  audio: { name: 'Audios', extensions: ['mp3', 'aac', 'wav', 'flac', 'ogg', 'opus', 'm4a'] },
  media: { name: 'Audio y Video', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'mp3', 'aac', 'wav', 'flac', 'ogg', 'opus', 'm4a'] },
  image: { name: 'Imagenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'] },
  any: { name: 'Archivos', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'mp3', 'aac', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'] },
  cookies: { name: 'Cookies', extensions: ['txt'] },
};

ipcMain.handle('select-file', async (_, kind = 'video') => {
  const filter = FILE_KIND_FILTERS[kind] || FILE_KIND_FILTERS.video;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [filter]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-files', async (_, kind = 'video') => {
  const filter = FILE_KIND_FILTERS[kind] || FILE_KIND_FILTERS.video;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [filter]
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.on('file-drop', (_, filePath) => {
  if (mainWindow) {
    mainWindow.webContents.send('file-drop', filePath || '');
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

// The renderer asks for this before its first request instead of assuming
// 127.0.0.1:8765, which is no longer guaranteed to be the engine's port.
ipcMain.handle('get-backend-status', () => ({
  ready: backendReady,
  baseUrl: backendBaseUrl(),
  port: backendPort,
  restarts: backendRestarts,
}));

ipcMain.handle('restart-backend', async () => {
  backendRestarts = 0;
  killPythonProcess();
  const ready = await ensureBackend();
  return { ready, baseUrl: backendBaseUrl(), port: backendPort };
});

ipcMain.handle('open-backend-log', () => shell.openPath(backendLogPath()));

// Companion extension: export the bundled extension folder to a user-chosen
// directory and open Explorer there. The user then loads it as unpacked in
// chrome://extensions. The source folder lives next to package.json in dev,
// and inside resources/companion-extension/ in the packaged app (because
// extraResources copies it there at build time).
function getCompanionExtensionSourceDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'companion-extension');
  }
  return path.join(__dirname, '..', 'companion-extension');
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

ipcMain.handle('companion-extension-info', () => {
  const src = getCompanionExtensionSourceDir();
  const exists = fs.existsSync(src) && fs.existsSync(path.join(src, 'manifest.json'));
  let version = null;
  if (exists) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
      version = manifest.version || null;
    } catch { /* manifest unreadable — keep version null */ }
  }
  return { exists, sourceDir: src, version };
});

ipcMain.handle('companion-extension-export', async () => {
  const src = getCompanionExtensionSourceDir();
  if (!fs.existsSync(src)) {
    return { ok: false, reason: 'source_missing', sourceDir: src };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona dónde guardar la extensión Companion',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: path.join(app.getPath('documents'), 'GravityDown'),
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, reason: 'cancelled' };
  }
  const destBase = result.filePaths[0];
  const dest = path.join(destBase, 'GravityDown-Companion');
  try {
    copyDirRecursive(src, dest);
  } catch (err) {
    return { ok: false, reason: 'copy_failed', message: String(err) };
  }
  shell.openPath(dest).catch(() => { /* best-effort open */ });
  return { ok: true, path: dest };
});

ipcMain.handle('stat-file', async (_, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return { size: stats.size };
  } catch (error) {
    return null;
  }
});

// Global drag-and-drop handler for all web contents
app.on('web-contents-created', (_, webContents) => {
  webContents.on('will-navigate', (event, url) => {
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
          console.log('[Main] Global file drop handler:', filePath);
          webContents.send('file-drop', filePath);
        }
      } catch (error) {
        console.error('[Main] Global handler error:', error);
      }
    }
  });
});

// Single-instance lock. Two copies of the app used to race for the same port:
// the loser's engine failed to bind, its window came up permanently offline,
// and quitting either one killed the shared backend.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // The window is created first and shows its own "connecting" state, so a
    // slow engine start reads as a loading app instead of a frozen one.
    createWindow();
    setupAutoUpdater();

    const ready = await ensureBackend();

    if (!ready) {
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Motor no disponible',
        message: 'El motor de descargas no pudo iniciarse.',
        detail:
          'Suele deberse a que el antivirus puso en cuarentena gravitydown-engine.exe, ' +
          'o a que no hay puertos libres entre 8765 y 8788.\n\n' +
          `Log: ${backendLogPath()}`,
        buttons: ['Reintentar', 'Ver log', 'Cerrar'],
        defaultId: 0,
        cancelId: 2,
      });

      if (choice === 0) {
        backendRestarts = 0;
        ensureBackend();
      } else if (choice === 1) {
        shell.openPath(backendLogPath());
      }
    }
  });

  app.on('window-all-closed', () => {
    shuttingDown = true;
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
    shuttingDown = true;
    killPythonProcess();
  });
}

