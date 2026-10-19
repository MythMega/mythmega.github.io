@echo off
REM ============================================================================
REM  build.cmd - Build the MineCards TWA with Bubblewrap.
REM
REM  Three environment details are handled here:
REM   - NoDefaultCurrentDirectoryInExePath disables the cmd.exe lookup of
REM     gradlew.bat in the current directory, which Bubblewrap relies on;
REM   - the signing passwords are read from the file created with the keystore,
REM     so bubblewrap does not prompt for them;
REM   - the npm shim (bubblewrap.cmd) loses those variables on this machine, so
REM     the CLI JavaScript is invoked directly with node. The shim is kept as a
REM     fallback for a standard npm installation.
REM
REM  Usage: build.cmd [bubblewrap build options]
REM         build.cmd --skipPwaValidation   (until the site is deployed)
REM ============================================================================

setlocal
set "NoDefaultCurrentDirectoryInExePath="

for /f "usebackq delims=" %%P in ("%USERPROFILE%\.android\minecards-release.password") do set "BUBBLEWRAP_KEYSTORE_PASSWORD=%%P"
if not defined BUBBLEWRAP_KEY_PASSWORD set "BUBBLEWRAP_KEY_PASSWORD=%BUBBLEWRAP_KEYSTORE_PASSWORD%"

set "BUBBLEWRAP_CLI=%APPDATA%\npm\node_modules\@bubblewrap\cli\bin\bubblewrap.js"
if not exist "%BUBBLEWRAP_CLI%" goto fallback
node "%BUBBLEWRAP_CLI%" build %*
exit /b %ERRORLEVEL%

:fallback
bubblewrap build %*
exit /b %ERRORLEVEL%
