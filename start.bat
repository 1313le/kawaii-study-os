@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org/
  pause
  exit /b 1
)
node tools/build.js
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)
echo.
echo Starting local preview at http://127.0.0.1:4173/
node tools/serve.js --open
pause
