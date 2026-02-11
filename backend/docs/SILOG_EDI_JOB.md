# SILOG — Exécution de `EDI_JOB` (remontée des temps)

## Commande de référence (PowerShell)

Franck MAILLARD a fourni la commande suivante pour lancer SILOG en ligne de commande :

```powershell
start-process -FilePath "\\SERVEURERP\SILOG8\SILOG.exe" `
  -ArgumentList "-bSEDI_TESTS -uProduction8 -p -dfr_fr -eEDI_JOB -optcodetache=SEDI_ETDIFF -mCOMPACT" `
  -workingdirectory "\\SERVEURERP\SILOG8" -wait
```

## Variables (test / prod)

- `SEDI_TESTS` : base de données de tests (mettre `SEDI_ERP` en production)
- `Production8` : utilisateur (peut évoluer)
- `SEDI_ETDIFF` : **code tâche** d’intégration (identique en test/prod)

## Configuration backend

Configurer ces variables dans l’environnement du backend (voir `env.example`) :

- `SILOG_EXE_PATH` : chemin vers `SILOG.exe` (UNC recommandé)
- `SILOG_WORKDIR` : working directory (UNC)
- `SILOG_DB` : `SEDI_TESTS` ou `SEDI_ERP`
- `SILOG_USER` : utilisateur SILOG
- `SILOG_PASSWORD` : optionnel (si vide, le backend utilise `-p` sans valeur)
- `SILOG_LANG` : ex `fr_fr`
- `SILOG_TASK_CODE` : ex `SEDI_ETDIFF`
- `SILOG_MODE` : ex `COMPACT`

## API (admin)

Le backend expose des routes admin pour vérifier la config et déclencher le job :

- `GET /api/admin/edi-job/config`
- `POST /api/admin/edi-job/execute`

> Note: l’app déclenche généralement l’EDI_JOB automatiquement après un transfert (batch) via les routes monitoring.

