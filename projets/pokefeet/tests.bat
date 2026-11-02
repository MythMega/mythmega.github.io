@echo off
rem Menu de tests Pokefeet. Les tests eux-memes vivent dans scripts/ :
rem   npm run lint      -> scripts/lint.mjs
rem   npm run test:data -> scripts/test-data-integrity.mjs
rem   npm run test:json -> scripts/test-json-schemas.mjs
rem   npm test          -> scripts/test-save-load.mjs (Chrome headless)
setlocal
chcp 65001 >/dev/null
cd /d "%~dp0"

:menu
cls
echo =============================================
echo    Pokefeet - tests
echo =============================================
echo.
echo    1. Lint              (HTML, JS, CSS, JSON)
echo    2. Donnees           (cosmetiques et defis)
echo    3. Schemas JSON      (tous les fichiers de data/)
echo    4. Navigateur        (pages reelles, Chrome headless)
echo    5. Test global       (lint + donnees + JSON + navigateur)
echo    0. Quitter
echo.
choice /c 123450 /n /m "Choix : "
if errorlevel 6 goto fin
if errorlevel 5 goto global
if errorlevel 4 goto navigateur
if errorlevel 3 goto schemas
if errorlevel 2 goto donnees
if errorlevel 1 goto lint
goto fin

:lint
call npm run lint
goto resultat

:donnees
call npm run test:data
goto resultat

:schemas
call npm run test:json
goto resultat

:navigateur
call npm test
goto resultat

:global
call npm run test:all
goto resultat

:resultat
echo.
if errorlevel 1 (
  echo [ECHEC] Des tests ont echoue.
) else (
  echo [OK] Tests passes.
)
echo.
pause
goto menu

:fin
endlocal
exit /b 0
