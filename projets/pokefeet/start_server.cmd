@echo off
echo Lancement du serveur Python sur le port 5981...

REM Vérifie si python est disponible
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Python n'est pas detecte. Verifie ton installation.
    pause
    exit /b
)

REM Un ancien serveur sur le port 5981 garderait le cache navigateur :
REM il faut le fermer avant de lancer le serveur sans cache.
netstat -ano | findstr ":5981" | findstr "LISTENING" >nul
IF %ERRORLEVEL% EQU 0 (
    echo Un serveur ecoute deja sur le port 5981.
    echo Fermez son ancienne fenetre ^(Ctrl+C^), puis relancez ce script.
    pause
    exit /b
)

REM Lance le serveur sans cache en arrière-plan
REM (python -m http.server laisse le navigateur réutiliser les anciennes pages)
start "" python "%~dp0scripts\serve.py" 5981

REM Attend une seconde pour laisser le serveur démarrer
timeout /t 1 >nul

REM Ouvre la page dans le navigateur
start http://localhost:5981

echo Serveur lance. Appuyez sur CTRL+C dans la console du serveur pour l'arreter.
