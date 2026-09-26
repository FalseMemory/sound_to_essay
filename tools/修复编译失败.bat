@echo off
rem ============================================================
rem  Fix: Rust incremental-compilation cache corruption
rem
rem  Symptom (seen with `npm run tauri dev` or `cargo build`):
rem    - "query stack during panic" / "end of query stack"
rem    - warning: error deleting lock file for incremental
rem      compilation session directory ... (os error 5)
rem    - error: could not compile `app` (lib)
rem
rem  Cause: src-tauri/target/debug/incremental accumulates large
rem  amounts of cache plus leftover read-only .lock files. When
rem  rustc fails to delete them, it panics internally.
rem  The directory is only a build cache -- deleting it is safe,
rem  it gets rebuilt automatically.
rem
rem  NOTE: this file is intentionally ASCII-only. A .bat containing
rem  non-ASCII text can be mis-decoded by cmd.exe and fail to parse.
rem ============================================================
setlocal

set "TARGET=%~dp0..\src-tauri\target\debug\incremental"

echo.
echo   Voice to Essay - clean Rust incremental cache
echo   ============================================
echo.

if not exist "%TARGET%" (
    echo   [SKIP] No incremental cache found. Nothing to do.
    goto :end
)

echo   Cache: %TARGET%
echo.

rem Use the .NET API (more reliable than rmdir for read-only files)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = '%TARGET%';" ^
  "Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Attributes = 'Normal' } catch {} };" ^
  "try { [System.IO.Directory]::Delete($p, $true) } catch {};" ^
  "if (Test-Path -LiteralPath $p) { exit 1 } else { exit 0 }"

if errorlevel 1 (
    echo   [FAIL] Could not remove the cache.
    echo.
    echo   Please make sure that:
    echo     1. the Voice to Essay window is closed
    echo     2. no cargo.exe / rustc.exe is still running
    echo     3. then run this script again
    echo.
    pause
    exit /b 1
)

echo   [DONE] Cache removed. The next build will take a bit longer.
echo.

:end
pause
exit /b 0
