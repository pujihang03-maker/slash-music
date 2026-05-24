@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ╔══════════════════════════════════════╗
echo ║   SLASH MUSIC - Cyberpunk Player    ║
echo ╚══════════════════════════════════════╝
echo.

:: ── Check Node.js ──
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Node.js not found.
    echo Please install Node.js from https://nodejs.org
    echo Then run this file again.
    pause
    exit /b 1
)

echo [OK] Node.js found

:: ── Install dependencies ──
if not exist "node_modules" (
    echo [..] Installing dependencies...
    call npm install
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

node server.js
pause
