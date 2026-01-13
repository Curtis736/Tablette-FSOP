# État d'avancement du projet FSOP

## Date de vérification : 2026-01-07

Ce document fait le point sur ce qui a été fait et ce qui reste à faire selon les spécifications du projet.

---

## 1. Structure de base de données

### 1.1. Table `ABSESSIONS_OPERATEURS`

**Spécification** : Pas d'interaction avec l'ERP SILOG

**État** : ✅ **CONFORME**
- Table créée et fonctionnelle
- Gestion des sessions de connexion des opérateurs
- Pas d'interaction avec SILOG (conforme aux spécifications)

---

### 1.2. Table `ABTEMPS_OPERATEURS`

**Spécification** : Table de synthèse des temps par opérateur. Certaines données seront déversées quotidiennement, après validation, dans les tables d'alimentation des macro-commandes de la base de données de l'ERP SILOG (SEDI_ERP).

**Colonnes manquantes identifiées** :

#### ✅ **FAIT** : Colonne `Phase` (varchar(30))
- **Fichier** : `backend/sql/migration_extend_temps.sql` (lignes 141-155)
- **Statut** : Colonne ajoutée avec succès
- **Note** : Donnée présente dans `ABHISTORIQUE_OPERATEURS`, maintenant reprise dans `ABTEMPS_OPERATEURS`

#### ✅ **FAIT** : Colonne `CodeRubrique` (varchar(30))
- **Fichier** : `backend/sql/migration_extend_temps.sql` (lignes 157-171)
- **Statut** : Colonne ajoutée avec succès
- **Note** : Donnée présente dans `ABHISTORIQUE_OPERATEURS`, maintenant reprise dans `ABTEMPS_OPERATEURS`

#### ✅ **FAIT** : Colonne `StatutTraitement` (varchar(1))
- **Fichier** : `backend/sql/migration_extend_temps.sql` (lignes 173-216)
- **Statut** : Colonne ajoutée avec contrainte CHECK
- **Valeurs** :
  - `NULL` = non traitée
  - `O` = Validé
  - `A` = Mis en Attente
  - `T` = Transmis à l'ERP
- **Index créé** : `IX_Temps_StatutTraitement` pour améliorer les performances

**État global** : ✅ **FAIT** (3/3 colonnes requises)

---

### 1.3. Table `AB_COMMENTAIRES_OPERATEURS`

**Spécification** : Table des déclarations de défauts (PNC). Les données serviront à alimenter la liste des PNC en attente de génération dans l'ERP SILOG.

**Colonnes manquantes identifiées** :

#### ✅ **FAIT** : Colonne `QteNonConforme` (numeric(19,8))
- **Fichier** : `backend/sql/migration_extend_comments.sql` (lignes 13-27)
- **Statut** : Colonne ajoutée avec succès
- **Description** : Quantité de pièces non conforme

#### ✅ **FAIT** : Colonne `Statut` (varchar(1))
- **Fichier** : `backend/sql/migration_extend_comments.sql` (lignes 29-53)
- **Statut** : Colonne ajoutée avec contrainte CHECK
- **Valeurs** :
  - `NULL` = non traitée
  - `V` = Validée par l'AQ
  - `I` = Intégré en tant que non-conformité dans SILOG
- **Index créé** : `IX_AB_COMMENTAIRES_OPERATEURS_Statut`

**État global** : ✅ **FAIT** (2/2 colonnes)

**Intégration code** :
- ✅ Modèle `Comment.js` mis à jour pour supporter `QteNonConforme` et `Statut`
- ✅ Routes `comments.js` avec validation des nouveaux champs
- ✅ API REST fonctionnelle

---

## 2. Lecture des données SILOG

**Spécification** : Action réalisée à l'aide de vues SQL enregistrées dans la base `SEDI_APP_INDEPENDANTE`.

### 2.1. Vue `V_RESSOURC` (Liste des opérateurs)

**Fichier** : `backend/sql/migration_create_silog_views.sql` et `backend/sql/migration_create_operator_mapping.sql`

**État** : ✅ **FAIT**

**Colonnes** :
- ✅ `CodeOperateur` : Depuis `CodeRessource` de `SEDI_ERP.dbo.RESSOURC`
- ✅ `NomOperateur` : Depuis `Designation1` de `SEDI_ERP.dbo.RESSOURC`
- ⚠️ `StatutOperateur` : **À implémenter dans SILOG par Franck MAILLARD**
  - Actuellement : Table de mapping `AB_OPERATEURS_MAPPING` créée pour stocker temporairement cette valeur
  - La vue utilise cette table de mapping en attendant l'implémentation dans SILOG
- ⚠️ `DateConsultation` : **À implémenter dans SILOG par Franck MAILLARD**
  - Actuellement : Table de mapping `AB_OPERATEURS_MAPPING` créée pour stocker temporairement cette valeur
  - La vue utilise cette table de mapping en attendant l'implémentation dans SILOG

**Note** : Des tables de mapping ont été créées pour permettre le fonctionnement de l'application en attendant l'implémentation dans SILOG.

---

### 2.2. Vue `V_LCTC` (Liste des lancements en cours)

**Fichier** : `backend/sql/migration_create_silog_views.sql` et `backend/sql/migration_create_lancement_mapping.sql`

**État** : ✅ **FAIT**

**Colonnes** :
- ✅ `CodeLancement` : Depuis `SEDI_ERP.dbo.LCTE`
- ✅ `Phase` : Depuis `SEDI_ERP.dbo.LCTC`
- ✅ `CodeRubrique` : Depuis `SEDI_ERP.dbo.LCTC`
- ✅ `CodeArticle`, `DesignationLct1`, `CodeModele`, `DesignationArt1`, `DesignationArt2` : Ajoutés dans `migration_update_v_lctc_add_designations.sql`
- ⚠️ `DateConsultation` : **À implémenter dans SILOG par Franck MAILLARD**
  - Actuellement : Table de mapping `AB_LANCEMENTS_MAPPING` créée pour stocker temporairement cette valeur
  - La vue utilise cette table de mapping en attendant l'implémentation dans SILOG

**Requête de base** :
```sql
SELECT E.CodeLancement, Phase, CodeRubrique, ? AS [DateConsultation]
FROM SEDI_ERP.dbo.LCTC C
JOIN SEDI_ERP.dbo.LCTE E ON C.CodeLancement = E.CodeLancement
AND E.LancementSolde = 'N'
```

**Note** : Des tables de mapping ont été créées pour permettre le fonctionnement de l'application en attendant l'implémentation dans SILOG.

---

## 3. Synthèse des temps par opérateur

**Spécification** : La synthèse des temps par opérateur à déverser dans SILOG ne semble pas encore faite (table vide).

**État** : ⚠️ **PARTIELLEMENT FAIT**

**Ce qui est fait** :
- ✅ Table `ABTEMPS_OPERATEURS` créée avec toutes les colonnes nécessaires
- ✅ Service `MonitoringService.js` créé pour gérer les enregistrements
- ✅ Routes API pour la consultation, correction, suppression, validation
- ✅ Interface admin pour le monitoring (`AdminPage.js`)

**Ce qui manque** :
- ❓ **Vérification nécessaire** : La table est-elle réellement vide ou contient-elle des données ?
- ⚠️ **Logique de déversement quotidien** : Pas de script automatique identifié pour le déversement quotidien vers SILOG
  - Le workflow de validation/transmission existe (`StatutTraitement = 'T'`)
  - Mais pas de processus automatique quotidien identifié

**Note** : Cette partie est liée à la fonctionnalité "Monitoring" développée dans l'ERP et non encore entièrement implémentée dans l'applicatif WEB.

---

## 4. Fonctionnalité "Monitoring"

**Spécification** : Cette fonctionnalité doit intégrer la correction et la suppression des enregistrements avant validation. Seuls les enregistrements validés doivent être transmis à SILOG.

**État** : ✅ **FAIT**

**Fichiers** :
- ✅ `backend/services/MonitoringService.js` : Service complet avec toutes les fonctionnalités
- ✅ `backend/routes/admin.js` : Routes API pour le monitoring (lignes 3060-3311)
- ✅ `frontend/components/AdminPage.js` : Interface utilisateur pour le monitoring

**Fonctionnalités implémentées** :
- ✅ **Consultation** : `GET /api/admin/monitoring` - Récupérer tous les enregistrements avec filtres
- ✅ **Correction** : `PUT /api/admin/monitoring/:tempsId` - Corriger un enregistrement (Phase, CodeRubrique, StartTime, EndTime, durées)
- ✅ **Suppression** : `DELETE /api/admin/monitoring/:tempsId` - Supprimer un enregistrement (si non transmis)
- ✅ **Validation** : `POST /api/admin/monitoring/:tempsId/validate` - Valider un enregistrement (`StatutTraitement = 'O'`)
- ✅ **Mise en attente** : `POST /api/admin/monitoring/:tempsId/on-hold` - Mettre en attente (`StatutTraitement = 'A'`)
- ✅ **Transmission** : `POST /api/admin/monitoring/:tempsId/transmit` - Marquer comme transmis (`StatutTraitement = 'T'`)
- ✅ **Validation/Transmission par lot** : `POST /api/admin/monitoring/validate-and-transmit-batch` - Traiter plusieurs enregistrements

**Règles métier implémentées** :
- ✅ Impossible de corriger/supprimer un enregistrement déjà transmis (`StatutTraitement = 'T'`)
- ✅ Seuls les enregistrements validés (`StatutTraitement = 'O'`) peuvent être transmis
- ✅ Correction réinitialise le statut pour permettre une nouvelle validation

**État global** : ✅ **COMPLET**

---

## 5. EDI_JOB - Transmission vers SILOG

**Spécification** : 
- Créer l'EDI_JOB dans SILOG qui exécutera la remontée des temps de production dans les tables standard de la base de données SILOG (Franck MAILLARD)
- Implémenter dans l'applicatif Web l'action de déclenchement de l'EDI_JOB via une instruction EXEC

**Format attendu** :
```
EXEC Chemin ERP Silog\SILOG.exe -bProfil -uUSER -pMotDePasseUtilisateurERP -dfr_fr -eEDI_JOB -optcodetache=CodeTache -mCOMPACT
```

**État** : ✅ **FAIT (côté applicatif WEB)**

**Fichiers** :
- ✅ `backend/services/EdiJobService.js` : Service complet pour l'exécution de l'EDI_JOB
- ✅ `backend/routes/admin.js` : Routes API pour l'EDI_JOB (lignes 3313-3361)

**Fonctionnalités implémentées** :
- ✅ **Exécution EDI_JOB** : `POST /api/admin/edi-job/execute` - Déclencher l'EDI_JOB avec un codeTache
- ✅ **Vérification configuration** : `GET /api/admin/edi-job/config` - Vérifier la configuration
- ✅ **Exécution automatique** : Intégré dans le workflow de transmission (`POST /api/admin/monitoring/:tempsId/transmit` avec `triggerEdiJob = true`)

**Configuration** :
- Variables d'environnement supportées :
  - `SILOG_PATH` : Chemin vers SILOG.exe (défaut: `C:\SILOG\SILOG.exe`)
  - `SILOG_PROFIL` : Profil (défaut: `Profil`)
  - `SILOG_USER` : Utilisateur (défaut: `USER`)
  - `SILOG_PASSWORD` : Mot de passe
  - `SILOG_LANGUE` : Langue (défaut: `fr_fr`)

**État global** : ⚠️ **PARTIELLEMENT FAIT**
- ✅ Côté applicatif WEB : **COMPLET**
- ❌ Côté SILOG : **À faire par Franck MAILLARD** (création de l'EDI_JOB dans SILOG)

---

## 6. Suite du projet

### 6.1. Finir la programmation de l'applicatif WEB

**État** : ⚠️ **EN COURS**

**À faire** :
- ⚠️ Vérifier et compléter la logique de déversement quotidien vers SILOG
- ⚠️ Tester l'intégration complète avec SILOG (une fois l'EDI_JOB créé)

---

### 6.2. Faire quelques saisies en double sur les deux systèmes

**État** : ❌ **NON FAIT**

**Action requise** : À faire pour valider l'applicatif WEB avec des données réelles.

---

### 6.3. Créer l'EDI_JOB dans SILOG

**État** : ❌ **NON FAIT**

**Responsable** : Franck MAILLARD

**Action requise** : Créer l'EDI_JOB dans SILOG qui exécutera la remontée des temps de production dans les tables standard de la base de données SILOG.

---

### 6.4. Implémenter dans SILOG les colonnes manquantes

**État** : ❌ **NON FAIT**

**Responsable** : Franck MAILLARD

**Colonnes à implémenter** :
- `StatutOperateur` dans la table/vue des opérateurs
- `DateConsultation` dans la table/vue des opérateurs
- `DateConsultation` dans la table/vue des lancements

**Note** : Des tables de mapping temporaires ont été créées dans `SEDI_APP_INDEPENDANTE` pour permettre le fonctionnement de l'application en attendant l'implémentation dans SILOG.

---

## Résumé global

### ✅ Ce qui est fait

1. **Structure de base de données** :
   - ✅ `ABSESSIONS_OPERATEURS` : Conforme
   - ✅ `AB_COMMENTAIRES_OPERATEURS` : Toutes les colonnes ajoutées (`QteNonConforme`, `Statut`)
   - ✅ `ABTEMPS_OPERATEURS` : Toutes les colonnes requises (`Phase`, `CodeRubrique`, `StatutTraitement`)

2. **Vues SQL pour SILOG** :
   - ✅ `V_RESSOURC` : Créée avec tables de mapping temporaires
   - ✅ `V_LCTC` : Créée avec table de mapping temporaire

3. **Fonctionnalité Monitoring** :
   - ✅ Correction, suppression, validation, transmission : **COMPLET**

4. **EDI_JOB (côté applicatif)** :
   - ✅ Service et routes API : **COMPLET**

### ❌ Ce qui reste à faire

1. **Implémentation dans SILOG** (Franck MAILLARD) :
   - ❌ Créer l'EDI_JOB dans SILOG
   - ❌ Implémenter `StatutOperateur` et `DateConsultation` dans les tables/vues SILOG

3. **Tests et validation** :
   - ⚠️ Guide de tests créé : `GUIDE_TESTS_SAISIE_DOUBLE.md`
   - ❌ Saisies en double sur les deux systèmes (à effectuer)
   - ❌ Vérification du déversement quotidien

4. **Documentation** :
   - ⚠️ Vérifier si un processus automatique quotidien existe pour le déversement

---

## Actions prioritaires

1. **IMPORTANT** : Vérifier la logique de déversement quotidien vers SILOG
2. **EN ATTENTE** : Implémentation dans SILOG par Franck MAILLARD
3. **VALIDATION** : Tests avec données réelles

---

## Contacts

- **Développement** : Curtis Robert KUMBI
- **ERP SILOG** : Franck MAILLARD
- **Gestion de projet** : Jean Marc SOREL
