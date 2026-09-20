@echo off
cd /d "%~dp0"

echo ============================================
echo   Sound to Essay - Mobile HTTPS dev server
echo ============================================
echo.
echo   Why HTTPS: browsers only expose the microphone on
echo   https:// or localhost. Plain http over the LAN
echo   (e.g. http://192.168.x.x) cannot record audio.
echo.
echo   This starts vite on PORT 57124 with a local
echo   self-signed certificate, so it does NOT conflict
echo   with the desktop app (which uses port 57123).
echo.
echo   After it starts, look for the "Network:" line below,
echo   then open on your phone:
echo.
echo       https://^<that-IP^>:57124/mobile.html
echo.
echo   First time only: install the CA certificate on the phone.
echo   Keep the desktop app running, then open on the phone:
echo.
echo       http://^<that-IP^>:57123/sound-to-essay-ca.crt
echo.
echo   Then trust it in:
echo     Settings - General - About - Certificate Trust Settings
echo.
echo   If you change Wi-Fi / the IP changes, re-run:
echo       powershell -ExecutionPolicy Bypass -File .\tools\make-dev-cert.ps1
echo.

set VITE_HTTPS=1
call npm run dev

echo.
echo Server stopped.
pause
