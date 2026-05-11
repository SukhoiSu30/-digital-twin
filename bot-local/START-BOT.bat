@echo off
title Digital Twin - Zoom Bot (Vaibhav Mujage)
echo.
echo =============================================
echo   Digital Twin - Zoom Bot (Vaibhav Mujage)
echo   Fully Automated - No login needed
echo =============================================
echo.
cd /d "%~dp0"

:: Install dependencies if node_modules missing
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

echo Starting bot...
echo.
node bot.js
pause
