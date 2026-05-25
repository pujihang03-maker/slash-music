@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ╔══════════════════════════════════════╗
echo ║   SLASH MUSIC - Cyberpunk Player    ║
echo ╚══════════════════════════════════════╝
echo.

:: ── Find Node.js ──
set NODE_BIN=

:: Check system Node.js first
where node >nul 2>&1
if %errorlevel% equ 0 (
    set NODE_BIN=node
    echo [OK] System Node.js found
    goto :check_modules
)

:: Check if bundled nodejs exists AND is Windows binary (.exe)
if exist "%~dp0nodejs\node.exe" (
    set NODE_BIN=%~dp0nodejs\node.exe
    echo [OK] Using bundled Node.js
    goto :check_modules
)

:: No usable Node.js found - download Windows portable
echo [!] Node.js not found. Downloading portable Node.js for Windows...
echo [..] This may take 1-2 minutes...

set NODE_VERSION=v24.16.0
set NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip
set NODE_ZIP=%TEMP%\node-portable.zip

powershell -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%'" 2>nul
if %errorlevel% neq 0 (
    echo [!] Download failed.
    echo     Please install Node.js manually from https://nodejs.org
    echo     Then run this file again.
    pause
    exit /b 1
)

echo [..] Extracting...
powershell -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%~dp0' -Force" 2>nul
move "%~dp0node-%NODE_VERSION%-win-x64" "%~dp0nodejs" >nul 2>&1
del "%NODE_ZIP%" >nul 2>&1
set NODE_BIN=%~dp0nodejs\node.exe
echo [OK] Node.js ready

:check_modules
:: ── Install dependencies ──
if not exist "%~dp0node_modules" (
    echo [..] Installing dependencies...
    "%NODE_BIN%" "%~dp0nodejs\node_modules\npm\bin\npm-cli.js" install 2>nul
    if %errorlevel% neq 0 (
        "%NODE_BIN%" -e "require('child_process').execSync('npm install',{cwd:'%~dp0',stdio:'inherit'})" 2>nul
    )
)

:: ── Kill old processes ──
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: ── Start server ──
set DEEPSEEK_API_KEY=sk-4014283e7f61424ab5f1562a124283d4
start "" http://localhost:3000

echo.
echo ╔══════════════════════════════════════╗
echo ║  http://localhost:3000               ║
echo ║                                     ║
echo ║  Close this window to stop server.  ║
echo ╚══════════════════════════════════════╝
echo.

"%NODE_BIN%" server.js
pause
