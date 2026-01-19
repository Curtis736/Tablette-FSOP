# Documentation des Migrations SQL

Ce document décrit toutes les migrations SQL appliquées à la base de données `SEDI_APP_INDEPENDANTE`.

## Vue d'ensemble

Les migrations suivent l'évolution du schéma de base de données pour supporter les nouvelles fonctionnalités de l'application, notamment :
- Statuts de traitement pour le workflow de validation/transmission
- Intégration avec l'ERP SILOG via des vues SQL

## Migrations disponibles

### 1. Extension de AB_COMMENTAIRES_OPERATEURS
**Fichier**: `migration_extend_comments.sql`

**Date**: 2026-01-07

**Colonnes ajoutées**:
- `QteNonConforme` (numeric(19,8)) : Quantité de pièces non conforme
- `Statut` (varchar(1)) : Code statut de la ligne
  - NULL = non traitée
  - V = Validée par l'AQ
  - I = Intégré en tant que non-conformité dans SILOG

**Index créés**:
- `IX_AB_COMMENTAIRES_OPERATEURS_Statut` : Pour améliorer les requêtes de filtrage par statut
- `IX_AB_COMMENTAIRES_OPERATEURS_Lancement_Statut` : Pour améliorer les requêtes combinées

**Utilisation**:
Les données de cette table serviront à alimenter la liste des PNC (Pièces Non Conformes) en attente de génération dans l'ERP SILOG.

---

### 2. Extension de ABHISTORIQUE_OPERATEURS
**Fichier**: `migration_extend_historique.sql`

**Date**: 2026-01-07

**Note**: Cette migration contient les colonnes `SessionId`, `CreatedAt`, et `RequestId` pour la corrélation avec les sessions et la précision temporelle.

---

### 3. Extension de ABTEMPS_OPERATEURS
**Fichier**: `migration_extend_temps.sql`

**Date**: 2026-01-07 (extension)

**Colonnes ajoutées** (dans cette extension):
- `Phase` (varchar(30)) : Code de phase (déjà présent dans ABHISTORIQUE_OPERATEURS, indispensable pour SILOG)
- `CodeRubrique` (varchar(30)) : Code rubrique (déjà présent dans ABHISTORIQUE_OPERATEURS, indispensable pour SILOG)
- `StatutTraitement` (varchar(1)) : Statut de traitement pour le workflow de validation/transmission
  - NULL = non traitée
  - O = Validé
  - A = Mis en Attente
  - T = Transmis à l'ERP

**Index créés**:
- `IX_Temps_StatutTraitement` : Pour améliorer les requêtes de filtrage par StatutTraitement
- `IX_Temps_Phase_CodeRubrique` : Pour améliorer les requêtes incluant Phase et CodeRubrique

**Utilisation**:
Certaines données de cette table seront déversées quotidiennement, après validation, dans les tables d'alimentation des macro-commandes de la base de données de l'ERP SILOG (SEDI_ERP).

**Note**: Cette migration étend le fichier existant qui contenait déjà les colonnes `SessionId`, `CalculatedAt`, et `CalculationMethod`.

---

### 4. Création des vues SQL pour SILOG
**Fichier**: `migration_create_silog_views.sql`

**Date**: 2026-01-07

**Vues créées**:

#### 4.1 Vue V_RESSOURC
Liste des opérateurs depuis l'ERP SILOG.

**Colonnes**:
- `CodeOperateur` : Code de l'opérateur (depuis `CodeRessource`)
- `NomOperateur` : Nom de l'opérateur (depuis `Designation1`)
- `StatutOperateur` : Statut de l'opérateur (✅ Implémenté dans SILOG par Franck MAILLARD - Janvier 2026)
- `DateConsultation` : Date de consultation (✅ Implémenté dans SILOG par Franck MAILLARD - Janvier 2026, stocké en VarChar et converti en DateTime2)

**Source**: `[SEDI_ERP].[dbo].[RESSOURC]`

**Note**: Cette vue a été mise à jour pour utiliser directement les champs SILOG (voir migration 7).

#### 4.2 Vue V_LCTC
Liste des lancements en cours depuis l'ERP SILOG.

**Colonnes**:
- `CodeLancement` : Code du lancement
- `CodeArticle`, `DesignationLct1`, `CodeModele`, `DesignationArt1`, `DesignationArt2` : Informations sur l'article
- `Phase` : Code de phase
- `CodeRubrique` : Code rubrique
- `DateConsultation` : Date de consultation (✅ Implémenté dans SILOG par Franck MAILLARD - Janvier 2026, stocké en VarChar et converti en DateTime2)

**Source**: `[SEDI_ERP].[dbo].[LCTC]` JOIN `[SEDI_ERP].[dbo].[LCTE]` (où `LancementSolde = 'N'`)

**Note**: Cette vue a été mise à jour pour utiliser directement les champs SILOG (voir migration 7).

---

### 5. Mapping de DateConsultation pour les lancements (V_LCTC) - ⚠️ OBSOLÈTE
**Fichiers**:
- `migration_create_lancement_mapping.sql`
- `scripts_lancement_mapping.sql`
- `migration_update_v_lctc_add_designations.sql`

**Statut**: ⚠️ **OBSOLÈTE** - Les champs sont maintenant disponibles directement dans SILOG (voir migration 7).

**But** (historique): Stocker `DateConsultation` côté `SEDI_APP_INDEPENDANTE` (car la donnée n'existait pas dans SILOG).

**Objets créés** (maintenant obsolètes):
- Table: `dbo.AB_LANCEMENTS_MAPPING` (PK: `CodeLancement`) - ⚠️ Plus utilisée
- Vue mise à jour: `dbo.V_LCTC` (LEFT JOIN sur `AB_LANCEMENTS_MAPPING`) - ⚠️ Mise à jour dans migration 7
- Procédure: `sp_RecordLancementConsultation` (upsert DateConsultation) - ⚠️ Plus utilisée
  
**Champs affichage**:
- `CodeArticle`, `DesignationLct1`, `CodeModele`, `DesignationArt1`, `DesignationArt2` via `migration_update_v_lctc_add_designations.sql`

---

### 6. Mapping de StatutOperateur et DateConsultation pour les opérateurs (V_RESSOURC) - ⚠️ OBSOLÈTE
**Fichiers**:
- `migration_create_operator_mapping.sql`
- `scripts_operator_mapping.sql`

**Statut**: ⚠️ **OBSOLÈTE** - Les champs sont maintenant disponibles directement dans SILOG (voir migration 7).

**But** (historique): Stocker `StatutOperateur` et `DateConsultation` côté `SEDI_APP_INDEPENDANTE` (car les données n'existaient pas dans SILOG).

**Objets créés** (maintenant obsolètes):
- Table: `dbo.AB_OPERATEURS_MAPPING` (PK: `CodeOperateur`) - ⚠️ Plus utilisée
- Vue mise à jour: `dbo.V_RESSOURC` (LEFT JOIN sur `AB_OPERATEURS_MAPPING`) - ⚠️ Mise à jour dans migration 7
- Procédures: `sp_UpdateOperatorStatus`, `sp_UpdateOperatorConsultationDate`, `sp_RecordOperatorConsultation` - ⚠️ Plus utilisées

---

### 7. Mise à jour des vues SILOG pour utilisation directe des champs SILOG
**Fichier**: `migration_update_silog_views_from_silog.sql`

**Date**: 2026-01-XX

**Contexte**: Les champs `StatutOperateur` et `DateConsultation` ont été implémentés dans SILOG par Franck MAILLARD.

**Modifications**:

#### 7.1 Vue V_RESSOURC
- ✅ Utilise maintenant directement `StatutOperateur` depuis `SEDI_ERP.dbo.RESSOURC`
- ✅ Utilise maintenant directement `DateConsultation` depuis `SEDI_ERP.dbo.RESSOURC` (conversion VarChar → DateTime2)
- ❌ Suppression des liens vers `dbo.AB_OPERATEURS_MAPPING`

#### 7.2 Vue V_LCTC
- ✅ Utilise maintenant directement `DateConsultation` depuis SILOG (conversion VarChar → DateTime2)
- ❌ Suppression des liens vers `dbo.AB_LANCEMENTS_MAPPING`

**Points importants**:
- ⚠️ `DateConsultation` est stockée en **VarChar** dans SILOG et convertie en **DateTime2** dans la vue
- ⚠️ **ACTION REQUISE** : Vérifier les noms exacts des colonnes avec Franck MAILLARD avant d'exécuter la migration
- ⚠️ Les tables de mapping (`AB_OPERATEURS_MAPPING`, `AB_LANCEMENTS_MAPPING`) peuvent être supprimées si souhaité

**Voir aussi**: `MISE_A_JOUR_SILOG_2026.md` pour plus de détails.

---

## Ordre d'exécution recommandé

### Pour une nouvelle installation
1. **migration_extend_comments.sql** : Ajouter les colonnes pour la gestion des PNC
2. **migration_extend_historique.sql** : Colonnes SessionId, CreatedAt, RequestId
3. **migration_extend_temps.sql** : Ajouter Phase, CodeRubrique, StatutTraitement aux temps
4. **migration_create_silog_views.sql** : Créer les vues pour la lecture des données SILOG
5. **migration_update_v_lctc_add_designations.sql** : Ajouter les champs de désignation à V_LCTC
6. **migration_update_silog_views_from_silog.sql** : ⚠️ **IMPORTANT** - Mettre à jour les vues pour utiliser directement les champs SILOG

### Pour une mise à jour d'installation existante
Si vous avez déjà exécuté les migrations 1-6 avec les tables de mapping :
1. **migration_update_silog_views_from_silog.sql** : Mettre à jour les vues pour utiliser directement les champs SILOG
2. (Optionnel) Supprimer les tables de mapping obsolètes si souhaité

### Migrations obsolètes (ne plus exécuter)
- ~~migration_create_operator_mapping.sql~~ : Remplacé par migration 7
- ~~migration_create_lancement_mapping.sql~~ : Remplacé par migration 7

## Vérification post-migration

Après l'exécution des migrations, vérifier que :

1. ✅ Les colonnes ont été ajoutées correctement :
   ```sql
   SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
   FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME = 'AB_COMMENTAIRES_OPERATEURS'
   AND COLUMN_NAME IN ('QteNonConforme', 'Statut');
   ```

2. ✅ Les contraintes CHECK sont actives :
   ```sql
   SELECT name, definition
   FROM sys.check_constraints
   WHERE parent_object_id = OBJECT_ID('AB_COMMENTAIRES_OPERATEURS');
   ```

3. ✅ Les index ont été créés :
   ```sql
   SELECT name, type_desc
   FROM sys.indexes
   WHERE object_id = OBJECT_ID('ABTEMPS_OPERATEURS')
   AND name LIKE 'IX_Temps%';
   ```

4. ✅ Les vues sont accessibles :
   ```sql
   SELECT TOP 5 * FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC];
   SELECT TOP 5 * FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC];
   ```

## Workflow de validation/transmission

Le workflow de traitement des enregistrements de temps suit ces étapes :

1. **Création** : Enregistrement créé avec `StatutTraitement = NULL`
2. **Correction** (optionnelle) : Modification des données si nécessaire
3. **Validation** : `StatutTraitement = 'O'` (Validé)
4. **Mise en attente** (optionnelle) : `StatutTraitement = 'A'` (Mis en Attente)
5. **Transmission** : `StatutTraitement = 'T'` (Transmis à l'ERP)
6. **EDI_JOB** : Déclenchement automatique de l'EDI_JOB pour remonter les données vers SILOG

## Notes importantes

- ✅ Les colonnes `StatutOperateur` et `DateConsultation` sont maintenant implémentées dans SILOG (Janvier 2026)
- ⚠️ `DateConsultation` est stockée en **VarChar** dans SILOG et convertie en **DateTime2** dans les vues
- ⚠️ **IMPORTANT** : Vérifier les noms exacts des colonnes avec Franck MAILLARD avant d'exécuter la migration 7
- ⚠️ L'EDI_JOB doit être configuré avec les bons paramètres (chemin SILOG, profil, utilisateur, mot de passe)
- ⚠️ Les enregistrements avec `StatutTraitement = 'T'` ne peuvent plus être modifiés ou supprimés
- ⚠️ Les tables de mapping (`AB_OPERATEURS_MAPPING`, `AB_LANCEMENTS_MAPPING`) sont obsolètes et peuvent être supprimées

## Support

Pour toute question concernant les migrations, contacter :
- **Développement** : Curtis Robert KUMBI
- **ERP SILOG** : Franck MAILLARD
- **Gestion de projet** : Jean Marc SOREL
