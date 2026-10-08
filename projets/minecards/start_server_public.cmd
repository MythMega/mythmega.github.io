@echo off
REM ============================================================================
REM  start_server.cmd - Local development server.
REM
REM  The application uses native ES modules (`<script type="module">`) and fetches
REM  `settings/config.json` and `settings/i18n/<lang>.json`, both of which are blocked
REM  by the browser when the page is opened through file:// . A small HTTP server is
REM  therefore mandatory for local testing (same approach as the sibling tools in
REM  `external/`).
REM ============================================================================

setlocal
set min=25565
set max=25565

REM Random port inside [min, max] to avoid clashing with an already running server.
set /a port=%RANDOM% %% (max - min + 1) + min

echo Port choisi : %port%
echo Lancement du serveur Python sur le port %port%...

python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python n'est pas detecte. Verifie ton installation.
    pause
    exit /b
)

REM Serves the current directory in the background, then opens the application.
start "" python -m http.server %port%
timeout /t 1 >nul
start http://localhost:%port%/index.html

echo Serveur lance. Appuyez sur CTRL+C dans la console du serveur pour l'arreter.
endlocal
