@echo off
setlocal enabledelayedexpansion
echo ========================================
echo   GravityDown - Build Script
echo ========================================
echo.

:: ---------------------------------------------------------------------------
:: Resolve the Python used to build the engine.
::
:: The venv is preferred but no longer required: a fresh clone can build with
:: whatever Python is on PATH. The old script hard-required
:: venv\Scripts\pyinstaller.exe and died with a cryptic error when it was absent.
:: ---------------------------------------------------------------------------
set "PY=%~dp0backend\venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

echo [0/5] Checking toolchain...
"%PY%" --version || (echo ERROR: Python not found. Install Python 3.11+ and retry. & pause & exit /b 1)
"%PY%" -m PyInstaller --version >nul 2>&1 || (
    echo PyInstaller missing - installing...
    "%PY%" -m pip install --upgrade pyinstaller || (echo ERROR: could not install PyInstaller. & pause & exit /b 1)
)

:: ffmpeg and ffprobe ship inside the app so the user installs nothing. Without
:: them the Compress and Convert views are dead on arrival, so fail loudly here
:: rather than producing a quietly broken installer.
if not exist "%~dp0backend\ffmpeg\ffmpeg.exe" (
    echo ERROR: backend\ffmpeg\ffmpeg.exe is missing.
    echo Get the "release essentials" build from https://www.gyan.dev/ffmpeg/builds/
    echo and copy ffmpeg.exe + ffprobe.exe into backend\ffmpeg\.
    pause
    exit /b 1
)
if not exist "%~dp0backend\ffmpeg\ffprobe.exe" (
    echo ERROR: backend\ffmpeg\ffprobe.exe is missing.
    pause
    exit /b 1
)
if not exist "%~dp0frontend\public\icon.ico" (
    echo ERROR: frontend\public\icon.ico is missing - the build would ship the default Electron icon.
    pause
    exit /b 1
)
echo Toolchain OK.
echo.

:: Build the engine
echo [1/5] Building Python engine...
cd /d "%~dp0backend"
"%PY%" -m PyInstaller --clean --noconfirm gravitydown.spec
if errorlevel 1 (
    echo ERROR: Backend build failed!
    pause
    exit /b 1
)
if not exist "%~dp0backend\dist\gravitydown-engine.exe" (
    echo ERROR: PyInstaller reported success but gravitydown-engine.exe is missing.
    pause
    exit /b 1
)
echo Engine built.
echo.

:: Smoke-test the frozen engine before wrapping it in an installer. Catching a
:: missing hidden import here beats shipping an exe that dies on launch.
echo [2/5] Smoke-testing the engine...
start "" /b "%~dp0backend\dist\gravitydown-engine.exe"
set "ENGINE_UP="
for /l %%i in (1,1,30) do (
    if not defined ENGINE_UP (
        timeout /t 1 /nobreak >nul
        curl -s -m 2 http://127.0.0.1:8765/ >nul 2>&1 && set "ENGINE_UP=1"
    )
)
taskkill /im gravitydown-engine.exe /t /f >nul 2>&1
if not defined ENGINE_UP (
    echo ERROR: the packaged engine did not answer on 127.0.0.1:8765 within 30s.
    echo Run backend\dist\gravitydown-engine.exe by hand to see the failure.
    pause
    exit /b 1
)
echo Engine responds.
echo.

:: Build the renderer
echo [3/5] Building renderer...
cd /d "%~dp0frontend"
if not exist "node_modules" call npm install
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)
echo.

:: Package. Both targets (NSIS setup + portable) come out of this, along with
:: latest.yml, which electron-updater needs for existing installs to update.
echo [4/5] Packaging installers...
call npx electron-builder --win --x64 --publish=never
if errorlevel 1 (
    echo ERROR: electron-builder failed!
    pause
    exit /b 1
)
echo.

echo [5/5] Done.
echo ========================================
echo   BUILD COMPLETE
echo   Output: frontend\release\
echo     - GravityDown-Setup-x.y.z.exe  (installer)
echo     - GravityDown-x.y.z.exe        (portable)
echo     - latest.yml                   (required by the auto-updater)
echo ========================================
pause
