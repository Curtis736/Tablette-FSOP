# Exigences de reporting - Cohérence des logs

## Rapports attendus

### 1. Temps par opérateur par jour
**Vue utilisée**: `vwDailyOperatorSummary`

**Données**:
- Date de travail
- Code opérateur + nom
- Temps total (minutes/heures)
- Temps productif (minutes/heures)
- Temps de pause (minutes)
- Nombre de lancements distincts
- Nombre d'opérations
- Nombre de sessions
- Taux de productivité moyen (%)

**Index requis**: 
- `IX_Temps_Operator_Lancement_Date` sur `ABTEMPS_OPERATEURS`
- Index sur `DateCreation` pour filtrage par date

**Exemple de requête**:
```sql
SELECT * FROM vwDailyOperatorSummary
WHERE WorkDate >= DATEADD(day, -30, GETDATE())
ORDER BY WorkDate DESC, TotalMinutes DESC;
```

### 2. Temps par lancement
**Vue utilisée**: `vwOperatorLancementTimes`

**Données**:
- Code lancement + nom
- Opérateur(s) ayant travaillé dessus
- Temps total par opérateur
- Temps productif par opérateur
- Temps de pause par opérateur
- Méthode de calcul utilisée
- Date de calcul

**Index requis**:
- `IX_Temps_Operator_Lancement_Date` sur `ABTEMPS_OPERATEURS`
- Index sur `LancementCode` pour recherche par lancement

**Exemple de requête**:
```sql
SELECT * FROM vwOperatorLancementTimes
WHERE LancementCode = 'LT2500643'
ORDER BY DateCreation DESC;
```

### 3. Sessions actives
**Vue utilisée**: `vwActiveSessions`

**Données**:
- Opérateur connecté
- Heure de connexion
- Dernière activité
- Durée de session
- Minutes depuis dernière activité (détection AFK)
- Nombre d'opérations en cours
- Dernière action effectuée

**Index requis**:
- `IX_Sessions_Operator_Status` sur `ABSESSIONS_OPERATEURS`
- `IX_Sessions_LastActivity` sur `ABSESSIONS_OPERATEURS`
- `IX_Historique_SessionId` sur `ABHISTORIQUE_OPERATEURS`

**Exemple de requête**:
```sql
SELECT * FROM vwActiveSessions
WHERE MinutesSinceLastActivity > 30; -- Opérateurs inactifs > 30 min
```

### 4. Historique complet d'une session
**Vue utilisée**: `vwOperatorSessions` + `vwAuditTrail`

**Données**:
- Détails de la session (login, logout, durée)
- Tous les événements d'audit de la session
- Toutes les actions effectuées
- Temps passé sur chaque lancement

**Index requis**:
- `IX_Audit_Session` sur `AB_AUDIT_EVENTS`
- `IX_Historique_SessionId` sur `ABHISTORIQUE_OPERATEURS`

**Exemple de requête**:
```sql
-- Session complète
SELECT * FROM vwOperatorSessions
WHERE SessionId = 123;

-- Audit trail de la session
SELECT * FROM vwAuditTrail
WHERE SessionId = 123
ORDER BY OccurredAt ASC;
```

### 5. Top erreurs / problèmes
**Vue utilisée**: `vwAuditTrail`

**Données**:
- Erreurs par type (client/server)
- Erreurs par endpoint
- Erreurs par opérateur
- Fréquence des erreurs
- Messages d'erreur

**Index requis**:
- `IX_Audit_Errors` sur `AB_AUDIT_EVENTS`
- `IX_Audit_Action` sur `AB_AUDIT_EVENTS`

**Exemple de requête**:
```sql
SELECT 
    Action,
    Endpoint,
    COUNT(*) AS ErrorCount,
    MAX(OccurredAt) AS LastOccurrence
FROM vwAuditTrail
WHERE Severity = 'ERROR'
  AND OccurredAt >= DATEADD(day, -7, GETDATE())
GROUP BY Action, Endpoint
ORDER BY ErrorCount DESC;
```

### 6. Performance des endpoints
**Vue utilisée**: `vwAuditTrail`

**Données**:
- Endpoint
- Durée moyenne (ms)
- Durée max (ms)
- Durée min (ms)
- Nombre d'appels
- Taux de succès (%)

**Index requis**:
- `IX_Audit_OccurredAt` sur `AB_AUDIT_EVENTS`
- Index sur `Endpoint` pour regroupement

**Exemple de requête**:
```sql
SELECT 
    Endpoint,
    Method,
    COUNT(*) AS CallCount,
    AVG(CAST(DurationMs AS FLOAT)) AS AvgDurationMs,
    MAX(DurationMs) AS MaxDurationMs,
    MIN(DurationMs) AS MinDurationMs,
    SUM(CASE WHEN StatusCode >= 200 AND StatusCode < 300 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS SuccessRate
FROM vwAuditTrail
WHERE OccurredAt >= DATEADD(day, -1, GETDATE())
GROUP BY Endpoint, Method
ORDER BY AvgDurationMs DESC;
```

### 7. Utilisation par opérateur (hebdomadaire/mensuelle)
**Vue utilisée**: `vwDailyOperatorSummary` (agrégation)

**Données**:
- Période (semaine/mois)
- Opérateur
- Temps total cumulé
- Nombre de jours travaillés
- Moyenne quotidienne
- Nombre de lancements traités

**Exemple de requête**:
```sql
SELECT 
    OperatorCode,
    OperatorName,
    COUNT(*) AS DaysWorked,
    SUM(TotalMinutes) AS TotalMinutes,
    AVG(TotalMinutes) AS AvgDailyMinutes,
    SUM(DistinctLancementsCount) AS TotalLancements
FROM vwDailyOperatorSummary
WHERE WorkDate >= DATEADD(month, -1, GETDATE())
GROUP BY OperatorCode, OperatorName
ORDER BY TotalMinutes DESC;
```

## Index recommandés (déjà créés dans les migrations)

### Tables principales
- `ABSESSIONS_OPERATEURS`:
  - `IX_Sessions_Operator_Status` (OperatorCode, SessionStatus, DateCreation)
  - `IX_Sessions_LastActivity` (LastActivityTime DESC)

- `ABHISTORIQUE_OPERATEURS`:
  - `IX_Historique_SessionId` (SessionId, CreatedAt DESC)
  - `IX_Historique_CreatedAt` (CreatedAt DESC)
  - `IX_Historique_Operator_Lancement_Date` (OperatorCode, CodeLanctImprod, CreatedAt DESC)

- `ABTEMPS_OPERATEURS`:
  - `IX_Temps_Operator_Lancement_Date` (OperatorCode, LancementCode, DateCreation DESC)
  - `IX_Temps_SessionId` (SessionId, DateCreation DESC)

- `AB_AUDIT_EVENTS`:
  - `IX_Audit_OccurredAt` (OccurredAt DESC)
  - `IX_Audit_Operator` (OperatorCode, OccurredAt DESC)
  - `IX_Audit_Session` (SessionId, OccurredAt DESC)
  - `IX_Audit_Lancement` (LancementCode, OccurredAt DESC)
  - `IX_Audit_Action` (Action, OccurredAt DESC)
  - `IX_Audit_Errors` (Severity, OccurredAt DESC)

## Stratégie de partitionnement (optionnel, si volumétrie importante)

Pour `AB_AUDIT_EVENTS`:
- Partition mensuelle sur `OccurredAt`
- Facilite la purge/archivage
- Améliore les performances sur grandes volumétries

## Rétention des données

- **Audit**: 90 jours (configurable via `spPurgeAuditEvents`)
- **Sessions**: 30 jours (nettoyage automatique au démarrage)
- **Historique**: Conservation indéfinie (données métier)
- **Temps**: Conservation indéfinie (données métier)

## Notes pour le DBA

1. **Volumétrie attendue**:
   - Audit: ~100-500 événements/jour/opérateur
   - Historique: ~10-50 événements/jour/opérateur
   - Sessions: ~1-5 sessions/jour/opérateur

2. **Maintenance**:
   - Réindexation hebdomadaire recommandée
   - Mise à jour des statistiques après purge
   - Monitoring de la croissance des tables

3. **Performance**:
   - Les vues sont optimisées avec INCLUDE columns
   - Les index couvrent les requêtes de reporting courantes
   - Considérer le partitionnement si > 1M lignes dans `AB_AUDIT_EVENTS`


