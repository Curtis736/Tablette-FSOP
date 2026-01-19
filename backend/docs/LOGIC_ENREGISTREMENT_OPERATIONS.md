# 📋 LOGIQUE D'ENREGISTREMENT DES OPÉRATIONS

## 🎯 Vue d'ensemble

Le système utilise **3 tables principales** pour enregistrer les opérations :

1. **`ABHISTORIQUE_OPERATEURS`** : Journal des événements bruts (traçabilité complète)
2. **`ABTEMPS_OPERATEURS`** : Enregistrements consolidés (pour validation/transfert admin)
3. **`ABSESSIONS_OPERATEURS`** : Sessions actives (état en temps réel)

---

## 📊 Table 1 : ABHISTORIQUE_OPERATEURS (Journal des événements)

### Rôle
**Journal d'audit complet** - Enregistre **chaque action** de l'opérateur comme un événement séparé.

### Structure clé
- **`NoEnreg`** : ID unique de l'événement (AUTO_INCREMENT)
- **`OperatorCode`** : Code de l'opérateur
- **`CodeLanctImprod`** : Code du lancement
- **`Ident`** : Type d'événement (`DEBUT`, `PAUSE`, `REPRISE`, `FIN`)
- **`HeureDebut`** : Heure de début (pour DEBUT)
- **`HeureFin`** : Heure de fin (pour FIN)
- **`DateCreation`** : Date de l'événement
- **`Statut`** : Statut de l'opération (`EN_COURS`, `EN_PAUSE`, `TERMINE`)

### Quand est-ce utilisé ?
**À chaque action de l'opérateur** :
- ✅ Opérateur clique "Démarrer" → Événement `DEBUT` créé
- ✅ Opérateur clique "Pause" → Événement `PAUSE` créé
- ✅ Opérateur clique "Reprendre" → Événement `REPRISE` créé
- ✅ Opérateur clique "Arrêter" → Événement `FIN` créé

### Exemple de données
```
NoEnreg | OperatorCode | CodeLanctImprod | Ident  | HeureDebut | HeureFin | DateCreation
--------|-------------|-----------------|--------|------------|----------|-------------
1001    | OP001       | LT2501136       | DEBUT  | 08:00      | NULL     | 2026-01-07
1002    | OP001       | LT2501136       | PAUSE  | NULL       | NULL     | 2026-01-07
1003    | OP001       | LT2501136       | REPRISE| NULL       | NULL     | 2026-01-07
1004    | OP001       | LT2501136       | FIN    | NULL       | 17:30    | 2026-01-07
```

---

## 📊 Table 2 : ABTEMPS_OPERATEURS (Enregistrements consolidés)

### Rôle
**Enregistrements consolidés** - Une **seule ligne par opération terminée** avec les durées calculées.

### Structure clé
- **`TempsId`** : ID unique de l'enregistrement consolidé (AUTO_INCREMENT)
- **`OperatorCode`** : Code de l'opérateur
- **`LancementCode`** : Code du lancement
- **`StartTime`** : Heure de début (depuis événement DEBUT)
- **`EndTime`** : Heure de fin (depuis événement FIN)
- **`TotalDuration`** : Durée totale en minutes
- **`PauseDuration`** : Durée des pauses en minutes
- **`ProductiveDuration`** : Durée productive (Total - Pause)
- **`EventsCount`** : Nombre d'événements dans ABHISTORIQUE
- **`StatutTraitement`** : Statut de traitement (`NULL` = non traité, `O` = validé, `T` = transmis)

### Quand est-ce créé ?
**Uniquement quand une opération est TERMINÉE** (événement FIN) :
- ✅ Automatiquement lors de l'événement `FIN` (via `consolidateLancementTimes()`)
- ✅ Manuellement par l'admin via "Consolider" dans l'interface admin

### Exemple de données
```
TempsId | OperatorCode | LancementCode | StartTime | EndTime | TotalDuration | PauseDuration | StatutTraitement
--------|-------------|---------------|-----------|---------|---------------|---------------|------------------
526     | OP001       | LT2501136     | 08:00     | 17:30   | 570           | 60            | NULL
```

---

## 📊 Table 3 : ABSESSIONS_OPERATEURS (Sessions actives)

### Rôle
**État en temps réel** - Suit les opérations **en cours** (non terminées).

### Structure clé
- **`SessionId`** : ID unique de la session
- **`OperatorCode`** : Code de l'opérateur
- **`LancementCode`** : Code du lancement actif
- **`Status`** : Statut actuel (`EN_COURS`, `EN_PAUSE`)
- **`StartTime`** : Heure de début de la session

### Quand est-ce utilisé ?
**Pour les opérations en cours uniquement** :
- ✅ Créé lors de `DEBUT`
- ✅ Mis à jour lors de `PAUSE` / `REPRISE`
- ✅ Supprimé lors de `FIN`

---

## 🔄 FLUX COMPLET D'ENREGISTREMENT

### Scénario 1 : Opération normale (Démarrer → Pause → Reprendre → Arrêter)

```
1. Opérateur clique "Démarrer"
   ├─> ABHISTORIQUE_OPERATEURS : INSERT événement DEBUT (NoEnreg=1001)
   ├─> ABSESSIONS_OPERATEURS : INSERT session active
   └─> ABTEMPS_OPERATEURS : RIEN (pas encore terminé)

2. Opérateur clique "Pause"
   ├─> ABHISTORIQUE_OPERATEURS : INSERT événement PAUSE (NoEnreg=1002)
   ├─> ABSESSIONS_OPERATEURS : UPDATE status = EN_PAUSE
   └─> ABTEMPS_OPERATEURS : RIEN

3. Opérateur clique "Reprendre"
   ├─> ABHISTORIQUE_OPERATEURS : INSERT événement REPRISE (NoEnreg=1003)
   ├─> ABSESSIONS_OPERATEURS : UPDATE status = EN_COURS
   └─> ABTEMPS_OPERATEURS : RIEN

4. Opérateur clique "Arrêter"
   ├─> ABHISTORIQUE_OPERATEURS : INSERT événement FIN (NoEnreg=1004)
   ├─> ABSESSIONS_OPERATEURS : DELETE session
   └─> ABTEMPS_OPERATEURS : INSERT enregistrement consolidé (TempsId=526)
       └─> Calcul automatique des durées depuis les événements
```

### Scénario 2 : Opération non terminée (Démarrer → ... → toujours en cours)

```
1. Opérateur clique "Démarrer"
   ├─> ABHISTORIQUE_OPERATEURS : INSERT événement DEBUT (NoEnreg=1001)
   ├─> ABSESSIONS_OPERATEURS : INSERT session active
   └─> ABTEMPS_OPERATEURS : RIEN (pas encore terminé)

2. Opération toujours en cours...
   ├─> ABHISTORIQUE_OPERATEURS : Contient l'événement DEBUT
   ├─> ABSESSIONS_OPERATEURS : Session active toujours présente
   └─> ABTEMPS_OPERATEURS : RIEN (pas d'événement FIN = pas consolidé)
```

---

## 🔍 IDENTIFICATION DES OPÉRATIONS

### Opération NON CONSOLIDÉE (pas encore terminée ou pas encore consolidée)

**Source** : `ABHISTORIQUE_OPERATEURS`
- **ID** : `NoEnreg` (ex: 1001, 1002, 1003...)
- **Caractéristiques** :
  - Pas d'événement `FIN` OU
  - Événement `FIN` existe mais pas encore consolidé dans `ABTEMPS_OPERATEURS`
- **API** : `/api/admin/operations/:id` (où `id` = `NoEnreg`)
- **Frontend** : `_isUnconsolidated: true`, `TempsId: null`, `EventId: op.id`

### Opération CONSOLIDÉE (terminée et consolidée)

**Source** : `ABTEMPS_OPERATEURS`
- **ID** : `TempsId` (ex: 526, 527, 528...)
- **Caractéristiques** :
  - Événement `FIN` existe ET
  - Enregistrement consolidé créé dans `ABTEMPS_OPERATEURS`
- **API** : `/api/admin/monitoring/:tempsId` (où `tempsId` = `TempsId`)
- **Frontend** : `_isUnconsolidated: false`, `TempsId: 526`

---

## ⚠️ RÈGLES IMPORTANTES

### 1. Ne JAMAIS mélanger les IDs
- ❌ **JAMAIS** utiliser un `NoEnreg` comme `TempsId`
- ❌ **JAMAIS** utiliser un `TempsId` comme `NoEnreg`
- ✅ **TOUJOURS** vérifier `_isUnconsolidated` avant de choisir l'API

### 2. Consolidation automatique
- ✅ Se fait automatiquement lors de l'événement `FIN`
- ✅ Peut être déclenchée manuellement par l'admin
- ✅ Ne se fait **JAMAIS** pour une opération non terminée

### 3. Modification des opérations
- **Non consolidée** : Modifier via `/api/admin/operations/:NoEnreg` (modifie les événements)
- **Consolidée** : Modifier via `/api/admin/monitoring/:TempsId` (modifie l'enregistrement consolidé)

### 4. Suppression des opérations
- **Non consolidée** : Supprimer via `/api/admin/operations/:NoEnreg` (supprime les événements)
- **Consolidée** : Supprimer via `/api/admin/monitoring/:TempsId` (supprime l'enregistrement consolidé)

---

## 🛠️ FONCTIONS UTILITAIRES

### `consolidateLancementTimes(operatorCode, lancementCode)`
**Rôle** : Consolide une opération terminée dans `ABTEMPS_OPERATEURS`

**Quand** :
- Automatiquement lors de l'événement `FIN`
- Manuellement par l'admin

**Ce qu'elle fait** :
1. Récupère tous les événements du lancement depuis `ABHISTORIQUE_OPERATEURS`
2. Vérifie qu'il y a un `DEBUT` et un `FIN`
3. Calcule les durées (Total, Pause, Productive)
4. Insère un enregistrement dans `ABTEMPS_OPERATEURS`
5. Retourne le `TempsId` créé

---

## 📝 EXEMPLES DE CODE

### Frontend : Identifier le type d'opération
```javascript
const operation = {
    TempsId: 526,           // Si consolidée
    EventId: 1001,          // Si non consolidée
    _isUnconsolidated: false // true = non consolidée, false = consolidée
};

// Choisir la bonne API
if (operation._isUnconsolidated) {
    // Utiliser EventId avec /api/admin/operations/:id
    await apiService.updateOperation(operation.EventId, data);
} else {
    // Utiliser TempsId avec /api/admin/monitoring/:tempsId
    await apiService.correctMonitoringTemps(operation.TempsId, data);
}
```

### Backend : Vérifier si une opération est consolidée
```javascript
// Vérifier dans ABTEMPS_OPERATEURS
const checkQuery = `
    SELECT TempsId 
    FROM ABTEMPS_OPERATEURS 
    WHERE OperatorCode = @operatorCode 
    AND LancementCode = @lancementCode
`;
const consolidated = await executeQuery(checkQuery, { operatorCode, lancementCode });

if (consolidated.length > 0) {
    // Opération consolidée - utiliser TempsId
    const tempsId = consolidated[0].TempsId;
} else {
    // Opération non consolidée - utiliser NoEnreg depuis ABHISTORIQUE
    const eventsQuery = `SELECT NoEnreg FROM ABHISTORIQUE_OPERATEURS WHERE ...`;
}
```

---

## ✅ CHECKLIST DE VALIDATION

Avant de modifier/supprimer une opération, vérifier :

- [ ] L'opération est-elle consolidée ? (`_isUnconsolidated === false`)
  - [ ] Si OUI → Utiliser `TempsId` avec `/api/admin/monitoring/:tempsId`
  - [ ] Si NON → Utiliser `EventId` (ou `NoEnreg`) avec `/api/admin/operations/:id`

- [ ] L'ID utilisé correspond-il au bon type ?
  - [ ] `TempsId` est un nombre (ex: 526) → Table `ABTEMPS_OPERATEURS`
  - [ ] `NoEnreg` est un nombre (ex: 1001) → Table `ABHISTORIQUE_OPERATEURS`

- [ ] L'opération existe-t-elle vraiment ?
  - [ ] Vérifier dans la bonne table selon le type d'ID

---

## 🎯 RÉSUMÉ

| Aspect | Non Consolidée | Consolidée |
|--------|----------------|-------------|
| **Table source** | `ABHISTORIQUE_OPERATEURS` | `ABTEMPS_OPERATEURS` |
| **ID** | `NoEnreg` (ex: 1001) | `TempsId` (ex: 526) |
| **Quand** | Opération en cours ou terminée mais pas consolidée | Opération terminée ET consolidée |
| **API GET** | `/api/admin/operations/:id` | `/api/admin/monitoring?filters` |
| **API PUT** | `/api/admin/operations/:id` | `/api/admin/monitoring/:tempsId` |
| **API DELETE** | `/api/admin/operations/:id` | `/api/admin/monitoring/:tempsId` |
| **Frontend flag** | `_isUnconsolidated: true` | `_isUnconsolidated: false` |
