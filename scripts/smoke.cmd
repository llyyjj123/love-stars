@echo off
setlocal
chcp 65001 >nul

echo ============================================
echo   API Smoke Test
echo ============================================
echo.

if "%~1"=="--spawn" (
  echo   Mode: auto-start server
  node "%~dp0smoke.js" --spawn
) else (
  echo   Mode: use running server at 127.0.0.1:3000
  node "%~dp0smoke.js"
)

endlocal
