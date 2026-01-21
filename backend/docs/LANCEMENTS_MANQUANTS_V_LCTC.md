# Lancements manquants dans V_LCTC

## Problème

Après la mise à jour de `V_LCTC` avec le filtre `TypeRubrique='O'`, certains lancements ne sont plus visibles dans la vue. Cela empêche la consolidation de certaines opérations.

## Cause

C'est **normal et attendu** selon les spécifications de Franck MAILLARD :

- `V_LCTC` filtre maintenant sur `TypeRubrique='O'` (seulement les temps, pas les composants)
- Si un lancement n'a pas de ligne avec `TypeRubrique='O'` dans `LCTC`, il ne sera pas dans `V_LCTC`
- Ces lancements sont probablement des **composants** qui ne doivent **pas** remonter dans l'ERP

## Vérification

Pour vérifier pourquoi un lancement n'est pas dans `V_LCTC`, exécuter le script SQL :
```sql
-- Voir backend/sql/check_lancements_missing_in_vlctc.sql
```

Le script vérifie :
1. Si le lancement existe dans `SEDI_ERP.dbo.LCTC`
2. Si le lancement a `TypeRubrique='O'`
3. Si le lancement a `LancementSolde='N'`
4. Tous les `TypeRubrique` possibles pour ce lancement

## Solutions possibles

### Cas 1 : Le lancement n'a pas `TypeRubrique='O'`
**Action** : C'est normal. Ces opérations ne doivent pas être consolidées car elles concernent des composants, pas des temps de production.

**Solution** : Aucune action requise. Ces opérations resteront dans `ABHISTORIQUE_OPERATEURS` mais ne seront pas consolidées.

### Cas 2 : Le lancement est soldé (`LancementSolde='O'`)
**Action** : Si le lancement est soldé, il ne peut pas être enregistré dans SILOG.

**Solution** : Vérifier si le lancement doit vraiment être soldé. Si oui, ces opérations ne peuvent pas être consolidées.

### Cas 3 : Le lancement n'existe pas dans `SEDI_ERP.dbo.LCTC`
**Action** : Le lancement n'existe pas dans l'ERP.

**Solution** : Vérifier si le lancement doit être créé dans l'ERP ou si c'est une erreur de saisie.

## Message d'erreur amélioré

Le message d'erreur actuel indique :
```
Lancement LT2400189 non trouvé dans V_LCTC. Phase et CodeRubrique sont requis (clés ERP).
```

Ce message est correct mais pourrait être amélioré pour indiquer que c'est normal si `TypeRubrique <> 'O'`.

## Exemple de diagnostic

Pour les lancements `LT2400189` et `LT2501139` :

1. Exécuter le script de diagnostic
2. Vérifier les résultats :
   - Si `TypeRubrique <> 'O'` : C'est normal, ne pas consolider
   - Si `LancementSolde <> 'N'` : Le lancement est soldé, ne pas consolider
   - Si le lancement n'existe pas : Vérifier si c'est une erreur

## Conclusion

Si un lancement n'est pas dans `V_LCTC` après la migration, c'est probablement **normal** car :
- Il s'agit d'un composant (`TypeRubrique <> 'O'`)
- Le lancement est soldé
- Le lancement n'existe pas dans l'ERP

Ces opérations ne doivent **pas** être consolidées selon les spécifications de Franck MAILLARD.
