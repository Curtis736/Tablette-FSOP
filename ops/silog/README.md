# SILOG - Script de lancement PowerShell

Script d'exécution du traitement SILOG sur **SERVEURERP** avec :

- transcription PowerShell automatique,
- rotation de log (seuil `10 Mo`, rétention `30 jours`),
- bloc final structuré `État : Succès / Erreur / Refusé`,
- exit code exploitable par le planificateur de tâches (`0` succès, `1` erreur, `2` refusé).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `run_silog.ps1` | Script principal à déployer sur `SERVEURERP` dans `C:\Scripts\run_silog.ps1`. |

## Déploiement

1. Copier `run_silog.ps1` dans `C:\Scripts\` sur `SERVEURERP`.
2. Remplacer le bloc commenté `=== TRAITEMENT SILOG RÉEL ===` par l'appel réel (exe / ETL / `Invoke-Sqlcmd`).
3. Créer / mettre à jour la tâche planifiée :
   - Utilisateur : `SEDI\svc_silog`
   - Action :
     ```
     powershell.exe -ExecutionPolicy Bypass -File C:\Scripts\run_silog.ps1
     ```

## Paramètres

Les paramètres peuvent être surchargés à l'appel :

```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\Scripts\run_silog.ps1 `
    -LogDir 'C:\Scripts' `
    -LogName 'silog.log' `
    -MaxSizeMB 10 `
    -RetentionDays 30
```

## Exemple de sortie

```
===============================================
État     : Succès
Début    : 2026-04-16T17:15:02
Fin      : 2026-04-16T17:15:09
Durée    : 00:00:07
ExitCode : 0
===============================================
```

En cas d'erreur / refus :

```
===============================================
État     : Refusé
Détail   : Lot déjà intégré côté SILOG
Début    : 2026-04-16T17:15:02
Fin      : 2026-04-16T17:15:04
Durée    : 00:00:02
ExitCode : 2
===============================================
```
