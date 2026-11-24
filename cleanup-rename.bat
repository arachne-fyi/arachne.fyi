@echo off
rem One-time cleanup after the Arachne Ledger -> Arachne.fyi rename.
rem Removes the old mod source folders so Gradle doesn't compile two copies of every class.
cd /d "%~dp0"
if exist "mod\src\main\java\fyi\arachne\ledger" rmdir /s /q "mod\src\main\java\fyi\arachne\ledger"
if exist "mod\src\test\java\fyi\arachne\ledger" rmdir /s /q "mod\src\test\java\fyi\arachne\ledger"
if exist "mod\src\main\resources\assets\arachneledger" rmdir /s /q "mod\src\main\resources\assets\arachneledger"
if exist "mod\src\main\resources\arachneledger.mixins.json" del /q "mod\src\main\resources\arachneledger.mixins.json"
echo Old Arachne Ledger files removed. You can delete this file now.
pause
