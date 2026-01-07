@echo off
REM Script pour exécuter toutes les migrations dans l'ordre
REM Base de données: SEDI_APP_INDEPENDANTE
REM Serveur: 192.168.1.14 (ou depuis config)

echo ========================================
echo Execution de toutes les migrations SQL
echo ========================================
echo.

REM Configuration (à adapter selon votre environnement)
set SERVER=192.168.1.14
set DATABASE=SEDI_APP_INDEPENDANTE
set USER=QUALITE
set PASSWORD=QUALITE

echo Serveur: %SERVER%
echo Base de donnees: %DATABASE%
echo.

REM Vérifier si sqlcmd est disponible
where sqlcmd >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERREUR: sqlcmd n'est pas trouve dans le PATH
    echo Veuillez installer SQL Server Command Line Utilities
    pause
    exit /b 1
)

echo ========================================
echo 1. Migration: Extension AB_COMMENTAIRES_OPERATEURS
echo ========================================
sqlcmd -S %SERVER% -d %DATABASE% -U %USER% -P %PASSWORD% -i "migration_extend_comments.sql"
if %ERRORLEVEL% NEQ 0 (
    echo ERREUR lors de l'execution de migration_extend_comments.sql
    pause
    exit /b 1
)
echo.

echo ========================================
echo 2. Migration: Extension ABHISTORIQUE_OPERATEURS
echo ========================================
sqlcmd -S %SERVER% -d %DATABASE% -U %USER% -P %PASSWORD% -i "migration_extend_historique.sql"
if %ERRORLEVEL% NEQ 0 (
    echo ERREUR lors de l'execution de migration_extend_historique.sql
    pause
    exit /b 1
)
echo.

echo ========================================
echo 3. Migration: Extension ABTEMPS_OPERATEURS
echo ========================================
sqlcmd -S %SERVER% -d %DATABASE% -U %USER% -P %PASSWORD% -i "migration_extend_temps.sql"
if %ERRORLEVEL% NEQ 0 (
    echo ERREUR lors de l'execution de migration_extend_temps.sql
    pause
    exit /b 1
)
echo.

echo ========================================
echo 4. Migration: Creation vues SILOG
echo ========================================
sqlcmd -S %SERVER% -d %DATABASE% -U %USER% -P %PASSWORD% -i "migration_create_silog_views.sql"
if %ERRORLEVEL% NEQ 0 (
    echo ERREUR lors de l'execution de migration_create_silog_views.sql
    pause
    exit /b 1
)
echo.

echo ========================================
echo 5. Migration: Table de mapping operateurs
echo ========================================
sqlcmd -S %SERVER% -d %DATABASE% -U %USER% -P %PASSWORD% -i "migration_create_operator_mapping.sql"
if %ERRORLEVEL% NEQ 0 (
    echo ERREUR lors de l'execution de migration_create_operator_mapping.sql
    pause
    exit /b 1
)
echo.

echo ========================================
echo 6. Scripts: Procedures stockees mapping
echo ========================================
sqlcmd -S %SERVER% -d %DATABASE% -U %USER% -P %PASSWORD% -i "scripts_operator_mapping.sql"
if %ERRORLEVEL% NEQ 0 (
    echo ERREUR lors de l'execution de scripts_operator_mapping.sql
    pause
    exit /b 1
)
echo.

echo ========================================
echo Toutes les migrations ont ete executees avec succes!
echo ========================================
pause

