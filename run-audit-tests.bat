@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

REM =============================================================================
REM  SEDI Tablette FSOP — suite de tests pour audit
REM  Double-clic ou : run-audit-tests.bat
REM  Documentation : docs\AUDIT_TESTS_FSOP.md
REM =============================================================================

cd /d "%~dp0"
set "ROOT=%CD%"
set "LOG_DIR=%ROOT%\audit-logs"
set "STAMP="
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
set "LOG_FILE=%LOG_DIR%\audit-fsop-%STAMP%.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "FAIL=0"
set "STEP=0"

call :log "========================================"
call :log " AUDIT FSOP — %DATE% %TIME%"
call :log " Racine projet : %ROOT%"
call :log " Journal       : %LOG_FILE%"
call :log "========================================"

call :check_node
if errorlevel 1 goto :finish

call :run_step "Backend — routes FSOP (unitaires)" backend "npx vitest run tests/fsop.routes.test.js --fileParallelism=false"
call :run_step "Backend — flux FSOP (e2e)" backend "npx vitest run tests/fsop.e2e.test.js --fileParallelism=false"
call :run_step "Backend — templates Excel FSOP" backend "npx vitest run tests/fsopTemplatesExcelService.test.js"
call :run_step "Backend — parseur Word FSOP" backend "npx vitest run tests/fsopWordParser.test.js"
call :run_step "Backend — Excel mesures FSOP" backend "npx vitest run tests/fsopExcelService.headerRow.test.js tests/fsopExcelService.measures.test.js"
call :run_step "Frontend — cache offline API" frontend "npx vitest run tests/utils/OfflineApiCache.test.js"
call :run_step "Frontend — parcours FSOP (e2e simule)" frontend "npx vitest run tests/e2e/fsop-flow.test.js"

goto :finish

:check_node
call :log ""
call :log "[Prerequis] Verification Node.js et npm..."
where node >nul 2>&1
if errorlevel 1 (
    call :log "ERREUR : Node.js introuvable. Installez Node.js 18+ : https://nodejs.org/"
    set "FAIL=1"
    exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
    call :log "ERREUR : npm introuvable."
    set "FAIL=1"
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do call :log "Node %%v"
for /f "delims=" %%v in ('npm -v') do call :log "npm  %%v"
if not exist "%ROOT%\backend\node_modules" (
    call :log "Installation dependances backend (premiere execution)..."
    pushd "%ROOT%\backend"
    call npm ci >> "%LOG_FILE%" 2>&1
    if errorlevel 1 set "FAIL=1"
    popd
)
if not exist "%ROOT%\frontend\node_modules" (
    call :log "Installation dependances frontend (premiere execution)..."
    pushd "%ROOT%\frontend"
    call npm ci >> "%LOG_FILE%" 2>&1
    if errorlevel 1 set "FAIL=1"
    popd
)
exit /b 0

:run_step
set /a STEP+=1
set "TITLE=%~1"
set "WORKDIR=%~2"
set "CMD=%~3"
call :log ""
call :log "----------------------------------------"
call :log "[%STEP%] %TITLE%"
call :log "Repertoire : %ROOT%\%WORKDIR%"
call :log "Commande   : %CMD%"
call :log "----------------------------------------"
pushd "%ROOT%\%WORKDIR%"
call %CMD% >> "%LOG_FILE%" 2>&1
set "RC=!ERRORLEVEL!"
popd
if !RC! neq 0 (
    call :log "RESULTAT : ECHEC (code !RC!)"
    set "FAIL=1"
) else (
    call :log "RESULTAT : OK"
)
exit /b 0

:log
if "%~1"=="" (
    echo.
    echo.>> "%LOG_FILE%"
) else (
    echo %~1
    echo %~1>> "%LOG_FILE%"
)
exit /b 0

:finish
call :log ""
call :log "========================================"
if "%FAIL%"=="0" (
    call :log " SYNTHESE AUDIT : SUCCES — tous les tests sont passes."
    call :log "========================================"
    echo.
    echo Audit FSOP : SUCCES. Detail dans %LOG_FILE%
    endlocal
    exit /b 0
) else (
    call :log " SYNTHESE AUDIT : ECHEC — consulter le journal pour le detail."
    call :log "========================================"
    echo.
    echo Audit FSOP : ECHEC. Voir %LOG_FILE%
    endlocal
    exit /b 1
)
