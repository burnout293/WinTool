@echo off
setlocal
cd /d "%~dp0"
title WinTool

echo.
echo  ==========================================
echo   WinTool - Démarrage du serveur local...
echo  ==========================================
echo.

REM Vérifier si le serveur tourne déjà
powershell -NoProfile -Command "try { $r = Invoke-WebRequest http://localhost:7171/ping -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
    echo  Serveur déjà actif. Ouverture du navigateur...
    goto open_browser
)

REM Lancer le serveur en arrière-plan dans une fenêtre minimisée
start /min "WinTool Server" PowerShell -NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File "%~dp0server.ps1"

REM Attendre que le serveur soit prêt (max 8 secondes)
echo  Démarrage en cours...
set /a tries=0
:wait_loop
timeout /t 1 /nobreak >nul
set /a tries+=1
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:7171/ping -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 goto open_browser
if %tries% lss 8 goto wait_loop

echo  [!] Le serveur n'a pas démarré. Vérifiez PowerShell.
pause
exit /b 1

:open_browser
echo  Serveur actif sur http://localhost:7171
echo  Ouverture de l'interface...
start "" "http://localhost:7171"
echo.
echo  Interface ouverte dans votre navigateur.
echo  Cette fenêtre peut être fermée.
echo  Pour arrêter le serveur : fermer la fenêtre "WinTool Server".
echo.
timeout /t 3 /nobreak >nul
