@echo off
title LoL Matchup Coach
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org ^(LTS^), then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run - installing dependencies...
  call npm install
)

echo Starting LoL Matchup Coach at http://localhost:3000
start "" http://localhost:3000
node server.js
pause
