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
| 4 | SEDI_ETDIFF (SVC_SILOG, **en continu**) | Lit V_REMONTE_TEMPS, intègre dans SILOG | `'O'` |
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

### Multi-cycles même jour (blocage EDI — 22/09/2026)

**Constat prod `LT2601054` / opérateur 009** : FSOP a 3 lignes ABTEMPS (TempsId **444** = 4 min, **445** = 18 min, **446** = 56 min → **78 min = 1,30 h**), toutes passées en `T`.  
Dans `SEDI_ERP.dbo.ETEMPS` : **1 seule ligne** (`VarNumUtil2=444`, `DureeExecution≈0,07`, `MinutesExecuto=4`). Le rapport SILOG « Temps Passés par Lancement » n’affiche donc que **0,07** (productivité absurde vs temps nécessaire 16,60).

**Cause** : l’anti-doublon EDI ci-dessus traite les 3 cycles comme la même clé métier (même jour / LT / phase / poste / opérateur) → seule la 1ʳᵉ ligne est intégrée ; les suivantes sont ignorées (tout en pouvant quand même basculer en `T` côté app).

**Action SILOG (Franck — hors repo FSOP)** : enrichir la clé d’existence pour accepter **plusieurs exécutions le même jour**, par ex. :

- `DateTravail` + `CodeLancement` + `Phase` + `CodePoste` + `CodeOperateur` + **`HeureDebut`/`MinuteDebut`** (ou plage début–fin), **ou**
- revenir à une idempotence fiable sur **`VarNumUtil2` = TempsId** (1 ligne ETEMPS par TempsId).

**Statut (23/09/2026)** : restriction `SEDI_ETDIFF` levée par Franck ; 445 et 446 intégrés comme lignes distinctes. La tablette n’agrège plus les cycles.

**Retour Franck MAILLARD (23/09/2026)** : une restriction historique dans `SEDI_ETDIFF` (époque où le booléen `StatutTraitement` n’était pas bien géré) n’avait pas été levée. **C’est maintenant fait.** Les TempsId **445** et **446** ont été intégrés manuellement dans SILOG.

Les heures de début / fin d’exécution sont exposées en **numérique** pour l’écran ERP « Suivi de Production » (variables déjà utilisées par la saisie SILOG native). Accord Franck MAILLARD (23/09/2026) : conserver ce mappage.

Côté FSOP, `V_REMONTE_TEMPS` expose donc :

| Colonne vue | Type | Exemple | Usage SILOG |
|-------------|------|---------|-------------|
| `HeureDebut` | `INT` (0–23) | `9` | `VarNumUtil8` |
| `MinutesDebut` | `INT` (0–59) | `15` | `VarNumUtil9` |
| `HeureFin` | `INT` (0–23) | `9` | `VarNumUtil10` |
| `MinutesFin` | `INT` (0–59) | `48` | `VarNumUtil11` |
| `CommentaireHeureDebut` | `VARCHAR(8)` | `09:15:17` | Info uniquement (plus le mappage horaire) |
| `CommentaireHeureFin` | `VARCHAR(8)` | `09:48:23` | Info uniquement |
| `CommentaireHoraires` | `VARCHAR(50)` | `09:15:17 - 09:48:23` | Info uniquement |

Les secondes sont ignorées, comme sur l’écran ERP. Si `StartTime` / `EndTime` est absent, la colonne numérique reste `NULL` (`0` signifierait minuit).

`StartTime` / `EndTime` restent en `DATETIME2` pour le diagnostic FSOP ; SILOG n’a pas besoin de les consommer.

**Action SILOG (Franck — `EDI_JOB` / `SEDI_ETDIFF`)** : mapper `HeureDebut` → `VarNumUtil8`, `MinutesDebut` → `VarNumUtil9`, `HeureFin` → `VarNumUtil10`, `MinutesFin` → `VarNumUtil11`. La vue FSOP est la source ; ne pas recréer ces colonnes côté SILOG.

**Règle FSOP (23/09/2026)** : **1 TempsId = 1 ligne SILOG**. `reconcileSameKeyCyclesForSilog()` est un pass-through (plus de fusion, plus d’UPDATE `ETEMPS` cumulé). Les TempsId 444 / 445 / 446 restent trois lignes distinctes.

**Interdit** : cumuler / basculer les minutes d’un opérateur sur un autre, même s’ils pointent le même LT.

**Ne plus exécuter** l’ancien UPDATE qui cumule 4+18+56 = 78 min sur `NoEnregistrement = 248150` : cela recollerait les 3 cycles. Attendu désormais : **3 lignes ETEMPS** (444 = 4 min, 445 = 18 min, 446 = 56 min).

### Fréquence d’exécution EDI

- Ancienne observation (mars 2026) : exécutions très fréquentes sur `SVC_SILOG`.
- **Depuis le 01/04/2026** : la tâche EDI ne tourne plus qu’**une fois par jour** (paramétrage planificateur / SILOG — hors code FSOP).
- **Besoin métier (SEDI, juillet 2026)** : visibilité des temps **à tout moment dans SILOG** → faire tourner **SEDI_ETDIFF en continu** sur `SVC_SILOG` (action Franck / infra).
- La validation `NULL` → `'O'` reste manuelle via **Transfert admin** (évite les doublons côté SILOG). Filet auto à **20h**.

### Lancements soldés et remontée tablette (règle à assouplir)

**Constat prod (21/09/2026, Intérimaire 8)** : FSOP a bien mis en `O` / `V_REMONTE_TEMPS` les TempsId **437** (LT2600479 Magasin) et **438** (LT2600388 ConnectS). Seul **439** (LT2600874, `LancementSolde='N'`) a été intégré en `ETEMPS` puis passé en `T`. Les deux autres LT étaient **soldés** (`LCTE.LancementSolde='O'`) → `SEDI_ETDIFF` les a ignorés.

**Décision métier (SEDI / tablette)** : la remontée des temps **tablette** doit être acceptée **même si le lancement est soldé**. Un opérateur peut pointer sur un LT déjà soldé ; ces temps restent des temps réels à remonter.

**Action SILOG (Franck MAILLARD — hors repo FSOP)** : dans la tâche EDI `SEDI_ETDIFF`, **retirer (ou contourner) le filtre** qui exclut les lignes dont le `CodeLancement` a `LCTE.LancementSolde <> 'N'`. La source reste `V_REMONTE_TEMPS` (`StatutTraitement='O'` + `ProductiveDuration > 0`). Après modification, relancer `SEDI_ETDIFF` pour consommer les `O` en attente (ex. TempsId 437, 438).

**Côté FSOP** : rien à filtrer sur soldé pour la validation Transfert → `O` ; `V_REMONTE_TEMPS` expose déjà ces lignes. Le watchdog peut continuer à signaler les `O` stale sur LT soldés comme **bloqués EDI** tant que la règle SILOG n’est pas assouplie.

Ancien comportement documenté (avant assouplissement) : intégration refusée sur LT soldé — à ne plus considérer comme attendu pour la tablette.

## Infrastructure

### Prérequis Ansible (runner SSH)

Voir [`ansible/README.md`](../../ansible/README.md) : playbook pour installer OpenSSH sur `SVC_SILOG`, déployer la clé FSOP, vérifier `SILOG.exe`, créer la tâche filet. Le **déclenchement au clic** reste `SILOG_REMOTE_MODE=ssh` côté backend.

### Poste d'exécution

- **Poste** : `SVC_SILOG` (et NON `SERVEURERP`)
- **Utilisateur SILOG** : `Production8`
- **Planificateur de tâches** : sur `SVC_SILOG` (accès requis pour vérifier la fréquence)
- **Fréquence SEDI_ETDIFF (tablettes CURTIS)** : **~17h15** actuellement — **à faire évoluer** vers une exécution **en continu** (visibilité SILOG permanente).
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
SELECT TOP 10
    TempsId, LancementCode, OperatorCode, DureeExecution,
    HeureDebut, MinutesDebut, HeureFin, MinutesFin,
    CommentaireHeureDebut, CommentaireHeureFin, CommentaireHoraires
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_REMONTE_TEMPS];

-- Enregistrements 'O' non consommés depuis plus de 24h (SEDI_ETDIFF bloquée ?)
SELECT * FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
WHERE StatutTraitement = 'O'
  AND DATEDIFF(HOUR, DateCreation, GETDATE()) > 24;
```
