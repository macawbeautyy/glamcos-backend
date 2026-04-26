@echo off
title GlamCos Data Seeder
color 0A
echo.
echo  +----------------------------------------------------------+
echo  ^|       GLAMCOS - Seeding Categories & Services           ^|
echo  +----------------------------------------------------------+
echo.
echo  Starting backend server...
echo.

:: Start backend in background
start "GlamCos Backend" /D "%~dp0" cmd /c "node server.js > seed_server.log 2>&1"

echo  Waiting 15 seconds for backend to be fully ready...
timeout /t 15 /nobreak > nul

echo.
echo  Running seed script...
echo.
node "%~dp0seed_via_api.js" admin@servify.com Admin@123456

echo.
if %ERRORLEVEL% == 0 (
  echo  SUCCESS! All data seeded.
) else (
  echo  Check output above for errors.
)
echo.
echo  Press any key to close.
pause > nul
