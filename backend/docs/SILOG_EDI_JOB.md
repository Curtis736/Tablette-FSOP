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
| 2 | Admin « Transfert » (ou auto **20h**) | UPDATE StatutTraitement = 'O' | `NULL` → `'O'` |
| 3 | V_REMONTE_TEMPS | Expose les lignes 'O' + ProductiveDuration > 0 | `'O'` |
| 4 | SEDI_ETDIFF (SVC_SILOG, **toutes 2 h dès 8h**) | Lit V_REMONTE_TEMPS, intègre dans SILOG | `'O'` |
| 5 | SILOG / fin de job SEDI_ETDIFF | Mise à jour du statut côté base après intégration (voir retour Franck MAILLARD, avril 2026) | `'O'` → `'T'` (ou équivalent métier) |

### Point critique : passage en 'T' (statut après intégration SILOG)

**Retour Franck MAILLARD (avril 2026)** : une requête de mise à jour a été ajoutée **en fin de traitement** du job EDI `SEDI_ETDIFF` pour refléter l’intégration dans la table applicative. Sur `SEDI_APP_INDEPENDANTE.dbo.ABTEMPS_OPERATEURS`, le nom **réel** de la colonne est **`StatutTraitement`** (`varchar`) — vérifié via `sys.columns`. Le terme « TraitementStatut » dans le courriel correspond en pratique à **cette même colonne** (inversion de libellé) ; le script SILOG doit cibler **`StatutTraitement`**, comme le backend FSOP.

Conséquences pour le backend FSOP :

- Après validation (`NULL` → `'O'`), la bascule vers « traité / transmis » peut être assurée **par SILOG** à la fin du job, sans action obligatoire du backend.
- Le watchdog `/api/admin/silog-pipeline-status` et les alertes « lignes en `'O'` depuis X h » restent utiles si le planificateur ou SILOG est en retard.
- La route `MonitoringService.markBatchAsTransmitted()` (transfert manuel côté admin) peut coexister avec SILOG : en cas de doute, aligner la procédure métier (qui est la source de vérité du statut `'T'`).

### Déduplication SILOG : plus de fiabilité sur `TempsID` / `varnumutil2`

Historiquement, l’identifiant `TempsID` de `ABTEMPS_OPERATEURS` était recopié dans une variable libre SILOG (`varnumutil2` sur `ETEMPS`) pour éviter les doubles intégrations. **Ce mécanisme n’est plus considéré comme fiable** (écarts constatés entre SILOG et SEDI_APP, risque d’ignorer des lignes).

**Nouvelle règle côté requête SILOG (Franck)** : le contrôle d’existence / anti-doublon repose sur la combinaison métier :

`DateTravail`, `CodeLancement`, `Phase`, `CodePoste`, `CodeOperateur`

Le backend FSOP continue d’écrire `TempsID` (identité technique SQL) ; **ne pas s’appuyer sur une égalité stricte TempsID ↔ SILOG** pour diagnostiquer les doublons ou les « manquants ».

### Fréquence d’exécution EDI

- Ancienne observation (mars 2026) : exécutions très fréquentes sur `SVC_SILOG`.
- **Depuis le 01/04/2026** : la tâche EDI ne tourne plus qu’**une fois par jour** (paramétrage planificateur / SILOG — hors code FSOP).
- **Besoin métier (David, juillet 2026)** : visibilité des temps **dans SILOG en journée** → planifier **SEDI_ETDIFF toutes les 2 h à partir de 8h** sur `SVC_SILOG` (action Franck / infra).
- La validation `NULL` → `'O'` reste manuelle via **Transfert admin** (évite les doublons côté SILOG). Filet auto à **20h**.

### Lancements soldés et lignes non validées

- Des enregistrements **validés** (`StatutTraitement = 'O'`) peuvent **ne pas être intégrés** s’ils concernent un **lancement soldé** côté ERP — comportement attendu côté SILOG / LCTE.
- Exemple cité : **LT2600188** soldé → la ligne associée ne pourra pas être intégrée après validation ; traitement manuel ou correction ERP (désolde / autre procédure) selon la gouvernance SEDI.
- Les enregistrements encore en **`NULL`** (non validés) ne sortent pas dans `V_REMONTE_TEMPS` tant qu’ils ne passent pas en `'O'`.

## Infrastructure

### Poste d'exécution

- **Poste** : `SVC_SILOG` (et NON `SERVEURERP`)
- **Utilisateur SILOG** : `Production8`
- **Planificateur de tâches** : sur `SVC_SILOG` (accès requis pour vérifier la fréquence)
- **Fréquence SEDI_ETDIFF (tablettes CURTIS)** : **~17h15** actuellement — **à faire évoluer** vers **toutes 2 h à partir de 8h** (visibilité SILOG en journée).
- **Fréquence SIL_ETDIFF (Itium / saisie SILOG native)** : flux distinct, ne pas confondre.
- Ancienne observation (mars 2026) : exécutions très fréquentes ; depuis avril 2026 observation **quotidienne** pour SEDI_ETDIFF.

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
2. Passer `StatutTraitement = 'O'` via **Transfert admin** ou validation auto à 20h
3. Surveiller que les enregistrements 'O' sont consommés (watchdog)

### Variables d'environnement pertinentes

```env
SILOG_REMOTE_MODE=scheduled

# Validation automatique des temps
ENABLE_AUTO_VALIDATE_TEMPS=true
AUTO_VALIDATE_TEMPS_HOUR=20
# Désactivé par défaut — validation via Transfert admin
AUTO_VALIDATE_ON_FIN=false

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
