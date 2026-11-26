@echo off
rem Arachne.fyi with a MONTH OF EXAMPLE DATA, on this PC only: http://localhost:5190
rem It runs straight on data-example\ (no copy, so it starts fast).
rem Your real data\ folder is never read or written. Sign in with the test login as Ollie
rem (he places the crystals), Kestrel or Zeph. Runs alongside start.bat (other ports).
rem Made by: npm run seed-year   (three people in the group Webweavers, ~60M an hour).
rem To start over: close this window, then run: npm run seed-year -- --replace
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Packages are not installed yet. Run start.bat once while online, then try again.
  pause
  exit /b 1
)
if not exist data-example\state.db (
  echo No example data yet. Making it now: a month of fights, takes a few seconds.
  call npm run seed-year || goto :failed
)

rem These win over the same lines in .env.
set "DATA_DIR=./data-example"
set "PORT=8790"
set "HOST=127.0.0.1"
set "WEB_PORT=5190"
set "API_TARGET=http://localhost:8790"
set "PUBLIC_URL=http://localhost:5190"
set "DEV_AUTH=1"
set "BAZAAR_ENABLED=0"
rem The example prices are made up; real SkyCofl prices would be mixed into them.
set "COFL_BACKFILL=0"

rem Open the browser once the server answers (not after a fixed wait).
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 180;$i++){try{Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8790/api/me' -TimeoutSec 3 | Out-Null; break}catch{ if($_.Exception.Response){break}; Start-Sleep 1 }}; Start-Process 'http://localhost:5190/signin'"

echo Starting on the example data. The browser opens when the server is ready.
echo Close this window, or press Ctrl+C, to stop.
call npx concurrently -k -n example-server,example-web -c magenta,cyan "npm run dev -w server" "npm run dev -w web"
exit /b 0

:failed
echo.
echo Making the example data failed. Read the error above.
pause
exit /b 1
