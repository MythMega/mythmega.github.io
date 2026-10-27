@echo off
REM Builds the Bulkut releases.
REM Without arguments, shows an interactive scenario menu.
REM Command line: build.bat [all|win|linux|mac|android|test|clean] [-NoTests] [-NoFfmpeg] [-CleanCache]
setlocal

set "ARGS=%*"
if not "%ARGS%"=="" goto run

:menu
echo.
echo Bulkut - scenario de generation
echo   1. Export complet : tests + Windows, Linux, macOS et Android
echo   2. Build Windows uniquement (sans tests)
echo   3. Tests uniquement
echo   4. Build Android uniquement (APK, sans tests)
echo   5. Quitter
echo.
set "CHOICE="
set /p "CHOICE=Votre choix [1-5] : "

if "%CHOICE%"=="1" set "ARGS=-Target all"
if "%CHOICE%"=="2" set "ARGS=-Target win -NoTests"
if "%CHOICE%"=="3" set "ARGS=-Target test"
if "%CHOICE%"=="4" set "ARGS=-Target android -NoTests"
if "%CHOICE%"=="5" exit /b 0
if not defined ARGS goto menu

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %ARGS%
if errorlevel 1 (
  echo.
  echo Build failed.
  exit /b 1
)
endlocal
