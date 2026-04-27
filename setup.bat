@echo off
title Claude Usage Monitor — Setup
color 0A

echo.
echo  ======================================
echo   Claude Usage Monitor — First-Time Setup
echo  ======================================
echo.

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo.
    echo  Please install Node.js from: https://nodejs.org
    echo  Choose the LTS version, run the installer, then re-run this script.
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js found.
echo.
echo  Installing dependencies... (this may take a minute)
echo.

call npm install
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo  Copying chart.js into src/ for reliable in-app loading...
if exist "node_modules\chart.js\dist\chart.umd.min.js" (
    copy /Y "node_modules\chart.js\dist\chart.umd.min.js" "src\chart.umd.min.js" >nul
    echo  [OK] chart.umd.min.js copied to src\
) else (
    echo  [WARNING] Could not find chart.js in node_modules. Chart may not display.
)

echo.
echo  ======================================
echo   Setup complete!
echo  ======================================
echo.
echo  To run the app:    double-click  run.bat
echo  To build the .exe: double-click  build.bat
echo.
pause
