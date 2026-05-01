# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GravityDown is a Windows desktop app for extracting/processing media (yt-dlp + ffmpeg) wrapped in an Electron shell with a React/TypeScript renderer. Two processes at runtime: an Electron main process and a FastAPI Python backend it spawns as a child process. They communicate over local HTTP + SSE on `127.0.0.1:8765` (hardcoded — see `backend/main.py:1203` and `frontend/src/api/client.ts:1`).

## Common commands

All commands run from `frontend/` unless noted.

```bash
# First-time backend setup (from repo root)
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
cd ..

# Dev (Vite + Electron + Python backend from venv)
cd frontend
npm install
npm run electron:dev          # runs vite, waits for :5173, launches electron which spawns python from ../backend/venv

# Lint (frontend only — no backend linter is configured)
npm run lint

# Type-check + build renderer
npm run build                 # tsc -b && vite build

# Build full installer locally (requires the Python venv to already have pyinstaller)
# From repo root:
./build.bat                   # builds backend exe via PyInstaller + electron-builder --dir, copies into dist/GravityDown/

# Build just the Electron installers (assumes backend exe already built)
cd frontend
npm run electron:build        # vite build + electron-builder (NSIS + portable, win x64)
```

There is no test suite in this repo. Do not invent test commands.

### Release flow (CI)

`.github/workflows/auto-tag.yml` runs on every push to `master`/`main`: it bumps the patch in `frontend/package.json`, commits as `chore(release): vX [skip ci]`, tags `vX`, and triggers a Windows build that publishes a GitHub release. **Any merge to master ships a release** unless the commit message contains `chore(release)` or the actor is `github-actions[bot]`. `release.yml` does the same on a manual `v*` tag push or `workflow_dispatch`. Both jobs download ffmpeg fresh into `backend/ffmpeg/` before building.

## Architecture

### Three runtime layers

1. **Renderer** (`frontend/src/`) — React 19 + Zustand + Tailwind v4. Talks to backend via `fetch` and `EventSource` (`src/api/client.ts`). Talks to Electron via `window.electronAPI` exposed by `electron/preload.cjs` and typed in `src/types/electron.d.ts`. The window is **frameless** (`frame: false`) — `TitleBar.tsx` reimplements minimize/maximize/close via IPC.
2. **Electron main** (`frontend/electron/main.cjs`) — spawns the Python backend, waits for `GET /` on `:8765` to confirm it's up (`waitForBackend`), then creates the window. Handles auto-update (`electron-updater` → GitHub releases at `MatLumber/Mi-Downloader`), file-drop interception (via `session.webRequest.onBeforeRequest` on `file://*`), native dialogs, and process-tree teardown of Python on quit (`taskkill /T /F` on Windows).
3. **Python backend** (`backend/main.py` + `backend/downloader.py`) — FastAPI on `127.0.0.1:8765`. Three independent task domains, each with its own status/events/cancel triplet:
   - **Download**: `POST /download` → `DownloadManager` (yt-dlp wrapper in `downloader.py`). Status via `GET /status/{id}`, stream via `GET /events/{id}` (SSE), cancel via `DELETE /cancel/{id}`.
   - **Compress**: `POST /compress` → ffmpeg with libx264/libvpx-vp9 or GPU encoder (h264_nvenc/qsv/amf). Tasks live in module-level `compression_tasks` dict guarded by `compression_lock`. **Only one compression at a time** — returns 409 if another is in progress.
   - **Convert**: `POST /convert` → ffmpeg, video/audio/image. Tasks live in `convert_tasks` dict guarded by `convert_lock`. Multiple conversions can run concurrently.

   All three expose the same shape: `POST /{domain}` → `GET /{domain}/status/{id}` → `GET /{domain}/events/{id}` (SSE, polls every 0.5s, closes on `completed`/`error`) → `DELETE /{domain}/cancel/{id}`. The renderer's `subscribeToTaskEvents` / `subscribeToCompressionEvents` / `subscribeToConvertEvents` in `src/api/client.ts` mirror this triplet.

### Backend / packaging coupling

The backend is shipped as a PyInstaller single-file exe (`gravitydown-engine.exe`, spec at `backend/gravitydown.spec`). `frontend/package.json`'s `build.extraResources` copies it from `../backend/dist/` into the installer's `resources/backend/`, alongside `backend/ffmpeg/` → `resources/ffmpeg/`. **The frontend cannot be built into a working installer without the backend exe present at `backend/dist/gravitydown-engine.exe`**; `build.bat` enforces this ordering. In dev, `main.cjs:startPythonBackend` instead spawns `backend/venv/Scripts/python.exe -m uvicorn main:app`, so the venv path is load-bearing.

ffmpeg/ffprobe lookup happens in `_find_binary` (`backend/main.py:188`) and walks: `FFMPEG_PATH`/`FFPROBE_PATH` env → PyInstaller `_MEIPASS` → cwd → script dir → executable dir → `<exe>/ffmpeg/` → `<exe>/../ffmpeg/` → PATH. When packaged, ffmpeg lives next to the exe at `resources/ffmpeg/`.

### State (renderer)

`src/store/useAppStore.ts` is the single Zustand store. It persists a curated subset (`partialize`) to `localStorage` under `gravitydown-storage`: tab state, format/quality preferences, history (videos/audios/conversions, capped at 50 each), output dirs, theme. The download queue (`downloadQueue`) is **not** persisted — in-flight downloads are lost on restart. `videoHistory` and `audioHistory` are split lists; `downloadHistory` is a getter that merges + sorts them. Date fields are rehydrated from strings in `onRehydrateStorage`. Theme is also mirrored to a separate `gravitydown-theme` key for early-paint reads.

### Path conventions

User-facing paths use `~` as the home prefix (e.g. `~/Downloads/GravityDown`). Both Electron main (`open-path` / `show-in-folder` / `open-folder` IPC handlers) and the Python `_expand_path` resolve `~` via the OS home dir before use. Don't pass `~`-paths to filesystem APIs without expanding first.

## Conventions worth knowing

- **User-facing strings in the backend are Spanish** (e.g. `"ffmpeg no encontrado"`, `"Archivo de entrada no encontrado"`, `"Cancelled by user"` is the one English sentinel — don't change it, the cancel handlers compare against it literally at `main.py:600` and `main.py:778`). Keep new error messages in Spanish to match.
- **Renderer build uses `rolldown-vite`** pinned via the `overrides` field in `package.json` (vite resolves to `npm:rolldown-vite@7.2.5`). Don't replace with vanilla vite without checking compatibility.
- **CommonJS in the Electron layer**: `main.cjs` and `preload.cjs` are `.cjs` because the package is `"type": "module"`. Keep new Electron-side files as `.cjs` or they'll be loaded as ESM and break.
- **Filename sanitization for downloads** is Windows-specific — see `sanitize_filename` in `downloader.py:27` (handles reserved names like `CON`, `NUL`, `COM1`, control chars, length cap).
- **Drag-and-drop** of files into the window is intercepted at the session level (`webRequest.onBeforeRequest` on `file://*`), not via HTML5 DnD events. Only video extensions (`mp4|mkv|webm|avi|mov|m4v`) are forwarded to the renderer via the `file-drop` IPC channel.
- **`backend/__pycache__/`, `backend/build/`, `backend/dist/`, and `frontend/release/` are build outputs** — they're checked into git in places (see git status) but should not be edited by hand. The release CI regenerates them.
