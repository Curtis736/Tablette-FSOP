<#
.SYNOPSIS
    Lancement du traitement SILOG avec log transcrit + rotation + État final.

.DESCRIPTION
    - Fait une rotation du log si > 10 Mo (archive horodatée).
    - Purge les archives de plus de 30 jours.
    - Démarre une transcription PowerShell.
    - Exécute le traitement SILOG.
    - Écrit un bloc final "État : Succès / Erreur / Refusé".
    - Retourne un exit code exploitable par le planificateur de tâches :
        0 = Succès
        1 = Erreur
        2 = Refusé

.NOTES
    Déploiement cible : SERVEURERP -> C:\Scripts\run_silog.ps1
    Exécuté par      : SEDI\svc_silog
    Planificateur    : powershell.exe -ExecutionPolicy Bypass -File C:\Scripts\run_silog.ps1
#>

param(
    [string]$LogDir        = 'C:\Scripts',
    [string]$LogName       = 'silog.log',
    [int]   $MaxSizeMB     = 10,
    [int]   $RetentionDays = 30
)

# ---------------------------------------------------------------
# 1. Préparation du répertoire de logs
# ---------------------------------------------------------------
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$LogFile = Join-Path $LogDir $LogName
$MaxSize = $MaxSizeMB * 1MB

# ---------------------------------------------------------------
# 2. Rotation si fichier trop gros
# ---------------------------------------------------------------
if (Test-Path $LogFile) {
    try {
        $size = (Get-Item $LogFile).Length
        if ($size -gt $MaxSize) {
            $stamp   = Get-Date -Format 'yyyyMMdd_HHmmss'
            $archive = Join-Path $LogDir ("silog_{0}.log" -f $stamp)
            Move-Item -Path $LogFile -Destination $archive -Force
        }
    } catch {
        Write-Warning "Rotation log impossible : $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------
# 3. Purge des archives anciennes
# ---------------------------------------------------------------
try {
    Get-ChildItem -Path $LogDir -Filter 'silog_*.log' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
} catch {
    Write-Warning "Purge logs impossible : $($_.Exception.Message)"
}

# ---------------------------------------------------------------
# 4. Démarrage transcription
# ---------------------------------------------------------------
Start-Transcript -Path $LogFile -Append | Out-Null

$start   = Get-Date
$etat    = 'Succès'
$code    = 0
$message = ''

try {
    Write-Host "=== Début traitement SILOG : $($start.ToString('s')) ==="
    Write-Host "Utilisateur : $env:USERDOMAIN\$env:USERNAME"
    Write-Host "Machine     : $env:COMPUTERNAME"

    # -----------------------------------------------------------
    # === TRAITEMENT SILOG RÉEL À METTRE ICI ====================
    # Exemples :
    #   & 'C:\Chemin\vers\silog.exe' /param1 /param2
    #   Invoke-Sqlcmd -ServerInstance 'SVC_SILOG' -Database 'SILOG' -Query '...'
    #   & 'C:\Chemin\ETL\run.bat'
    # -----------------------------------------------------------

    Write-Host "Traitement principal OK"
}
catch {
    $message = $_.Exception.Message

    if ($message -match '(?i)refus|rejet|rejected|denied') {
        $etat = 'Refusé'
        $code = 2
    }
    else {
        $etat = 'Erreur'
        $code = 1
    }

    Write-Warning "Exception : $message"
}
finally {
    $end      = Get-Date
    $duration = $end - $start

    Write-Host ''
    Write-Host '==============================================='
    Write-Host ("État     : {0}" -f $etat)
    if ($etat -ne 'Succès') {
        Write-Host ("Détail   : {0}" -f $message)
    }
    Write-Host ("Début    : {0}" -f $start.ToString('s'))
    Write-Host ("Fin      : {0}" -f $end.ToString('s'))
    Write-Host ("Durée    : {0}" -f $duration)
    Write-Host ("ExitCode : {0}" -f $code)
    Write-Host '==============================================='

    Stop-Transcript | Out-Null
    exit $code
}
