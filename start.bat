@echo off
rem Arachne.fyi: install, build, then run the server and the Cloudflare tunnel.
rem Double-click it, or run "start.bat" from this folder. Close both windows to stop.
setlocal
cd /d "%~dp0"

rem Read TUNNEL_TOKEN from .env, so the token lives in one place.
set "TUNNEL_TOKEN="
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if /i "%%a"=="TUNNEL_TOKEN" set "TUNNEL_TOKEN=%%b"
)

echo [1/3] Installing packages...
call npm install || goto :failed

echo [2/3] Building the dashboard and server...
call npm run build || goto :failed

if defined TUNNEL_TOKEN (
  echo Starting the Cloudflare tunnel in its own window...
  start "Arachne tunnel" cmd /k cloudflared tunnel run --token %TUNNEL_TOKEN%
) else (
  echo No TUNNEL_TOKEN in .env: the site will only work on this PC at http://localhost:8787
)

echo [3/3] Starting the server. Leave this window open; Ctrl+C then Y stops it.
rem If the server crashes it starts again after 5 seconds. Output also goes to data\server.log
rem (the old log is kept as server.old.log), so a crash overnight can be read in the morning.
if not exist data mkdir data
:run
if exist data\server.log move /y data\server.log data\server.old.log >nul
call npm start 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath data\server.log"
echo.
echo The server stopped. Starting it again in 5 seconds (close this window to stop for good).
timeout /t 5 /nobreak >nul
goto :run

:failed
echo.
echo Something failed above. Read the error, fix it, then run start.bat again.
pause
exit /b 1
