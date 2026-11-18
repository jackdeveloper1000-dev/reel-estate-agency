@echo off
title RealAssets AI
cd /d "%~dp0"
echo.
echo  ===== RealAssets AI - setup and start =====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed.
  echo  Install the LTS version from https://nodejs.org then double-click start.bat again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist "server\.env" copy "server\.env.example" "server\.env" >nul
rem --- make sure XAMPP MySQL is running (port 3306) ---
netstat -an | find ":3306" | find "LISTENING" >nul
if errorlevel 1 (
  if exist "C:\xampp\mysql_start.bat" (
    echo  Starting XAMPP MySQL...
    start "XAMPP MySQL" /min cmd /c "C:\xampp\mysql_start.bat"
    timeout /t 6 >nul
  ) else (
    echo  MySQL is not running - start it in the XAMPP Control Panel.
  )
)
echo  [1/3] Installing root packages...
call npm install --no-audit --no-fund || goto :fail
echo  [2/3] Installing server packages (includes FFmpeg and the MySQL driver)...
call npm install --prefix server --no-audit --no-fund || goto :fail
echo  [3/3] Installing website packages...
call npm install --prefix client --no-audit --no-fund || goto :fail
echo.
echo  Starting... the site opens at http://localhost:5173
echo  (the MySQL database realassets_ai is created automatically on first start)
echo  Keep this window open while you use the app. Close it to stop.
echo.
start "" cmd /c "timeout /t 12 >nul & start http://localhost:5180"
call npm run dev
pause
exit /b 0
:fail
echo.
echo  Installation failed - see the messages above.
pause
exit /b 1
