@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

REM 下面这些是本机路径，按需改成自己的；仓库里保持可覆盖。
if not defined PUB_CACHE set PUB_CACHE=D:\learn\cache\pub
if not defined GRADLE_USER_HOME set GRADLE_USER_HOME=D:\learn\cache\gradle
if not defined ANDROID_HOME set ANDROID_HOME=D:\learn\Android\Sdk
if not defined ANDROID_SDK_ROOT set ANDROID_SDK_ROOT=D:\learn\Android\Sdk
if not defined FLUTTER_BIN set FLUTTER_BIN=D:\learn\flutter\bin\flutter.bat
set PUB_HOSTED_URL=https://pub.flutter-io.cn
set FLUTTER_STORAGE_BASE_URL=https://storage.flutter-io.cn

echo ============================================
echo   Love Stars - Run on device
echo ============================================
echo.

REM Default: cloud backend. Phone does not need the same WiFi as this PC.
REM For the local backend: run-device.cmd local
set APIHOST=http://47.116.23.114/api/v1

if /i "%1"=="local" (
  echo [..] Local backend mode - phone must be on the SAME WiFi as this PC.
  for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set IP=%%a
    goto :gotip
  )
  :gotip
  set IP=!IP: =!
  echo   Local IP: !IP!
  echo   Verify on the phone browser first:
  echo     http://!IP!:3000/api/v1/health
  echo.
  set APIHOST=http://!IP!:3000/api/v1
  set /p INPUT=Backend URL [Enter for !APIHOST!]:
  if not "!INPUT!"=="" set APIHOST=!INPUT!
) else (
  echo [OK] Cloud backend: %APIHOST%
  echo      Use "run-device.cmd local" for the local backend instead.
)
echo.

echo [..] Checking connected devices...
%FLUTTER_BIN% devices | findstr /c:"mobile" /c:"android" /c:"ios" >nul
if errorlevel 1 (
  echo.
  echo [!] No mobile device detected.
  echo.
  echo     Checklist:
  echo       1. USB cable connected (data cable, not charge-only)
  echo       2. Phone: Developer options - USB debugging ON
  echo       3. Phone: tap "Allow" on the USB debugging prompt
  echo.
  echo     Run this to see all devices:
  echo       %FLUTTER_BIN% devices
  echo.
  pause
  exit /b 1
)
echo [OK] Device detected
echo.

echo [..] Compiling and installing (first run: 3-5 min)...
echo     Using: %APIHOST%
echo.

%FLUTTER_BIN% run --dart-define=API_BASE_URL=%APIHOST%

endlocal