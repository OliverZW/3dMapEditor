@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Node.js 22.12 or later is required. & exit /b 1)
where npm >nul 2>nul
if errorlevel 1 (echo npm is required. & exit /b 1)
call npm run build
exit /b %errorlevel%
