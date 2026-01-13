# Guide de tests - Saisies en double sur les deux systèmes

## Objectif

Valider l'applicatif WEB avec des données réelles en effectuant des saisies en parallèle sur :
1. **L'applicatif WEB** (nouveau système)
2. **L'ERP SILOG** (système existant)

L'objectif est de comparer les résultats et s'assurer que les données sont cohérentes entre les deux systèmes.

---

## Prérequis

### 1. Accès aux systèmes
- ✅ Accès à l'applicatif WEB (interface opérateur)
- ✅ Accès à l'ERP SILOG (interface existante)
- ✅ Accès à la base de données `SEDI_APP_INDEPENDANTE` (pour vérification)
- ✅ Accès à la base de données `SEDI_ERP` (pour vérification)

### 2. Données de test
- ✅ Opérateur de test valide dans `SEDI_ERP.dbo.RESSOURC`
- ✅ Lancement de test valide dans `SEDI_ERP.dbo.LCTE` (avec `LancementSolde = 'N'`)
- ✅ Phase et CodeRubrique valides pour le lancement

### 3. Outils nécessaires
- Navigateur web (pour l'applicatif WEB)
- Accès à SILOG (pour l'ERP)
- Client SQL (SQL Server Management Studio ou équivalent) pour vérifier les données

---

## Scénarios de test

### Scénario 1 : Saisie complète d'un lancement (début → pause → reprise → fin)

#### Objectif
Valider le cycle complet d'une opération avec pauses.

#### Étapes

**1. Préparation**
- [ ] Noter les informations de référence :
  - Code opérateur : `_____________`
  - Code lancement : `_____________`
  - Phase : `_____________`
  - CodeRubrique : `_____________`
  - Heure de début prévue : `_____________`

**2. Saisie dans l'applicatif WEB**
- [ ] Se connecter à l'applicatif WEB
- [ ] Saisir le code opérateur
- [ ] Saisir le code lancement
- [ ] Cliquer sur "Démarrer"
- [ ] Noter l'heure de début enregistrée : `_____________`
- [ ] Attendre 5 minutes
- [ ] Cliquer sur "Pause"
- [ ] Noter l'heure de pause : `_____________`
- [ ] Attendre 2 minutes
- [ ] Cliquer sur "Reprendre"
- [ ] Noter l'heure de reprise : `_____________`
- [ ] Attendre 10 minutes
- [ ] Cliquer sur "Arrêter"
- [ ] Noter l'heure de fin : `_____________`

**3. Saisie dans SILOG (en parallèle)**
- [ ] Ouvrir SILOG
- [ ] Saisir les mêmes informations :
  - Code opérateur : `_____________`
  - Code lancement : `_____________`
  - Phase : `_____________`
  - CodeRubrique : `_____________`
- [ ] Enregistrer les mêmes heures :
  - Début : `_____________`
  - Pause : `_____________`
  - Reprise : `_____________`
  - Fin : `_____________`

**4. Vérification des données**

**4.1. Dans l'applicatif WEB (`SEDI_APP_INDEPENDANTE`)**

```sql
-- Vérifier les événements dans ABHISTORIQUE_OPERATEURS
SELECT 
    NoEnreg,
    OperatorCode,
    CodeLanctImprod,
    Ident,
    Phase,
    CodeRubrique,
    DateCreation,
    HeureDebut,
    HeureFin,
    Statut
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
WHERE OperatorCode = 'CODE_OPERATEUR'
  AND CodeLanctImprod = 'CODE_LANCEMENT'
  AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
ORDER BY DateCreation ASC;
```

**Résultats attendus** :
- [ ] 4 événements : DEBUT, PAUSE, REPRISE, FIN
- [ ] Phase et CodeRubrique présents
- [ ] Heures cohérentes avec les saisies

```sql
-- Vérifier la synthèse dans ABTEMPS_OPERATEURS
SELECT 
    TempsId,
    OperatorCode,
    LancementCode,
    StartTime,
    EndTime,
    TotalDuration,
    PauseDuration,
    ProductiveDuration,
    Phase,
    CodeRubrique,
    StatutTraitement,
    EventsCount
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
WHERE OperatorCode = 'CODE_OPERATEUR'
  AND LancementCode = 'CODE_LANCEMENT'
  AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE);
```

**Résultats attendus** :
- [ ] 1 enregistrement de synthèse
- [ ] `TotalDuration` = durée totale (début → fin)
- [ ] `PauseDuration` = durée de pause (pause → reprise)
- [ ] `ProductiveDuration` = `TotalDuration - PauseDuration`
- [ ] `Phase` et `CodeRubrique` présents
- [ ] `StatutTraitement` = NULL (non traité)

**4.2. Dans SILOG (`SEDI_ERP`)**

Vérifier les données dans les tables standard de SILOG (selon la structure existante) :
- [ ] Table des temps : `abetemps_temp` ou équivalent
- [ ] Table des pauses : `abetemps_Pause` ou équivalent

**Comparaison** :
- [ ] Durées totales identiques : `_____________` min (WEB) vs `_____________` min (SILOG)
- [ ] Durées de pause identiques : `_____________` min (WEB) vs `_____________` min (SILOG)
- [ ] Durées productives identiques : `_____________` min (WEB) vs `_____________` min (SILOG)

---

### Scénario 2 : Saisie avec commentaire (PNC)

#### Objectif
Valider la saisie de commentaires et leur intégration dans le workflow PNC.

#### Étapes

**1. Préparation**
- [ ] Utiliser le même opérateur et lancement que le scénario 1
- [ ] Préparer un commentaire de test : `_____________`
- [ ] Préparer une quantité non conforme : `_____________`

**2. Saisie dans l'applicatif WEB**
- [ ] Après avoir démarré un lancement, cliquer sur "Commentaire"
- [ ] Saisir le commentaire : `_____________`
- [ ] Saisir la quantité non conforme : `_____________`
- [ ] Cliquer sur "Enregistrer"
- [ ] Noter l'ID du commentaire : `_____________`

**3. Vérification dans la base de données**

```sql
-- Vérifier le commentaire dans AB_COMMENTAIRES_OPERATEURS
SELECT 
    Id,
    OperatorCode,
    OperatorName,
    LancementCode,
    Comment,
    QteNonConforme,
    Statut,
    Timestamp,
    CreatedAt
FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
WHERE OperatorCode = 'CODE_OPERATEUR'
  AND LancementCode = 'CODE_LANCEMENT'
  AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
ORDER BY CreatedAt DESC;
```

**Résultats attendus** :
- [ ] Commentaire enregistré avec le texte correct
- [ ] `QteNonConforme` = quantité saisie
- [ ] `Statut` = NULL (non traitée)

**4. Validation par l'AQ (si applicable)**
- [ ] Dans l'interface admin, valider le commentaire (`Statut = 'V'`)
- [ ] Vérifier que le statut est mis à jour

**5. Intégration dans SILOG (à faire après création de l'EDI_JOB)**
- [ ] Vérifier que le commentaire apparaît dans la liste des PNC en attente dans SILOG
- [ ] Comparer les données

---

### Scénario 3 : Monitoring - Correction et validation

#### Objectif
Valider le workflow de monitoring : correction, validation, transmission.

#### Étapes

**1. Préparation**
- [ ] Utiliser un enregistrement de temps existant (scénario 1)
- [ ] Noter le `TempsId` : `_____________`

**2. Consultation dans l'interface Monitoring**
- [ ] Se connecter en tant qu'admin
- [ ] Accéder à la page Monitoring
- [ ] Filtrer par opérateur/lancement
- [ ] Vérifier que l'enregistrement apparaît avec `StatutTraitement = NULL`

**3. Correction**
- [ ] Cliquer sur "Corriger" pour l'enregistrement
- [ ] Modifier la Phase : `_____________` → `_____________`
- [ ] Modifier le CodeRubrique : `_____________` → `_____________`
- [ ] Enregistrer la correction
- [ ] Vérifier que `StatutTraitement` est réinitialisé à NULL

**4. Validation**
- [ ] Cliquer sur "Valider"
- [ ] Vérifier que `StatutTraitement = 'O'`

**5. Transmission**
- [ ] Cliquer sur "Transmettre"
- [ ] Vérifier que `StatutTraitement = 'T'`
- [ ] Vérifier que l'enregistrement ne peut plus être modifié/supprimé

**6. Vérification dans la base de données**

```sql
-- Vérifier le statut de traitement
SELECT 
    TempsId,
    OperatorCode,
    LancementCode,
    Phase,
    CodeRubrique,
    StatutTraitement,
    DateCreation
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
WHERE TempsId = TEMPS_ID;
```

**Résultats attendus** :
- [ ] `StatutTraitement = 'T'`
- [ ] Phase et CodeRubrique corrigés

---

### Scénario 4 : Déversement quotidien vers SILOG

#### Objectif
Valider le processus de déversement quotidien des données validées vers SILOG.

#### Prérequis
- ⚠️ L'EDI_JOB doit être créé dans SILOG par Franck MAILLARD
- ⚠️ Les colonnes `StatutOperateur` et `DateConsultation` doivent être implémentées dans SILOG

#### Étapes

**1. Préparation**
- [ ] S'assurer qu'il y a plusieurs enregistrements avec `StatutTraitement = 'O'` (validés)
- [ ] Noter le nombre d'enregistrements à transmettre : `_____________`

**2. Transmission par lot**
- [ ] Dans l'interface Monitoring, sélectionner plusieurs enregistrements validés
- [ ] Cliquer sur "Valider et transmettre par lot"
- [ ] Vérifier que tous les enregistrements passent à `StatutTraitement = 'T'`

**3. Déclenchement de l'EDI_JOB**
- [ ] Dans l'interface admin, accéder à la section EDI_JOB
- [ ] Vérifier la configuration (chemin SILOG, profil, utilisateur)
- [ ] Déclencher l'EDI_JOB avec un codeTache : `_____________`
- [ ] Vérifier que l'exécution réussit

**4. Vérification dans SILOG**
- [ ] Vérifier dans les tables standard de SILOG que les données ont été importées
- [ ] Comparer les données :
  - Nombre d'enregistrements : `_____________` (WEB) vs `_____________` (SILOG)
  - Durées totales : `_____________` (WEB) vs `_____________` (SILOG)
  - Phases et CodeRubrique : Identiques ?

**5. Vérification dans la base de données**

```sql
-- Compter les enregistrements transmis aujourd'hui
SELECT 
    COUNT(*) AS NombreTransmis,
    SUM(TotalDuration) AS DureeTotale,
    SUM(ProductiveDuration) AS DureeProductive
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
WHERE StatutTraitement = 'T'
  AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE);
```

---

### Scénario 5 : Lecture des données SILOG (vues)

#### Objectif
Valider que les vues `V_RESSOURC` et `V_LCTC` fonctionnent correctement.

#### Étapes

**1. Test de la vue V_RESSOURC**

```sql
-- Tester la vue V_RESSOURC
SELECT TOP 10
    CodeOperateur,
    NomOperateur,
    StatutOperateur,
    DateConsultation
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC]
ORDER BY CodeOperateur;
```

**Résultats attendus** :
- [ ] La vue retourne des données
- [ ] `CodeOperateur` et `NomOperateur` sont remplis
- [ ] `StatutOperateur` et `DateConsultation` sont NULL (en attendant l'implémentation dans SILOG)

**2. Test de la vue V_LCTC**

```sql
-- Tester la vue V_LCTC
SELECT TOP 10
    CodeLancement,
    Phase,
    CodeRubrique,
    DateConsultation,
    DesignationLct1,
    CodeArticle
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
ORDER BY CodeLancement;
```

**Résultats attendus** :
- [ ] La vue retourne uniquement les lancements avec `LancementSolde = 'N'`
- [ ] `Phase` et `CodeRubrique` sont remplis
- [ ] `DateConsultation` est NULL ou utilise la table de mapping

**3. Vérification de l'utilisation dans l'applicatif WEB**
- [ ] Vérifier que l'applicatif WEB utilise ces vues pour récupérer les opérateurs et lancements
- [ ] Tester la sélection d'un opérateur depuis la vue
- [ ] Tester la sélection d'un lancement depuis la vue

---

## Checklist de validation globale

### Fonctionnalités de base
- [ ] Connexion opérateur fonctionne
- [ ] Démarrage d'un lancement fonctionne
- [ ] Pause/Reprise fonctionne
- [ ] Arrêt d'un lancement fonctionne
- [ ] Saisie de commentaires fonctionne

### Intégrité des données
- [ ] Les événements sont enregistrés dans `ABHISTORIQUE_OPERATEURS`
- [ ] Les temps sont consolidés dans `ABTEMPS_OPERATEURS`
- [ ] Les commentaires sont enregistrés dans `AB_COMMENTAIRES_OPERATEURS`
- [ ] Phase et CodeRubrique sont présents dans tous les enregistrements

### Workflow de validation
- [ ] Correction d'enregistrements fonctionne
- [ ] Validation d'enregistrements fonctionne
- [ ] Mise en attente fonctionne
- [ ] Transmission fonctionne
- [ ] Impossible de modifier/supprimer un enregistrement transmis

### Intégration SILOG
- [ ] Les vues `V_RESSOURC` et `V_LCTC` fonctionnent
- [ ] L'EDI_JOB peut être déclenché (une fois créé dans SILOG)
- [ ] Les données transmises apparaissent dans SILOG (après création de l'EDI_JOB)

### Comparaison avec SILOG
- [ ] Durées totales identiques entre WEB et SILOG
- [ ] Durées de pause identiques
- [ ] Durées productives identiques
- [ ] Phases et CodeRubrique identiques

---

## Problèmes identifiés et solutions

### Problème 1 : EDI_JOB non créé dans SILOG

**Symptôme** : Impossible de déclencher l'EDI_JOB car il n'existe pas dans SILOG

**Solution** : Franck MAILLARD doit créer l'EDI_JOB dans SILOG

**Statut** : ❌ En attente (Franck MAILLARD)

---

### Problème 2 : Colonnes manquantes dans SILOG

**Symptôme** : `StatutOperateur` et `DateConsultation` sont NULL dans les vues

**Solution** : Franck MAILLARD doit implémenter ces colonnes dans SILOG

**Statut** : ❌ En attente (Franck MAILLARD)

---

## Rapport de test

### Date du test : `_____________`
### Testeur : `_____________`

### Résultats par scénario

| Scénario | Statut | Remarques |
|----------|--------|-----------|
| Scénario 1 : Saisie complète | ⬜ Passé / ⬜ Échoué | |
| Scénario 2 : Commentaire PNC | ⬜ Passé / ⬜ Échoué | |
| Scénario 3 : Monitoring | ⬜ Passé / ⬜ Échoué | |
| Scénario 4 : Déversement | ⬜ Passé / ⬜ Échoué | |
| Scénario 5 : Vues SILOG | ⬜ Passé / ⬜ Échoué | |

### Problèmes rencontrés

1. `_____________`
2. `_____________`
3. `_____________`

### Recommandations

1. `_____________`
2. `_____________`
3. `_____________`

---

## Notes importantes

1. **Données de test** : Utiliser des données de test qui ne perturberont pas la production
2. **Sauvegarde** : Effectuer une sauvegarde avant les tests si possible
3. **Documentation** : Documenter tous les écarts entre WEB et SILOG
4. **Performance** : Noter les temps de réponse et les performances
5. **Erreurs** : Capturer les messages d'erreur et les logs

---

## Contacts

- **Développement** : Curtis Robert KUMBI
- **ERP SILOG** : Franck MAILLARD
- **Gestion de projet** : Jean Marc SOREL
