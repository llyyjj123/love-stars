@echo off
setlocal
chcp 65001 >nul

REM 下面这些是本机路径，按需改成自己的；仓库里保持可覆盖。
if not defined PUB_CACHE set PUB_CACHE=D:\learn\cache\pub
if not defined GRADLE_USER_HOME set GRADLE_USER_HOME=D:\learn\cache\gradle
if not defined ANDROID_HOME set ANDROID_HOME=D:\learn\Android\Sdk
if not defined ANDROID_SDK_ROOT set ANDROID_SDK_ROOT=D:\learn\Android\Sdk
set PUB_HOSTED_URL=https://pub.flutter-io.cn
set FLUTTER_STORAGE_BASE_URL=https://storage.flutter-io.cn

echo ============================================
echo   Love Stars - Run in Chrome
echo ============================================
echo.

REM Default: cloud backend. No local server needed.
REM For the local backend: run-web.cmd local
set APIHOST=http://47.116.23.114/api/v1

if /i "%1"=="local" (
  set APIHOST=http://127.0.0.1:3000/api/v1
  powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
  if errorlevel 1 (
    echo [!] Local backend is NOT running on port 3000.
    echo     Start it first:  server\start.cmd
    echo.
    pause
    exit /b 1
  )
  echo [OK] Local backend running
) else (
  echo [OK] Cloud backend: %APIHOST%
  echo      Use "run-web.cmd local" for the local backend instead.
)
echo.

echo [..] Compiling and launching Chrome...
echo     First run takes 30-60 seconds.
echo.

if not defined FLUTTER_BIN set FLUTTER_BIN=D:\learn\flutter\bin\flutter.bat
%FLUTTER_BIN% run -d chrome --dart-define=API_BASE_URL=%APIHOST%

endlocal