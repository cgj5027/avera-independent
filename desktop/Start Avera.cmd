@echo off
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22.18 or newer LTS from https://nodejs.org, then start Avera again.
  pause
  exit /b 1
)
node "%~dp0scripts\desktop-launcher.mjs" %*
if errorlevel 1 pause
