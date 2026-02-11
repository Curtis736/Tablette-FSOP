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

## Backend sur Linux (runner Windows requis)

Si le backend tourne sur Linux (`process.platform=linux`), il **ne peut pas exécuter** `SILOG.exe`.

Deux options :

1) **Exécuter le backend sur Windows** (recommandé si possible)

2) **Runner Windows distant via SSH** (Linux -> Windows)

- Installer/activer **OpenSSH Server** sur un hôte Windows qui a accès au partage `\\SERVEURERP\\SILOG8`
- Configurer l’auth SSH (idéalement par clé)
- Définir dans `.env` côté backend Linux :
  - `SILOG_REMOTE_MODE=ssh`
  - `SILOG_SSH_HOST=...`
  - `SILOG_SSH_USER=...`
  - `SILOG_SSH_KEY_PATH=...` (optionnel)

Le backend lancera alors PowerShell sur l’hôte Windows via SSH, en utilisant `Start-Process ... -Wait`.

## API (admin)

Le backend expose des routes admin pour vérifier la config et déclencher le job :

- `GET /api/admin/edi-job/config`
- `POST /api/admin/edi-job/execute`

> Note: l’app déclenche généralement l’EDI_JOB automatiquement après un transfert (batch) via les routes monitoring.

