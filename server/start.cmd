@echo off
setlocal
chcp 65001 >nul

echo ============================================
echo   Love Stars - Backend
echo ============================================
echo.

REM ---------- 1. 确保数据库在跑 ----------
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [..] Starting PostgreSQL...
  powershell -NoProfile -Command "Start-Process -FilePath 'D:\learn\pgsql\pgsql\bin\postgres.exe' -ArgumentList '-D','D:\learn\pgdata','-p','5433' -WindowStyle Hidden -RedirectStandardError 'D:\learn\pgdata\err.log' -RedirectStandardOutput 'D:\learn\pgdata\out.log'"

  REM 等最多 20 秒
  set /a TRY=0
  :waitdb
  powershell -NoProfile -Command "Start-Sleep -Milliseconds 800" >nul
  powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
  if errorlevel 1 (
    set /a TRY+=1
    if !TRY! lss 25 goto waitdb
    echo [X] Database failed to start. Check D:\learn\pgdata\err.log
    pause
    exit /b 1
  )
  echo [OK] PostgreSQL started
) else (
  echo [OK] PostgreSQL already running
)
echo.

REM ---------- 2. 起 API ----------
REM 账号密码、JWT_SECRET 等都在 server\.env 里（已在 .gitignore，不入库）。
REM main.ts 用 dotenv 自动加载，这里不再写死。
set DATABASE_URL=postgresql://postgres@127.0.0.1:5433/love_stars?schema=public
set PORT=3000

echo [..] Starting API server...
echo.
echo   API:  http://127.0.0.1:3000/api/v1
echo   WS:   ws://127.0.0.1:3000/ws?token=ACCESS_TOKEN
echo.
echo   Accounts: read from server\.env
echo     (USER_A_USERNAME / USER_B_USERNAME)
echo.
echo   Press Ctrl+C to stop
echo ============================================
echo.

node dist\src\main.js

endlocal