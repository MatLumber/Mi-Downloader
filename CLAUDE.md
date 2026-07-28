# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GravityDown is a Windows desktop app for downloading and processing media (yt-dlp + ffmpeg), wrapped in an Electron shell with a React/TypeScript renderer. Two processes at runtime: an Electron main process, and a Python "engine" it spawns as a child. They talk over local HTTP + SSE on loopback.

**The product constraint that drives most design decisions: the user installs nothing.** Python, yt-dlp, ffmpeg and ffprobe all ship inside the release. Updates arrive through GitHub Releases via electron-updater, so any change must keep working for people already running an older build.

## Common commands

```bash
# Backend setup (from repo root) — dev only; end users never do this
cd backend
python -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.txt

# Run the engine standalone (useful for API work)
cd backend && ./venv/Scripts/python.exe main.py     # prints the port it bound

# Dev app (Vite + Electron + engine)
cd frontend
npm install
npm run electron:dev

# Lint / type-check / build renderer
cd frontend
npm run lint
npm run build            # tsc -b && vite build

# Full local installer build (backend exe + renderer + NSIS/portable)
./build.bat              # from repo root; validates toolchain and smoke-tests the engine
```

There is no test suite. Do not invent test commands. Verification is done by running the engine and hitting its endpoints (see "Verifying changes" below).

## Architecture

### Three runtime layers

1. **Renderer** (`frontend/src/`) — React 19 + Zustand + Tailwind v4. Talks to the engine via `fetch`/`EventSource` (`src/api/client.ts`) and to Electron via `window.electronAPI` (`electron/preload.cjs`, typed in `src/types/electron.d.ts`). The window is **frameless** (`frame: false`); `TitleBar.tsx` reimplements minimize/maximize/close over IPC.

2. **Electron main** (`frontend/electron/main.cjs`) — owns the app lifecycle: single-instance lock, component repair, engine spawn/supervision, port discovery, auto-update, native dialogs, file-drop interception, and process-tree teardown of the engine on quit.

3. **Python engine** (`backend/main.py` + `backend/downloader.py`) — FastAPI on loopback. Three independent task domains, each with the same status/events/cancel triplet:
   - **Download**: `POST /download` → `DownloadManager` (yt-dlp wrapper in `downloader.py`).
   - **Compress**: `POST /compress` → ffmpeg with libx264/libvpx-vp9 or a GPU encoder (h264_nvenc/qsv/amf). Tasks in `compression_tasks` under `compression_lock`. **One at a time** — returns 409 otherwise.
   - **Convert**: `POST /convert` → ffmpeg for video/audio/image. Tasks in `convert_tasks` under `convert_lock`. Concurrent conversions are allowed.

   All three expose `POST /{domain}` → `GET /{domain}/status/{id}` → `GET /{domain}/events/{id}` (SSE) → `DELETE /{domain}/cancel/{id}`. The renderer mirrors this with `subscribeToEvents` in `src/api/client.ts`.

### Port discovery — the engine's port is NOT fixed

The engine binds the first free port in `[8765, 8789)` (`pick_port` in `main.py`) and publishes it three ways:

1. `%LOCALAPPDATA%\GravityDown\backend-endpoint.json` — **authoritative**. Written before uvicorn serves; deleted on clean exit.
2. A `GRAVITYDOWN_ENDPOINT http://127.0.0.1:<port>` banner on stdout — a fast path only. The packaged engine is a GUI-subsystem process, so its stdout can be absent; never depend on it.
3. `GET /` returns `{"name": "GravityDown API", ...}`, used to tell our engine apart from an unrelated process squatting on 8765.

Consumers:
- **Electron** reads the endpoint file on every `waitForBackend` poll, and scans the range in `discoverRunningEngine` before spawning — so an orphaned engine from a crashed session is *reused*, not fought over.
- **Renderer** never hardcodes a port. `getApiBase()`/`setApiBase()` in `client.ts`; Electron pushes the value over the `backend-status` IPC channel, and `App.tsx` applies it. `8765` is only the pre-handshake guess.
- **Companion extension** caches the last working port in `chrome.storage.local` and rescans the range when it stops answering.

**If you add a caller, resolve the port — do not write `8765` into it.**

### Self-repair — missing components are re-downloaded

`frontend/electron/repair.cjs`. At startup `ensureComponentsPresent()` checks the engine exe and ffmpeg/ffprobe; anything missing is downloaded into `app.getPath('userData')/runtime/` (writable without admin, outside the folder antivirus watches). Resolution order is **install dir first, repaired copy second**, so a fresh install always wins over a stale repair.

The dominant real-world cause is Windows Defender quarantining the unsigned engine exe. Second is a user upgrading from a build that never shipped a component newer code needs.

**Integrity is not optional here — the engine is an executable we then run.** It is accepted only when its SHA-256 matches `components.json`, published as a release asset by CI alongside `gravitydown-engine.exe`. ffmpeg is verified against the `.sha256` its publisher serves next to the zip, then extracted with PowerShell `Expand-Archive` (no unzip dependency). A file that fails verification is deleted, never executed. **Do not add a download path that skips verification.**

Repaired ffmpeg is handed to the engine through the `FFMPEG_PATH`/`FFPROBE_PATH` env vars, which `_find_binary` checks first — the engine knows nothing about repair.

### Engine supervision

- **Single-instance lock** (`app.requestSingleInstanceLock()`): a second launch focuses the existing window instead of racing for the port.
- **Crash recovery**: the `close` handler respawns the engine up to `MAX_BACKEND_RESTARTS` (3) with linear backoff. `killPythonProcess()` detaches that handler first, so an intentional kill is not treated as a crash.
- **Startup budget** is 90 × 400 ms ≈ 36 s. This is deliberately generous: on the first launch after an update, Defender scans the ~23 MB engine before Python runs. The old 10 s budget produced a false "backend unavailable" on slow machines.
- The window is created **before** the engine is ready, so a slow start reads as loading rather than a freeze.

### Packaging

- Engine: PyInstaller one-file exe (`backend/gravitydown.spec`) → `backend/dist/gravitydown-engine.exe`.
  - `console=False` — no cmd window behind the app. Consequences that are easy to miss: `sys.stdout` may be `None` (guarded at the top of `main.py`), and child processes need `CREATE_NO_WINDOW` or ffmpeg flashes a console on every call (that's what `_run`/`_popen` in `main.py` are for — **use them, not `subprocess.run`/`Popen` directly**).
  - `upx=False` on purpose: a packed, unsigned exe doing network I/O is prime false-positive material for Defender/SmartScreen.
  - `pathex` is derived from `SPECPATH`, never absolute.
  - yt-dlp resolves extractors dynamically, so `collect_submodules('yt_dlp.extractor')` is load-bearing. Without it the frozen build only handles generic URLs.
- `frontend/package.json` `build.extraResources` copies the engine to `resources/backend/`, `backend/ffmpeg/` to `resources/ffmpeg/`, and the companion extension to `resources/companion-extension/`. **The installer cannot be built without `backend/dist/gravitydown-engine.exe` present**; `build.bat` enforces the ordering and smoke-tests the exe before packaging.

`_find_binary` (`backend/main.py`) resolves ffmpeg/ffprobe in order: `FFMPEG_PATH`/`FFPROBE_PATH` env → PyInstaller `_MEIPASS` → cwd → script dir → exe dir → `<exe>/ffmpeg/` → `<exe>/../ffmpeg/` → `PATH`.

### Release flow (CI)

`.github/workflows/build-release.yml` is a **reusable** workflow holding the entire Windows build. Three callers:

- `auto-tag.yml` — every push to `master`/`main` bumps the patch, tags, and releases. Skipped when the commit message contains `chore(release)` or the actor is `github-actions[bot]`.
- `release.yml` — manual `workflow_dispatch` or a `v*` tag push. Skipped for the bot so it doesn't double-build auto-tag's tag.
- `ytdlp-refresh.yml` — weekly. Cuts a release only when upstream yt-dlp differs from `.github/ytdlp-version.txt`. **This is what keeps installed copies working**: yt-dlp is frozen into the exe, and a version more than a few weeks old starts failing on YouTube with no user action involved.

Do not duplicate build steps back into the callers — they drifted before, and a broken build reaches every existing install through the updater.

CI gates a release on: bundled-asset presence (ffmpeg, ffprobe, icon), the frozen engine answering `GET /` **and** completing a real extraction, `npm run lint`, `tsc -b`, and every file named by `latest.yml` existing.

### Updater compatibility — do not change these

Existing installs find updates through `latest.yml` and the values below. Changing any of them strands users on their current version:

- `build.appId` = `com.gravitydown.app` (the NSIS install GUID derives from it)
- `build.productName` = `GravityDown`
- `artifactName` = `${productName}-${version}.${ext}` / `${productName}-Setup-${version}.${ext}`
- `build.publish` → github `MatLumber/Mi-Downloader`
- `nsis.oneClick: false`, `deleteAppDataOnUninstall: false`
- localStorage key `gravitydown-storage` (and `gravitydown-theme`) — renaming wipes history and settings

Renderer/engine protocol changes are safe: both ship in the same release. The **companion extension does not** — users load it unpacked in Chrome, so an old copy stays behind. That's why the engine still prefers port 8765 and why `/cookies/sync` must stay backward-compatible.

### State (renderer)

`src/store/useAppStore.ts` is the single Zustand store. It persists a curated subset (`partialize`) to `localStorage` under `gravitydown-storage`: tab state, format/quality preferences, history (videos/audios/conversions, capped at 50 each), output dirs, theme. The download queue is **not** persisted — in-flight downloads are lost on restart. `videoHistory`/`audioHistory` are separate lists; `downloadHistory` is a getter that merges and sorts. Dates are rehydrated in `onRehydrateStorage`. Theme is mirrored to `gravitydown-theme` for early-paint reads.

### Path conventions

User-facing paths use `~` as the home prefix (e.g. `~/Downloads/GravityDown`). Electron (`open-path`/`show-in-folder`/`open-folder`) and the Python `_expand_path` both resolve `~` before use. Never pass a `~`-path to a filesystem API unexpanded.

## Conventions worth knowing

- **User-facing strings are Spanish**, in both the renderer and the engine. `"Cancelled by user"` is the one English sentinel — the cancel handlers compare against it literally (`main.py` compression/convert handlers, `downloader.py`). Don't translate it.
- **`/info` must never block the event loop.** It runs yt-dlp on `_INFO_EXECUTOR` with a 75 s server-side deadline and a 120 s result cache. The original version called yt-dlp inline from an `async def`, freezing health checks, SSE streams and cancels for the whole extraction — and the renderer aborted at 10 s, surfacing the raw DOMException `"signal timed out"` to the user. If you add another blocking endpoint, follow the same pattern.
- **Transport errors get translated, not surfaced raw.** `apiFetch` in `client.ts` maps `TimeoutError`/`AbortError`/`TypeError` to Spanish sentences, and `parseError` (`lib/errorMap.ts`) turns yt-dlp output into a title + actionable hint. Views should show `parsed.title`/`parsed.hint`, never `error.message`.
- **CORS is an allowlist, deliberately.** Loopback is not private — any web page can reach `127.0.0.1`. `ALLOWED_ORIGINS` covers the packaged renderer (`file://` → origin `null`), the Vite dev server, and `chrome-extension://` for the companion. `allow_credentials` is `False`. Widening this back to `["*"]` would let any site enumerate local files through `/local-info` and `/local-thumbnail`.
- **yt-dlp info extraction retries across player-client sets** (`_INFO_CLIENT_SETS` in `downloader.py`), because YouTube rejects different clients at different times. `_is_permanent_info_error` short-circuits cases where retrying cannot help (deleted, private, age-gated, unsupported URL) so a clear error isn't turned into a timeout.
- **CommonJS in the Electron layer**: `main.cjs`, `preload.cjs` and `repair.cjs` are `.cjs` because the package is `"type": "module"`. New Electron-side files must be `.cjs`.
- **Renderer build uses `rolldown-vite`**, pinned via `overrides` (`vite` → `npm:rolldown-vite@7.2.5`). Don't swap in vanilla vite without checking compatibility.
- **Filename sanitization is Windows-specific** — `sanitize_filename` in `downloader.py` (reserved names like `CON`/`NUL`/`COM1`, control chars, 200-char cap).
- **Drag-and-drop is intercepted at the session level** (`webRequest.onBeforeRequest` on `file://*`), not via HTML5 DnD. Media extensions are forwarded to the renderer over the `file-drop` IPC channel; the renderer filters by the active view.
- **Build outputs** — `backend/build/`, `backend/dist/`, `backend/__pycache__/`, `frontend/dist/`, `frontend/release/` — are generated. Don't hand-edit; CI regenerates them.

## Verifying changes

There are no tests, so verify by running the thing:

```bash
# 1. Engine boots, picks a port, reports ffmpeg
cd backend && ./venv/Scripts/python.exe main.py
curl http://127.0.0.1:8765/
cat "$LOCALAPPDATA/GravityDown/backend-endpoint.json"

# 2. The endpoint that used to time out
curl "http://127.0.0.1:8765/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 3. Renderer type-checks and lints
cd frontend && npm run build && npm run lint

# 4. Frozen engine (the build where dynamic yt-dlp imports go missing)
cd backend && ./venv/Scripts/python.exe -m PyInstaller --clean --noconfirm gravitydown.spec
./dist/gravitydown-engine.exe          # then repeat steps 1-2 against it
```

Checks worth running for anything touching startup or packaging:
- Start a second engine while the first holds 8765 → it must bind 8766 and rewrite the endpoint file.
- Hit `GET /` with `Origin: https://evil.example.com` → no `access-control-allow-origin` header.
- Kill the engine with `Stop-Process -Force` → the endpoint file is left stale on purpose; Electron's probe must recover.
