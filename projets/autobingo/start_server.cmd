@echo off
echo Selection d'un port aleatoire...
py dataset_analyser.py
REM Définition des bornes
set min=5480
set max=5499

REM Génère un port aléatoire entre 5480 et 5499
set /a port=%RANDOM% %% (max - min + 1) + min

echo Port choisi : %port%
echo Lancement du serveur Python sur le port %port%...

REM Vérifie si python est disponible
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python n'est pas detecte. Verifie ton installation.
    pause
    exit /b
)

REM Lance le serveur en arrière-plan
start "" python -m http.server %port%

REM Attend une seconde pour laisser le serveur démarrer
timeout /t 1 >nul

REM Ouvre la page dans le navigateur
start http://localhost:%port%

echo Serveur lance. Appuyez sur CTRL+C dans la console du serveur pour l'arreter.
