@echo off
setlocal
chcp 65001 >nul

echo ============================================
echo   Stopping PostgreSQL (port 5433)
echo ============================================
echo.

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [OK] PostgreSQL is not running
) else (
  "D:\learn\pgsql\pgsql\bin\pg_ctl.exe" -D "D:\learn\pgdata" -m fast stop
  if errorlevel 1 (
    echo [!] Graceful stop failed, forcing...
    powershell -NoProfile -Command "Get-Process postgres -ErrorAction SilentlyContinue | Stop-Process -Force"
  )
  echo [OK] PostgreSQL stopped
)

echo.
echo   Data is safe in D:\learn\pgdata
echo   To restart: server\start.cmd
echo.

endlocal
