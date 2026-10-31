@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-server.ps1"
if errorlevel 1 (
  echo.
  echo The editor could not start. Check the message above.
  pause
)
endlocal
