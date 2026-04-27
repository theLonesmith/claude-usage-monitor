@echo off
title Claude Usage Monitor — Build
color 0A

:: ── Auto-elevate to Administrator ─────────────────────────────────────────
:: electron-builder's winCodeSign package contains symbolic links that Windows
:: can only extract with administrator privileges (or with Developer Mode on).
:: If we're not already elevated, re-launch this script as admin via a UAC
:: prompt so the user doesn't have to remember to right-click every time.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [INFO] Administrator rights required for build.
    echo  [INFO] A UAC prompt will appear — click Yes to continue.
    echo.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

:: When launched via UAC, the working directory defaults to C:\Windows\System32.
:: Switch back to this script's directory so relative paths (node_modules, src, etc.) resolve.
cd /d "%~dp0"

echo.
echo  ======================================
echo   Claude Usage Monitor — Build
echo  ======================================
echo.

:: Disable code-signing certificate auto-discovery (we're building unsigned)
set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_LINK=
set CSC_LINK=

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install from https://nodejs.org and run setup.bat first.
    pause
    exit /b 1
)

:: Copy chart.js into src/ so it gets bundled with the app
echo  Copying chart.js into src/ ...
if exist "node_modules\chart.js\dist\chart.umd.min.js" (
    copy /Y "node_modules\chart.js\dist\chart.umd.min.js" "src\chart.umd.min.js" >nul
    echo  [OK] chart.umd.min.js copied to src\
) else (
    echo  [ERROR] chart.js not found in node_modules. Run setup.bat first.
    pause
    exit /b 1
)

echo.
echo  Building installer with electron-builder...
echo  (This may take several minutes on first run while Electron is downloaded.)
echo.

call npx electron-builder --win --x64

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Build failed. See output above for details.
    echo.
    echo  If you see a symlink error, try enabling Windows Developer Mode:
    echo  Settings - Privacy and Security - For developers - Developer Mode ON
    echo  Then run build.bat again.
    pause
    exit /b 1
)

echo.
echo  ======================================
echo   Build complete!
echo  ======================================
echo.
echo  Your installer is in the dist\ folder:
echo    Claude Usage Monitor Setup 1.0.0.exe
echo.
echo  Share that single file — users just double-click it to install.
echo  No Node.js, no zip, no extra files needed.
echo.
pause
