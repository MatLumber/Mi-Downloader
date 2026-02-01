@echo off
echo ========================================
echo   GravityDown - Build Script
echo ========================================
echo.

:: Build Backend
echo [1/3] Building Python Backend...
cd /d "%~dp0backend"
call venv\Scripts\pyinstaller.exe --clean --noconfirm gravitydown.spec
if errorlevel 1 (
    echo ERROR: Backend build failed!
    pause
    exit /b 1
)
echo Backend built successfully!
echo.

:: Create output directory
echo [2/3] Preparing distribution folder...
cd /d "%~dp0"
if exist "dist" rmdir /s /q "dist"
mkdir "dist\GravityDown"
mkdir "dist\GravityDown\backend"

:: Copy backend executable
copy "backend\dist\gravitydown-engine.exe" "dist\GravityDown\backend\"
echo Backend copied!
echo.

:: Build Frontend
echo [3/3] Building Electron Frontend...
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)

:: Build Electron app
call npx electron-builder --win --dir
if errorlevel 1 (
    echo ERROR: Electron build failed!
    pause
    exit /b 1
)

:: Copy Electron output
xcopy /E /I "release\win-unpacked" "%~dp0dist\GravityDown\app"
echo Frontend built successfully!
echo.

echo ========================================
echo   BUILD COMPLETE!
echo   Output: dist\GravityDown\
echo ========================================
echo.
echo To run: dist\GravityDown\app\GravityDown.exe
pause
