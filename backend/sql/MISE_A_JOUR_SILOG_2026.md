# Mise à jour des vues SILOG - Janvier 2026

## Contexte

Franck MAILLARD a implémenté les champs suivants dans les écrans SILOG :

### Gestion des Ressources
- ✅ **Statut Opérateur** : Implémenté dans les écrans SILOG
- ✅ **Date Consultation** : Implémenté dans les écrans SILOG

### Gestion des lancements
- ✅ **Date Consultation** : Implémenté dans les écrans SILOG

## Points importants

⚠️ **Important** : SILOG ne dispose pas de champ datetime en libre-service, donc la donnée **Date Consultation** est stockée dans un champ **VarChar** qui est converti en **DateTime2** dans les vues SQL.

## Modifications des vues SQL

Les vues SQL suivantes ont été modifiées par Franck MAILLARD dans la base `SEDI_APP_INDEPENDANTE` :

### 1. Vue `dbo.V_RESSOURC`
- ✅ Utilise maintenant directement les champs `StatutOperateur` et `DateConsultation` depuis `SEDI_ERP.dbo.RESSOURC`
- ❌ **Suppression** : Les liens vers la table `dbo.AB_OPERATEURS_MAPPING` ont été supprimés

### 2. Vue `dbo.V_LCTC`
- ✅ Utilise maintenant directement le champ `DateConsultation` depuis SILOG
- ❌ **Suppression** : Les liens vers la table `dbo.AB_LANCEMENTS_MAPPING` ont été supprimés

## Migration requise

Un fichier de migration a été créé pour mettre à jour les vues dans l'environnement de développement/test :

**Fichier** : `migration_update_silog_views_from_silog.sql`

### Actions à effectuer

1. **Vérifier les noms de colonnes** dans SILOG avec Franck MAILLARD :
   - Nom exact de la colonne `StatutOperateur` dans `RESSOURC`
   - Nom exact de la colonne `DateConsultation` dans `RESSOURC`
   - Nom exact de la colonne `DateConsultation` dans `LCTC` ou `LCTE` (vérifier dans quelle table elle se trouve)

2. **Ajuster la migration SQL** si nécessaire selon les noms de colonnes réels

3. **Exécuter la migration** dans l'environnement de test

4. **Tester** que les vues retournent correctement les données

## Tables de mapping (obsolètes)

Les tables suivantes ne sont plus utilisées et peuvent être supprimées si souhaité :

- `dbo.AB_OPERATEURS_MAPPING`
- `dbo.AB_LANCEMENTS_MAPPING`

Les procédures stockées associées peuvent également être supprimées :
- `sp_UpdateOperatorStatus`
- `sp_UpdateOperatorConsultationDate`
- `sp_RecordOperatorConsultation`
- `sp_RecordLancementConsultation`

⚠️ **Note** : Ces tables peuvent être conservées pour référence historique ou supprimées selon les besoins.

## Prochaines étapes

1. ✅ Migration SQL créée
2. ⏳ Vérifier les noms de colonnes avec Franck MAILLARD
3. ⏳ Ajuster la migration si nécessaire
4. ⏳ Exécuter la migration en test
5. ⏳ Valider le fonctionnement
6. ⏳ Attendre les premiers tests de saisies en production pour finaliser l'intégration des temps

## Contact

**Franck MAILLARD** : Pour confirmer les noms exacts des colonnes dans SILOG et pour la finalisation de l'intégration des temps de production.

---

**Date de création** : Janvier 2026  
**Dernière mise à jour** : Janvier 2026
