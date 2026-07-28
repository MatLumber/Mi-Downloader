# -*- mode: python ; coding: utf-8 -*-
"""
GravityDown Backend - PyInstaller Spec File
Builds the Python backend as a standalone executable.

Everything the engine needs at runtime ships inside this exe: the Python
interpreter, yt-dlp, FastAPI/uvicorn and the extractor set. The only external
binaries are ffmpeg/ffprobe, which electron-builder copies to resources/ffmpeg/
alongside the app. Nothing is installed on the user's machine.
"""

import os

from PyInstaller.utils.hooks import collect_submodules

# `pathex` must stay relative to the spec so the build works on any checkout —
# CI runners and other developers do not have the original author's Desktop.
# SPECPATH is already the directory containing this file.
SPEC_DIR = os.path.abspath(SPECPATH)

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[SPEC_DIR],
    binaries=[],
    datas=[('downloader.py', '.')],
    hiddenimports=[
        'downloader',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'yt_dlp',
        # yt-dlp resolves extractors dynamically, so PyInstaller's static
        # analysis misses every site-specific module. Without this the packaged
        # engine only handles generic URLs and fails on YouTube/TikTok/etc.
        'yt_dlp.extractor',
        'yt_dlp.extractor.lazy_extractors',
        'yt_dlp.compat',
        'yt_dlp.utils',
        'yt_dlp.networking',
        'yt_dlp.networking._requests',
        'yt_dlp.networking._urllib',
        'yt_dlp.postprocessor',
        'sse_starlette',
        'anyio',
        'h11',
        # yt-dlp's extractor set is resolved by name at runtime; static analysis
        # sees none of it. Collecting the submodules explicitly is what keeps
        # site support working in the frozen build.
        *collect_submodules('yt_dlp.extractor'),
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Pulled in transitively and never used by the engine; excluding them
        # cuts ~30 MB off the bundle and shortens the antivirus scan that gates
        # first launch.
        'tkinter',
        'test',
        'unittest',
        'pydoc_data',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='gravitydown-engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX is deliberately off. Packed executables are a strong heuristic signal
    # for Windows Defender and SmartScreen, and an unsigned, UPX-packed exe that
    # spawns network traffic is exactly the profile that gets quarantined. The
    # size saving is not worth users losing the engine to a false positive.
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    # No console: Electron owns the UI and pipes the engine's stdout/stderr into
    # backend.log. A console here meant a black cmd window behind the app.
    # Child ffmpeg processes get CREATE_NO_WINDOW in main.py so they stay hidden
    # too.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(SPEC_DIR, '..', 'frontend', 'public', 'icon.ico'),
)
