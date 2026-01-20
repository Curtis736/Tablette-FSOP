# ProductiveDuration - Unité et Validation

## Unité de temps

**ProductiveDuration est toujours exprimé en MINUTES** dans toute l'application.

### Calcul

```javascript
ProductiveDuration = TotalDuration - PauseDuration
```

Où :
- `TotalDuration` : Durée totale de l'opération (en minutes)
- `PauseDuration` : Durée totale des pauses (en minutes)
- `ProductiveDuration` : Durée productive = temps réellement travaillé (en minutes)

### Exemples

- Si `TotalDuration = 120` minutes et `PauseDuration = 15` minutes, alors `ProductiveDuration = 105` minutes
- Si `TotalDuration = 60` minutes et `PauseDuration = 0` minutes, alors `ProductiveDuration = 60` minutes
- Si `TotalDuration = 30` minutes et `PauseDuration = 30` minutes, alors `ProductiveDuration = 0` minutes

## Validation SILOG

**IMPORTANT : SILOG n'accepte pas les enregistrements avec `ProductiveDuration = 0`.**

### Règles de validation

1. **Avant le transfert** : Les enregistrements avec `ProductiveDuration <= 0` sont automatiquement exclus du transfert
2. **Validation dans `OperationValidationService.validateTransferData`** : Vérifie que `ProductiveDuration > 0`
3. **Filtre dans `MonitoringService.validateAndTransmitBatch`** : Exclut automatiquement les enregistrements avec `ProductiveDuration = 0`

### Cas particuliers

#### Opérations en cours (non terminées)

Les opérations qui viennent de démarrer (`/start`) ont initialement `ProductiveDuration = 0` car :
- `TotalDuration = 0`
- `PauseDuration = 0`
- `ProductiveDuration = 0 - 0 = 0`

Ces enregistrements ne doivent **PAS** être transférés tant que l'opération n'est pas terminée et que `ProductiveDuration` n'est pas calculé.

#### Opérations terminées avec ProductiveDuration = 0

Si une opération est terminée mais `ProductiveDuration = 0`, cela peut indiquer :
- Une opération très courte (moins d'une minute)
- Un problème de calcul des durées
- Une opération où le temps de pause égale le temps total

Dans ce cas, l'enregistrement sera :
- ✅ Consolidé dans `ABTEMPS_OPERATEURS` (avec un avertissement)
- ❌ Exclu du transfert vers SILOG (car `ProductiveDuration = 0`)

## Code de référence

### Calcul des durées

**Fichier** : `backend/services/DurationCalculationService.js`

```javascript
// ProductiveDuration = TotalDuration - PauseDuration (en minutes)
// IMPORTANT: ProductiveDuration doit être > 0 pour être accepté par SILOG
const productiveDuration = Math.max(0, totalDuration - pauseDuration);
```

### Validation avant transfert

**Fichier** : `backend/services/OperationValidationService.js`

```javascript
// IMPORTANT: SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0
if (productiveDuration <= 0) {
    errors.push(`ProductiveDuration doit être > 0 pour être accepté par SILOG. Valeur actuelle: ${productiveDuration} minutes`);
}
```

### Filtre dans le transfert

**Fichier** : `backend/services/MonitoringService.js`

```javascript
// IMPORTANT: SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0
if (productiveDuration <= 0) {
    invalidIds.push({
        tempsId,
        errors: [`ProductiveDuration doit être > 0 pour être accepté par SILOG. Valeur actuelle: ${productiveDuration} minutes`]
    });
    continue;
}
```

## Base de données

Dans `ABTEMPS_OPERATEURS`, la colonne `ProductiveDuration` est de type `INT` et stocke les minutes.

```sql
ProductiveDuration INT NOT NULL, -- en minutes
```

## Conversion en heures (pour affichage)

Pour convertir `ProductiveDuration` en heures pour l'affichage :

```javascript
const hours = ProductiveDuration / 60.0;
const minutes = ProductiveDuration % 60;
console.log(`${hours}h${minutes}min`);
```

Ou en SQL :

```sql
SELECT 
    ProductiveDuration AS ProductiveDurationMinutes,
    CAST(ProductiveDuration AS FLOAT) / 60.0 AS ProductiveDurationHours
FROM ABTEMPS_OPERATEURS
```
