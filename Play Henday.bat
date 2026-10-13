@echo off
title Henday Racer
rem Double-click to play. Updates the game, installs anything new,
rem starts it and opens it in your browser. Close this window to stop.
rem Keep brackets out of this file: cmd treats them as block markers.
cd /d "%~dp0"

echo Checking for updates...
git pull --ff-only
if errorlevel 1 echo Could not update - playing the version you have.

echo Installing anything new...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto npm_failed

if exist public\track\henday.json goto start
echo.
echo Downloading the Anthony Henday from OpenStreetMap - one time only...
call npm run fetch-henday

:start
echo.
echo Starting Henday Racer. Your browser will open in a moment.
echo Keep this window open while you play - close it to stop the game.
echo.
call npm run dev -- --open
echo.
echo The game has stopped.
pause
exit /b 0

:npm_failed
echo.
echo npm install failed. Is Node.js installed? Get it from https://nodejs.org
pause
exit /b 1
