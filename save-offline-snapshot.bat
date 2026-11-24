@echo off
rem Saves a frozen copy of data\ to data-snapshot\ for start-offline.bat to run from.
rem Only reads data\. Replaces any older data-snapshot\. For the cleanest copy, stop start.bat first.
setlocal
cd /d "%~dp0"
if not exist data\state.db (
  echo No data\state.db found. Nothing to save.
  pause
  exit /b 1
)
echo Copying data\ to data-snapshot\ (no backups or logs)...
robocopy data data-snapshot /MIR /XD backups /XF *.log *-shm /NFL /NDL /NJH /NP
if errorlevel 8 (
  echo The copy failed. Read the error above.
  pause
  exit /b 1
)
echo Done. start-offline.bat will now use data-snapshot\.
pause
