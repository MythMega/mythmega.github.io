@echo off
echo Lancement du serveur Python sur le port 5500...

REM Vérifie si python est disponible
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python n'est pas detecte. Verifie ton installation.
    pause
    exit /b
)

REM Lance le serveur en arrière-plan
start "" python -m http.server 5500

REM Attend une seconde pour laisser le serveur démarrer
timeout /t 1 >nul

REM Ouvre la page dans le navigateur
start http://localhost:5500

echo Serveur lance. Appuyez sur CTRL+C dans la console du serveur pour l'arreter.
