@echo off
setlocal
cd /d "%~dp0src"

for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "for ($p = 8765; $p -le 8799; $p++) { if (-not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { Write-Output $p; break } }"') do set "PORT=%%P"

if not defined PORT (
  echo No free port found between 8765 and 8799.
  pause
  exit /b 1
)

start "elevator-web-server-%PORT%" /min python -m http.server %PORT% --bind 127.0.0.1

for /l %%I in (1,1,20) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%PORT%/index.html' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch { }; exit 1"
  if not errorlevel 1 goto open_page
  timeout /t 1 /nobreak >nul
)

echo Server did not start on port %PORT%.
pause
exit /b 1

:open_page
start "" "http://127.0.0.1:%PORT%/index.html?v=%RANDOM%%RANDOM%"
