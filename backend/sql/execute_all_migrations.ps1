# Script PowerShell pour exécuter toutes les migrations dans l'ordre
# Base de données: SEDI_APP_INDEPENDANTE

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Execution de toutes les migrations SQL" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration depuis config-production.js
$Server = "192.168.1.14"
$Database = "SEDI_APP_INDEPENDANTE"
$User = "QUALITE"
$Password = "QUALITE"

Write-Host "Serveur: $Server" -ForegroundColor Yellow
Write-Host "Base de donnees: $Database" -ForegroundColor Yellow
Write-Host ""

# Vérifier si sqlcmd est disponible
$sqlcmdPath = Get-Command sqlcmd -ErrorAction SilentlyContinue
if (-not $sqlcmdPath) {
    Write-Host "ERREUR: sqlcmd n'est pas trouve dans le PATH" -ForegroundColor Red
    Write-Host "Veillez installer SQL Server Command Line Utilities" -ForegroundColor Red
    Read-Host "Appuyez sur Entree pour quitter"
    exit 1
}

$scripts = @(
    @{Name="1. Migration: Extension AB_COMMENTAIRES_OPERATEURS"; File="migration_extend_comments.sql"},
    @{Name="2. Migration: Extension ABHISTORIQUE_OPERATEURS"; File="migration_extend_historique.sql"},
    @{Name="3. Migration: Extension ABTEMPS_OPERATEURS"; File="migration_extend_temps.sql"},
    @{Name="4. Migration: Creation vues SILOG"; File="migration_create_silog_views.sql"},
    @{Name="5. Migration: Table de mapping operateurs"; File="migration_create_operator_mapping.sql"},
    @{Name="6. Scripts: Procedures stockees mapping"; File="scripts_operator_mapping.sql"}
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

foreach ($script in $scripts) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host $script.Name -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    $scriptPath = Join-Path $scriptDir $script.File
    
    if (-not (Test-Path $scriptPath)) {
        Write-Host "ERREUR: Fichier non trouve: $scriptPath" -ForegroundColor Red
        Read-Host "Appuyez sur Entree pour quitter"
        exit 1
    }
    
    $securePassword = ConvertTo-SecureString $Password -AsPlainText -Force
    $credential = New-Object System.Management.Automation.PSCredential($User, $securePassword)
    
    try {
        $result = sqlcmd -S $Server -d $Database -U $User -P $Password -i $scriptPath -b
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERREUR lors de l'execution de $($script.File)" -ForegroundColor Red
            Write-Host "Code de sortie: $LASTEXITCODE" -ForegroundColor Red
            Read-Host "Appuyez sur Entree pour quitter"
            exit 1
        }
        Write-Host "OK: $($script.File) execute avec succes" -ForegroundColor Green
    }
    catch {
        Write-Host "ERREUR lors de l'execution de $($script.File): $_" -ForegroundColor Red
        Read-Host "Appuyez sur Entree pour quitter"
        exit 1
    }
    
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "Toutes les migrations ont ete executees avec succes!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Read-Host "Appuyez sur Entree pour quitter"

