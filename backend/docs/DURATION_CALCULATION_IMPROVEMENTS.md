# Améliorations du calcul des durées - 20 janvier 2026

## Résumé des améliorations

Toutes les améliorations concernant le calcul et la validation des durées ont été implémentées pour répondre aux remarques de Franck MAILLARD.

---

## ✅ 1. Vérification ProductiveDuration > 0 lors de la consolidation

**Fichier** : `backend/services/ConsolidationService.js`

### Amélioration :
- Ajout d'une vérification avant insertion dans `ABTEMPS_OPERATEURS`
- Avertissement si `ProductiveDuration = 0` (SILOG n'accepte pas les temps à 0)
- Ne bloque pas la consolidation, mais log un avertissement pour l'admin

### Code :
```javascript
// 7. Vérifier que ProductiveDuration > 0 (SILOG n'accepte pas les temps à 0)
if (durations.productiveDuration <= 0) {
    console.warn(`⚠️ ProductiveDuration = ${durations.productiveDuration} (Total=${durations.totalDuration}, Pause=${durations.pauseDuration})`);
    console.warn(`⚠️ SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0`);
}
```

---

## ✅ 2. Recalcul automatique de ProductiveDuration lors de la correction manuelle

**Fichier** : `backend/services/MonitoringService.js`

### Amélioration :
- Si `TotalDuration` ou `PauseDuration` sont modifiés manuellement, `ProductiveDuration` est automatiquement recalculé
- Formule : `ProductiveDuration = TotalDuration - PauseDuration`
- Garantit la cohérence des durées

### Comportement :
- Si `TotalDuration` est modifié → Recalcule `ProductiveDuration`
- Si `PauseDuration` est modifié → Recalcule `ProductiveDuration`
- Si les deux sont modifiés → Recalcule `ProductiveDuration` avec les nouvelles valeurs
- Si seul `ProductiveDuration` est modifié → Utilise la valeur fournie (mais vérifie la cohérence)

### Code :
```javascript
// IMPORTANT: Si TotalDuration ou PauseDuration sont modifiés, recalculer ProductiveDuration automatiquement
let shouldRecalculateProductive = false;

if (corrections.TotalDuration !== undefined) {
    updateFields.push('TotalDuration = @totalDuration');
    updateParams.totalDuration = parseInt(corrections.TotalDuration);
    shouldRecalculateProductive = true;
}

if (corrections.PauseDuration !== undefined) {
    updateFields.push('PauseDuration = @pauseDuration');
    updateParams.pauseDuration = parseInt(corrections.PauseDuration);
    shouldRecalculateProductive = true;
}

if (shouldRecalculateProductive) {
    // Recalculer ProductiveDuration = TotalDuration - PauseDuration
    const calculatedProductive = Math.max(0, totalDuration - pauseDuration);
    updateFields.push('ProductiveDuration = @productiveDuration');
    updateParams.productiveDuration = calculatedProductive;
}
```

---

## ✅ 3. Amélioration de l'auto-correction des durées

**Fichier** : `backend/services/OperationValidationService.js`

### Améliorations :
1. **Recalcul de ProductiveDuration** si incohérent avec `TotalDuration - PauseDuration`
2. **Correction des durées négatives** avec recalcul automatique de `ProductiveDuration`
3. **Vérification finale** : Avertit si `ProductiveDuration = 0` après correction

### Code :
```javascript
// Corriger les durées incohérentes
const calculatedProductive = Math.max(0, totalDuration - pauseDuration);

if (Math.abs(productiveDuration - calculatedProductive) > 1) {
    // Recalculer ProductiveDuration
    await executeNonQuery(updateQuery, {
        tempsId,
        productiveDuration: calculatedProductive
    });
    fixes.push(`ProductiveDuration corrigé: ${productiveDuration} → ${calculatedProductive}`);
}

// Vérifier que ProductiveDuration > 0 après correction
if (finalRecord[0].ProductiveDuration <= 0) {
    fixes.push(`⚠️ ATTENTION: ProductiveDuration = ${finalRecord[0].ProductiveDuration} après correction. SILOG n'accepte pas les temps à 0.`);
}
```

---

## ✅ 4. Vérification lors du recalcul des durées

**Fichier** : `backend/services/ConsolidationService.js` - méthode `recalculateDurations`

### Amélioration :
- Avertissement si `ProductiveDuration = 0` après recalcul
- Retourne un warning dans le résultat pour informer l'admin

### Code :
```javascript
// Vérifier que ProductiveDuration > 0 (SILOG n'accepte pas les temps à 0)
if (durations.productiveDuration <= 0) {
    console.warn(`⚠️ ProductiveDuration = ${durations.productiveDuration} après recalcul`);
    console.warn(`⚠️ SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0`);
}

return {
    success: true,
    error: null,
    durations,
    warnings: durations.productiveDuration <= 0 
        ? ['ProductiveDuration = 0 après recalcul. SILOG n\'accepte pas les temps à 0.'] 
        : []
};
```

---

## ✅ 5. Vérification lors de l'arrêt d'une opération

**Fichier** : `backend/routes/operations.js` - route `/stop`

### Amélioration :
- Avertissement si `ProductiveDuration = 0` après calcul des durées finales
- Informe que l'enregistrement ne pourra pas être transféré vers SILOG

### Code :
```javascript
// Vérifier que ProductiveDuration > 0 (SILOG n'accepte pas les temps à 0)
if (durations.productiveDuration <= 0) {
    console.warn(`⚠️ ProductiveDuration = ${durations.productiveDuration}`);
    console.warn(`⚠️ SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0`);
    console.warn(`⚠️ Cet enregistrement ne pourra pas être transféré vers SILOG tant que ProductiveDuration n'est pas > 0`);
}
```

---

## 📋 Résumé des protections

| Point de contrôle | Fichier | Action |
|-------------------|---------|--------|
| Consolidation | `ConsolidationService.js` | Avertissement si ProductiveDuration = 0 |
| Correction manuelle | `MonitoringService.js` | Recalcul automatique de ProductiveDuration |
| Auto-correction | `OperationValidationService.js` | Recalcul + vérification finale |
| Recalcul | `ConsolidationService.js` | Avertissement + warning dans résultat |
| Arrêt opération | `routes/operations.js` | Avertissement si ProductiveDuration = 0 |
| Transfert | `OperationValidationService.js` | Bloque si ProductiveDuration <= 0 |
| Transfert batch | `MonitoringService.js` | Exclut si ProductiveDuration <= 0 |

---

## 🎯 Garanties

1. ✅ **Cohérence** : `ProductiveDuration` est toujours égal à `TotalDuration - PauseDuration` (sauf modification manuelle explicite)
2. ✅ **Validation** : Les enregistrements avec `ProductiveDuration = 0` ne peuvent pas être transférés vers SILOG
3. ✅ **Recalcul automatique** : Si `TotalDuration` ou `PauseDuration` sont modifiés, `ProductiveDuration` est recalculé
4. ✅ **Avertissements** : Tous les cas où `ProductiveDuration = 0` génèrent des avertissements pour l'admin
5. ✅ **Documentation** : Tous les calculs sont documentés avec l'unité (minutes)

---

## 📝 Notes importantes

- **Unité** : Toutes les durées sont en **minutes**
- **Formule** : `ProductiveDuration = TotalDuration - PauseDuration`
- **Validation SILOG** : `ProductiveDuration` doit être > 0 pour être accepté
- **Cohérence** : Le système garantit la cohérence des durées à chaque modification
