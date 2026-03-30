# SILOG — Remontée des temps vers l'ERP (EDI_JOB / SEDI_ETDIFF)

## Architecture du flux

```
┌──────────────┐     ┌──────────────────────────┐     ┌───────────────────────┐     ┌──────────┐
│  Tablette    │     │ SEDI_APP_INDEPENDANTE     │     │ Tâche planifiée       │     │ SILOG    │
│  (frontend)  │────>│ ABTEMPS_OPERATEURS        │────>│ SILOG.exe -eEDI_JOB   │────>│ ERP      │
│              │     │                           │     │ sur SVC_SILOG         │     │ SEDI_ERP │
└──────────────┘     │  StatutTraitement:        │     │ utilisateur:          │     └──────────┘
                     │  NULL → 'O' → 'T'        │     │  Production8          │
                     │                           │     │ code tâche:           │
                     │  V_REMONTE_TEMPS          │     │  SEDI_ETDIFF          │
                     │  (filtre: 'O' + dur>0)    │     └───────────────────────┘
                     └──────────────────────────┘
```

### Flux détaillé

| Étape | Qui | Action | StatutTraitement |
|-------|-----|--------|-----------------|
| 1 | Backend (opérations) | INSERT dans ABTEMPS_OPERATEURS | `NULL` |
| 2 | Backend (auto 20h ou admin) | UPDATE StatutTraitement = 'O' | `NULL` → `'O'` |
| 3 | V_REMONTE_TEMPS | Expose les lignes 'O' + ProductiveDuration > 0 | `'O'` |
| 4 | SEDI_ETDIFF (SVC_SILOG) | Lit V_REMONTE_TEMPS, intègre dans SILOG | `'O'` |
| 5 | **⚠️ À CONFIRMER** | Qui passe 'T' ? SILOG directement ou le backend ? | `'O'` → `'T'` |

### Point critique : passage en 'T'

**Question ouverte pour Franck MAILLARD** : après que SEDI_ETDIFF a intégré les temps,
est-ce que SILOG met à jour `StatutTraitement = 'T'` directement dans
`SEDI_APP_INDEPENDANTE.dbo.ABTEMPS_OPERATEURS`, ou faut-il que le backend s'en charge ?

Si c'est SILOG qui écrit 'T' :
- Le backend n'a rien à faire après l'étape 2
- Le backend surveille les enregistrements 'O' non consommés (watchdog)

Si c'est le backend qui doit écrire 'T' :
- Il faut un mécanisme de callback ou de polling pour savoir que SILOG a bien traité
- Route existante : `MonitoringService.markBatchAsTransmitted()`

## Infrastructure

### Poste d'exécution

- **Poste** : `SVC_SILOG` (et NON `SERVEURERP`)
- **Utilisateur SILOG** : `Production8`
- **Planificateur de tâches** : sur `SVC_SILOG` (accès requis pour vérifier la fréquence)
- **Fréquence constatée** : ~1 exécution/minute (capture du 30/03/2026)

### Commande de référence

Franck MAILLARD a fourni la commande suivante :

```powershell
start-process -FilePath "\\SERVEURERP\SILOG8\SILOG.exe" `
  -ArgumentList "-bSEDI_TESTS -uProduction8 -p -dfr_fr -eEDI_JOB -optcodetache=SEDI_ETDIFF -mCOMPACT" `
  -workingdirectory "\\SERVEURERP\SILOG8" -wait
```

### Variables (test / prod)

| Variable | Test | Production |
|----------|------|-----------|
| Base de données (`-b`) | `SEDI_TESTS` | `SEDI_ERP` |
| Utilisateur (`-u`) | `Production8` | `Production8` |
| Code tâche (`-optcodetache`) | `SEDI_ETDIFF` | `SEDI_ETDIFF` |

## Configuration backend

Le backend est en mode `SILOG_REMOTE_MODE=scheduled` : il **ne déclenche pas** SILOG.exe.
Il se contente de :
1. Écrire dans `ABTEMPS_OPERATEURS`
2. Passer `StatutTraitement = 'O'` (validation auto à 20h ou manuelle)
3. Surveiller que les enregistrements 'O' sont consommés (watchdog)

### Variables d'environnement pertinentes

```env
SILOG_REMOTE_MODE=scheduled

# Validation automatique des temps
ENABLE_AUTO_VALIDATE_TEMPS=true
AUTO_VALIDATE_TEMPS_HOUR=20

# Watchdog : alerte si des enregistrements 'O' ne sont pas passés 'T' après X heures
SILOG_STALE_THRESHOLD_HOURS=24
```

## Diagnostic

### Endpoints admin

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/admin/diagnostic-temps` | GET | État de ABTEMPS (durées 0, non validés, OK) |
| `/api/admin/diagnostic-orphans` | GET | Opérations terminées sans ligne ABTEMPS |
| `/api/admin/silog-pipeline-status` | GET | Santé du flux : enregistrements 'O' en attente, ancienneté |
| `/api/admin/reconsolidate` | POST | Recalcule toutes les durées depuis l'historique |
| `/api/admin/validate-temps` | POST | Passe en 'O' (masse ou sélectif) |
| `/api/admin/edi-job/config` | GET | Configuration EDI_JOB |

### Vérifications SQL directes

```sql
-- Combien d'enregistrements par statut ?
SELECT StatutTraitement, COUNT(*) AS Nb
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
GROUP BY StatutTraitement;

-- V_REMONTE_TEMPS retourne-t-elle des lignes ?
SELECT TOP 10 * FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_REMONTE_TEMPS];

-- Enregistrements 'O' non consommés depuis plus de 24h (SEDI_ETDIFF bloquée ?)
SELECT * FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
WHERE StatutTraitement = 'O'
  AND DATEDIFF(HOUR, DateCreation, GETDATE()) > 24;
```
