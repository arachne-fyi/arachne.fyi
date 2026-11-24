@echo off
rem Arachne.fyi OFFLINE dev copy: the website on this PC only, with no internet at all.
rem  - no Discord login (you are signed in automatically), no Discord pictures, no Hypixel prices
rem  - runs on a copy of your saved data (data-snapshot\ if it exists, else data\), made in the
rem    temp folder on every start, so your real files are only ever read
rem  - read only: anything that would save is refused
rem Opens http://localhost:5190. Runs alongside start.bat (it uses other ports).
rem Optional: set OFFLINE_USER=<name or Discord ID> below to sign in as someone else.
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Packages are not installed yet. Run start.bat once while online, then try again.
  pause
  exit /b 1
)

set "OFFLINE=1"
set "VITE_OFFLINE=1"
set "PORT=8790"
set "HOST=127.0.0.1"
set "WEB_PORT=5190"
set "API_TARGET=http://localhost:8790"
set "PUBLIC_URL=http://localhost:5190"
set "BAZAAR_ENABLED=0"
rem set "OFFLINE_USER=ollie"
rem set "OFFLINE_DATA=data-snapshot"

if exist data-snapshot\state.db (echo Using saved data from data-snapshot\) else (echo No data-snapshot\ yet: using a copy of data\. Run save-offline-snapshot.bat to freeze one.)

rem Open the browser once both halves have had a few seconds to start.
start "" /b cmd /c "ping -n 7 127.0.0.1 >nul & start "" http://localhost:5190/"

echo Starting. Close this window, or press Ctrl+C, to stop.
call npx concurrently -k -n offline-server,offline-web -c magenta,cyan "npm run dev -w server" "npm run dev -w web"
