/**
 * Self-repair for missing runtime components.
 *
 * GravityDown ships everything it needs inside the install: the engine (Python
 * + yt-dlp frozen into one exe) and ffmpeg/ffprobe. In practice components go
 * missing anyway:
 *
 *   - Windows Defender / SmartScreen quarantines the unsigned engine exe,
 *     usually minutes after the first launch.
 *   - A user upgrading from an old build whose installer never shipped a
 *     component that newer code depends on.
 *   - An interrupted or partially-extracted install.
 *
 * Previously any of these left the app permanently dead with a generic
 * "backend unavailable" dialog. Now they are detected at startup and the
 * missing pieces are downloaded into the per-user data directory, which is both
 * writable without admin rights and outside the install dir the antivirus is
 * watching.
 *
 * Integrity: the engine is an executable we are about to run, so it is only
 * accepted when its SHA-256 matches the digest published alongside the release.
 * ffmpeg is verified against the checksum its publisher serves next to the zip.
 * A download that fails verification is deleted, never executed.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = 'MatLumber/Mi-Downloader';
const FFMPEG_ZIP_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const FFMPEG_SHA_URL = `${FFMPEG_ZIP_URL}.sha256`;
const USER_AGENT = 'GravityDown-Repair';

const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

/** Per-user directory for repaired components. Writable without admin rights. */
function runtimeDir() {
  return path.join(app.getPath('userData'), 'runtime');
}

function engineRuntimePath() {
  return path.join(runtimeDir(), 'backend', 'gravitydown-engine.exe');
}

function ffmpegRuntimeDir() {
  return path.join(runtimeDir(), 'ffmpeg');
}

// --------------------------------------------------------------------------
// HTTP
// --------------------------------------------------------------------------

function httpGet(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, timeout: 60_000 },
      (res) => {
        // GitHub release assets redirect to an object-storage host.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
          const next = new URL(res.headers.location, url).toString();
          if (!next.startsWith('https://')) return reject(new Error('refusing non-HTTPS redirect'));
          return resolve(httpGet(next, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        resolve(res);
      }
    );
    req.on('timeout', () => { req.destroy(new Error('connection timed out')); });
    req.on('error', reject);
  });
}

async function fetchText(url) {
  const res = await httpGet(url);
  return new Promise((resolve, reject) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      if (body.length > 1_000_000) {
        res.destroy();
        reject(new Error('response too large'));
        return;
      }
      body += chunk;
    });
    res.on('end', () => resolve(body));
    res.on('error', reject);
  });
}

/** Stream `url` to `dest`, reporting 0-100 progress. Partial files are removed. */
async function download(url, dest, onProgress) {
  const res = await httpGet(url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const total = Number(res.headers['content-length']) || 0;
  let received = 0;
  let lastReported = -1;

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const timer = setTimeout(() => {
      res.destroy(new Error('download timed out'));
    }, DOWNLOAD_TIMEOUT_MS);

    const fail = (err) => {
      clearTimeout(timer);
      file.destroy();
      fs.rm(dest, { force: true }, () => reject(err));
    };

    res.on('data', (chunk) => {
      received += chunk.length;
      if (total && onProgress) {
        const percent = Math.floor((received / total) * 100);
        if (percent !== lastReported) {
          lastReported = percent;
          onProgress(percent);
        }
      }
    });
    res.on('error', fail);
    file.on('error', fail);
    file.on('finish', () => { clearTimeout(timer); resolve(); });
    res.pipe(file);
  });

  return dest;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
  });
}

/**
 * Download and verify. A file whose digest does not match is deleted rather
 * than kept — we are about to execute some of these.
 */
async function downloadVerified(url, dest, expectedSha256, onProgress) {
  await download(url, dest, onProgress);

  if (!expectedSha256) return dest;

  const actual = await sha256File(dest);
  if (actual !== expectedSha256.toLowerCase()) {
    fs.rmSync(dest, { force: true });
    throw new Error(`checksum mismatch for ${path.basename(dest)} (expected ${expectedSha256}, got ${actual})`);
  }
  return dest;
}

// --------------------------------------------------------------------------
// Component repair
// --------------------------------------------------------------------------

/**
 * Digests for this release's components, published by CI next to the
 * installers. Missing or unparseable means we cannot verify, so we refuse to
 * download the engine rather than run an unverified executable.
 */
async function fetchComponentManifest(version) {
  const candidates = [
    `https://github.com/${REPO}/releases/download/v${version}/components.json`,
    `https://github.com/${REPO}/releases/latest/download/components.json`,
  ];
  for (const url of candidates) {
    try {
      const parsed = JSON.parse(await fetchText(url));
      if (parsed && parsed.engine && parsed.engine.sha256) return parsed;
    } catch {
      // Try the next candidate; a repo with no components.json yet is normal
      // for installs predating this feature.
    }
  }
  return null;
}

async function repairEngine(version, onProgress) {
  const manifest = await fetchComponentManifest(version);
  if (!manifest) {
    throw new Error(
      'no hay manifiesto de componentes en la release; no se puede verificar el motor antes de ejecutarlo'
    );
  }

  const url =
    manifest.engine.url ||
    `https://github.com/${REPO}/releases/download/v${manifest.version || version}/gravitydown-engine.exe`;

  const dest = engineRuntimePath();
  const tmp = `${dest}.part`;
  await downloadVerified(url, tmp, manifest.engine.sha256, onProgress);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { force: true });
  fs.renameSync(tmp, dest);
  return dest;
}

/**
 * ffmpeg + ffprobe from the publisher's "release essentials" build, verified
 * against the .sha256 served next to the zip. Extraction uses PowerShell's
 * Expand-Archive so this needs no third-party unzip dependency.
 */
async function repairFfmpeg(onProgress) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-ffmpeg-'));
  const zipPath = path.join(workDir, 'ffmpeg.zip');

  try {
    let expected = null;
    try {
      // Format is "<sha256>  <filename>" or a bare digest.
      const raw = (await fetchText(FFMPEG_SHA_URL)).trim();
      const match = raw.match(/\b[a-f0-9]{64}\b/i);
      if (match) expected = match[0];
    } catch {
      // Publisher checksum unavailable — see the guard below.
    }
    if (!expected) {
      throw new Error('no se pudo obtener el checksum de ffmpeg; se cancela la descarga');
    }

    await downloadVerified(FFMPEG_ZIP_URL, zipPath, expected, onProgress);

    const extractDir = path.join(workDir, 'x');
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`],
      { stdio: 'ignore', timeout: 5 * 60 * 1000 }
    );

    const found = {};
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'ffmpeg.exe' || entry.name === 'ffprobe.exe') found[entry.name] = full;
      }
    };
    walk(extractDir);

    if (!found['ffmpeg.exe'] || !found['ffprobe.exe']) {
      throw new Error('el archivo de ffmpeg no contenía ffmpeg.exe y ffprobe.exe');
    }

    const target = ffmpegRuntimeDir();
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(found['ffmpeg.exe'], path.join(target, 'ffmpeg.exe'));
    fs.copyFileSync(found['ffprobe.exe'], path.join(target, 'ffprobe.exe'));
    return target;
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => { });
  }
}

// --------------------------------------------------------------------------
// Resolution + orchestration
// --------------------------------------------------------------------------

/**
 * Where each component actually lives right now.
 *
 * The install directory wins; the repaired copy under userData is the fallback.
 * That ordering matters for updates: a fresh install ships a matching engine,
 * and it must take precedence over a repaired copy left behind by an older
 * version.
 */
function resolveComponents({ isDev, installedEngine, installedFfmpegDir }) {
  const engine = installedEngine && fs.existsSync(installedEngine)
    ? installedEngine
    : (fs.existsSync(engineRuntimePath()) ? engineRuntimePath() : null);

  const pickFfmpeg = (dir) =>
    dir && fs.existsSync(path.join(dir, 'ffmpeg.exe')) && fs.existsSync(path.join(dir, 'ffprobe.exe'))
      ? dir
      : null;

  const ffmpegDir = pickFfmpeg(installedFfmpegDir) || pickFfmpeg(ffmpegRuntimeDir());

  // In dev, a developer's own ffmpeg on PATH counts — the engine's _find_binary
  // falls back to PATH too. Without this, `npm run electron:dev` on a checkout
  // that never populated backend/ffmpeg would trigger an 80 MB download.
  const ffmpegOnPath = !ffmpegDir && isDev && hasFfmpegOnPath();

  return {
    engine,
    ffmpegDir,
    missing: [
      // In dev the engine runs from source, so it can never be "missing".
      ...(!engine && !isDev ? ['engine'] : []),
      ...(!ffmpegDir && !ffmpegOnPath ? ['ffmpeg'] : []),
    ],
  };
}

function hasFfmpegOnPath() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['ffmpeg.exe', 'ffprobe.exe'] : ['ffmpeg', 'ffprobe'];
  return names.every((name) => dirs.some((dir) => {
    try {
      return fs.existsSync(path.join(dir, name));
    } catch {
      return false;
    }
  }));
}

/**
 * Download whatever is missing.
 *
 * @param {object} options
 * @param {string[]} options.missing        component ids from resolveComponents
 * @param {string}   options.version        app version, used to pick the release
 * @param {(e: {component: string, phase: string, percent?: number, message?: string}) => void} [options.onProgress]
 * @returns {Promise<{repaired: string[], failed: {component: string, error: string}[]}>}
 */
async function repairComponents({ missing, version, onProgress = () => { } }) {
  const repaired = [];
  const failed = [];

  for (const component of missing) {
    onProgress({ component, phase: 'start' });
    try {
      if (component === 'engine') {
        await repairEngine(version, (percent) => onProgress({ component, phase: 'download', percent }));
      } else if (component === 'ffmpeg') {
        await repairFfmpeg((percent) => onProgress({ component, phase: 'download', percent }));
      } else {
        continue;
      }
      repaired.push(component);
      onProgress({ component, phase: 'done' });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      failed.push({ component, error: message });
      onProgress({ component, phase: 'failed', message });
    }
  }

  return { repaired, failed };
}

module.exports = {
  runtimeDir,
  engineRuntimePath,
  ffmpegRuntimeDir,
  resolveComponents,
  repairComponents,
};
