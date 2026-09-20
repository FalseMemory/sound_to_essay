@echo off
cd /d "%~dp0"

echo ============================================
echo   Sound to Essay  /  Voice to Essay
echo   Starting desktop app ...
echo ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found.
  echo Please install Node.js first: https://nodejs.org
  echo.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cargo not found.
  echo Please install Rust first: https://rustup.rs
  echo.
  pause
  exit /b 1
)

echo Starting "npm run tauri dev" ...
echo   - The desktop window appears after the build finishes.
echo   - First build may take a while; later runs are fast.
echo   - KEEP THIS WINDOW OPEN while using the app.
echo.

call npm run tauri dev

echo.
echo App has exited.
pause
