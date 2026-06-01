@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=8765"
set "URL=http://%HOST%:%PORT%/"
set "PYTHON_CMD=python"

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Python，请先安装 Python 3.10 或更新版本。
    echo.
    pause
    exit /b 1
  )
  set "PYTHON_CMD=py -3"
)

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo Outlook Lite 已经在运行。
  echo 正在打开 %URL%
  start "" "%URL%"
  exit /b 0
)

echo 正在启动 Outlook Lite...
echo URL: %URL%
echo.

start "Outlook Lite Server" cmd /k "%PYTHON_CMD% app.py --host %HOST% --port %PORT%"
timeout /t 2 /nobreak >nul
start "" "%URL%"

exit /b 0
