@echo off
title KRE Save Server
echo =================================================
echo   Krunker Replay - Save Server
echo   .kre files will be saved to:
echo   %USERPROFILE%\Documents\KrunkerReplays
echo =================================================
echo.
echo Keep this window open while playing Krunker!
echo.
node "%~dp0recorder\src\kre-save-server.js"
pause
