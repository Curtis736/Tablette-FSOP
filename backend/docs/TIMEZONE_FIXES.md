# Corrections de timezone - 20 janvier 2026

## Problème

Les heures affichées sur le dashboard avaient un décalage de +1h par rapport à l'heure réelle de l'ordinateur.

## Causes identifiées

1. **Conversion par Node.js** : Les colonnes `TIME(7)` (`HeureDebut`, `HeureFin`) et `DATETIME2` (`StartTime`, `EndTime`) étaient converties en objets `Date` par Node.js, ce qui introduisait des conversions de timezone.

2. **Utilisation de `DateCreation` au lieu de `CreatedAt`** : `DateCreation` est un `DATE` (sans heure), donc quand il était utilisé comme fallback, il créait des objets `Date` à minuit UTC, qui étaient ensuite convertis en `Europe/Paris` (+1h ou +2h selon la saison).

3. **Absence de timezone dans Docker** : Les conteneurs Docker n'avaient pas de timezone configurée.

## Solutions implémentées

### 1. Conversion SQL directe en VARCHAR(5)

**Fichiers modifiés** :
- `backend/services/MonitoringService.js`
- `backend/services/DataValidationService.js`

**Changement** : Les heures sont maintenant converties directement dans les requêtes SQL en format `HH:mm` :

```sql
CONVERT(VARCHAR(5), t.StartTime, 108) AS StartTime,
CONVERT(VARCHAR(5), t.EndTime, 108) AS EndTime,
CONVERT(VARCHAR(5), h.HeureDebut, 108) AS HeureDebut,
CONVERT(VARCHAR(5), h.HeureFin, 108) AS HeureFin
```

**Avantage** : Les heures arrivent déjà au format `HH:mm` (string) depuis SQL, évitant toute conversion par Node.js.

### 2. Utilisation de `CreatedAt` au lieu de `DateCreation`

**Fichier modifié** : `backend/routes/admin.js`

**Changement** : Prioriser `CreatedAt` (DATETIME2) sur `DateCreation` (DATE) :

```javascript
// Avant
endTime = formatDateTime(finEvent.DateCreation);

// Après
endTime = formatDateTime(finEvent.CreatedAt || finEvent.DateCreation);
```

**Avantage** : `CreatedAt` contient l'heure complète, évitant les problèmes de minuit UTC.

### 3. Configuration timezone dans Docker

**Fichier modifié** : `docker/docker-compose.production.yml`

**Changement** : Ajout de `TZ=Europe/Paris` dans les variables d'environnement :

```yaml
backend:
  environment:
    - TZ=Europe/Paris
    # ...

frontend:
  environment:
    - TZ=Europe/Paris
```

**Avantage** : Les conteneurs utilisent le fuseau horaire `Europe/Paris` pour toutes les opérations.

## Fichiers modifiés

1. ✅ `backend/services/MonitoringService.js`
   - Conversion `StartTime` et `EndTime` en `VARCHAR(5)` dans la requête SQL

2. ✅ `backend/services/DataValidationService.js`
   - Conversion `HeureDebut` et `HeureFin` en `VARCHAR(5)` dans les requêtes SQL
   - Ajout de `CreatedAt` dans les SELECT

3. ✅ `backend/routes/admin.js`
   - Utilisation de `CreatedAt` au lieu de `DateCreation` pour les heures
   - Priorisation de `CreatedAt` dans tous les fallbacks

4. ✅ `docker/docker-compose.production.yml`
   - Ajout de `TZ=Europe/Paris` pour backend et frontend

## Vérification

Pour vérifier que les corrections fonctionnent :

1. **Vérifier la timezone dans les conteneurs** :
```bash
docker exec sedi-tablette-backend date
docker exec sedi-tablette-frontend date
```

2. **Vérifier les heures dans les logs** :
```bash
docker logs sedi-tablette-backend | grep "formatDateTime"
```

3. **Tester sur le dashboard** :
   - Les heures affichées doivent correspondre à l'heure de l'ordinateur
   - Pas de décalage de +1h ou +2h

## Notes importantes

- Les heures sont maintenant toujours au format `HH:mm` (string) depuis SQL
- `CreatedAt` est priorisé sur `DateCreation` pour éviter les problèmes de timezone
- Les conteneurs Docker utilisent `Europe/Paris` comme timezone
- Aucune conversion de timezone n'est effectuée par Node.js pour les heures

## Format SQL utilisé

- `CONVERT(VARCHAR(5), timeColumn, 108)` : Convertit `TIME(7)` ou `DATETIME2` en `HH:mm`
- Format 108 = `hh:mi:ss` (on prend les 5 premiers caractères pour `HH:mm`)

## Impact

- ✅ Les heures affichées correspondent à l'heure réelle
- ✅ Pas de décalage de timezone
- ✅ Cohérence entre backend, frontend et base de données
- ✅ Les heures sont toujours au format `HH:mm` (string)
