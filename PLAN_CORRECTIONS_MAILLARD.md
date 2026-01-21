# Plan de corrections selon les spécifications de Franck Maillard

## Objectif
Appliquer les corrections demandées par Franck Maillard pour les vues V_LCTC et V_RESSOURC, et corriger la logique de remontée des temps.

## Modifications à effectuer

### 1. Modifier la vue V_LCTC

**Fichier**: `backend/sql/migration_fix_v_lctc_database.sql`

**Changements**:
- Utiliser `SEDI_ERP` au lieu de `SEDI_2025` (SEDI_2025 est une archive figée)
- Ajouter JOIN avec `LCTE` pour récupérer `DateConsultation`
- Ajouter filtre `WHERE TypeRubrique='O'` (obligatoire pour exclure les composants)
- Ajouter filtre `LancementSolde='N'` dans le JOIN (déjà présent mais à vérifier)
- Récupérer `DateConsultation` depuis `LCTE.VarAlphaUtil5` avec conversion en DATETIME2

**Nouvelle définition**:
```sql
CREATE VIEW [dbo].[V_LCTC]
AS
SELECT 
    LCTC.CodeLancement,
    Phase,
    CodeRubrique,
    CAST(iif(LCTE.VARAlphaUtil5='',NULL,LCTE.VARAlphaUtil5) AS DATETIME2) AS DateConsultation
FROM [SEDI_ERP].[dbo].[LCTC]
JOIN [SEDI_ERP].[dbo].[LCTE] on LCTE.CodeLancement=LCTC.CodeLancement
WHERE LancementSolde='N'
  AND TypeRubrique='O'
```

### 2. Modifier la vue V_RESSOURC

**Fichier**: `backend/sql/migration_update_silog_views_from_silog.sql` ou créer nouveau fichier

**Changements**:
- Utiliser `TableAlphaUtil` pour `StatutOperateur` (converti en VARCHAR(50))
- Utiliser `TableAlphaUtil2` pour `DateConsultation` (converti en DATETIME2 avec gestion des valeurs vides)

**Nouvelle définition**:
```sql
CREATE VIEW [dbo].[V_RESSOURC]
AS
SELECT 
    r.CodeRessource AS CodeOperateur,
    r.Designation1 AS NomOperateur,
    CAST(r.TableAlphaUtil AS VARCHAR(50)) AS StatutOperateur,
    CAST(iif(r.TableAlphaUtil2='',NULL,r.TableAlphaUtil2) AS DATETIME2) AS DateConsultation
FROM [SEDI_ERP].[dbo].[RESSOURC] r;
```

### 3. Corriger la logique de remontée des temps

**Fichiers à modifier**:
- `backend/services/MonitoringService.js` : Méthode `validateAndTransmitBatch`
- `backend/routes/admin.js` : Route de transfert si elle existe

**Changements**:
- Filtrer uniquement sur `StatutTraitement IS NULL` (pas `IS NULL OR != 'T'`)
- S'assurer que seuls les enregistrements avec `StatutTraitement = NULL` sont transmis

**Code actuel** (ligne 698-701 de MonitoringService.js):
```javascript
if (record.StatutTraitement === 'T') {
    console.log(`ℹ️ Enregistrement ${tempsId} déjà transmis, sera ignoré`);
    continue;
}
```

**Code à modifier**:
```javascript
// Ne prendre que les enregistrements avec StatutTraitement = NULL
if (record.StatutTraitement !== null && record.StatutTraitement !== undefined) {
    console.log(`ℹ️ Enregistrement ${tempsId} déjà traité (StatutTraitement=${record.StatutTraitement}), sera ignoré`);
    continue;
}
```

### 4. Vérifier l'utilisation de V_LCTC dans le code

**Fichiers à vérifier**:
- `backend/services/ConsolidationService.js` : Requête V_LCTC (ligne 136)
- `backend/routes/operations.js` : Requêtes V_LCTC (lignes 225, 730)

**Action**: Vérifier que ces requêtes fonctionnent toujours avec la nouvelle définition de V_LCTC (avec TypeRubrique='O')

### 5. Créer un script de migration SQL

**Fichier**: `backend/sql/migration_apply_maillard_specifications.sql`

**Contenu**:
- Supprimer et recréer V_LCTC selon les spécifications exactes
- Supprimer et recréer V_RESSOURC selon les spécifications exactes
- Vérifications après migration

### 6. Mettre à jour la documentation

**Fichier**: `backend/docs/` ou `REPONSE_MAILLARD_20_01_2026.md`

**Action**: Documenter les changements appliqués

## Ordre d'exécution

1. Créer le script SQL de migration (`migration_apply_maillard_specifications.sql`)
2. Modifier le code Node.js pour filtrer sur `StatutTraitement = NULL`
3. Tester les modifications
4. Mettre à jour la documentation
5. Créer un commit avec les changements

## Points d'attention

- **TypeRubrique='O'** : Obligatoire dans V_LCTC pour exclure les composants (exemple: C1ST126OPT02)
- **LancementSolde='N'** : Obligatoire pour exclure les lancements soldés
- **StatutTraitement = NULL** : Seuls les enregistrements non traités doivent être transmis
- **SEDI_ERP vs SEDI_2025** : SEDI_2025 est une archive figée, utiliser SEDI_ERP pour le travail quotidien
