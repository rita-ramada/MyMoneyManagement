@echo off
rem Builds the UI, starts the local server and opens the browser once it is listening.
cd /d "%~dp0"
set OPEN_BROWSER=1
npm start
pause
