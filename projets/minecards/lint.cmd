@echo off
REM ==========================================================================
REM lint.cmd - Runs the project linter (tools/lint.mjs) from Windows.
REM
REM Same check as `npm run lint`, without needing npm: the linter has no
REM dependency, only Node. Arguments are passed through, so this works too:
REM
REM     lint.cmd --fix
REM     lint.cmd --only js/ --json
REM ==========================================================================
setlocal

pushd "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [lint] Node.js was not found in the PATH. Install it from https://nodejs.org/
  popd
  exit /b 1
)

node "tools\lint.mjs" %*
set "STATUS=%ERRORLEVEL%"
popd

if "%STATUS%"=="0" (
  echo [lint] No error found.
) else (
  echo [lint] Failed, exit code %STATUS%.
)

REM Keeps the window open when the script was double-clicked (no argument).
if "%~1"=="" pause
exit /b %STATUS%
