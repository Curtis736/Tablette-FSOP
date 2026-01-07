# Documentation - Logique métier SQL (tablettes v2)

## Vue d'ensemble

Le système utilise deux bases SQL Server:
- **`[SEDI_ERP]`**: Base ERP de référence (opérateurs, lancements, articles)
- **`[SEDI_APP_INDEPENDANTE]`**: Base applicative tablette (sessions, historique, temps, commentaires)

## Tables applicatives principales

### 1. `ABSESSIONS_OPERATEURS`
**Rôle**: Gérer les sessions de connexion des opérateurs sur les tablettes.

**Structure actuelle** (définie dans `backend/routes/admin.js`):
```sql
CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] (
    SessionId INT IDENTITY(1,1) PRIMARY KEY,
    OperatorCode NVARCHAR(50) NOT NULL,
    LoginTime DATETIME2 NOT NULL,
    LogoutTime DATETIME2 NULL,
    SessionStatus NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    DeviceInfo NVARCHAR(255) NULL,
    DateCreation DATETIME2 NOT NULL DEFAULT GETDATE()
)
```

**Règles métier**:
- Une seule session active par opérateur à la fois (les anciennes sont fermées au login)
- `SessionStatus` = 'ACTIVE' ou 'CLOSED'
- Nettoyage automatique des sessions > 24h au démarrage du serveur
- `DeviceInfo` contient le User-Agent (peu fiable)

**Flux**:
- **Login** (`/api/operators/login`): Crée une nouvelle session, ferme les sessions actives précédentes
- **Logout** (`/api/operators/logout`): Met à jour `LogoutTime` et `SessionStatus = 'CLOSED'`
- **Auto-fermeture**: Si plus d'opérations actives après un `stop`, la session est fermée automatiquement

### 2. `ABHISTORIQUE_OPERATEURS`
**Rôle**: Journaliser tous les événements métier (démarrage, pause, reprise, fin de lancement).

**Structure actuelle**:
```sql
CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] (
    NoEnreg INT IDENTITY(1,1) PRIMARY KEY,
    OperatorCode NVARCHAR(50) NOT NULL,
    CodeLanctImprod NVARCHAR(50) NOT NULL,
    CodeRubrique NVARCHAR(50) NOT NULL,
    Ident NVARCHAR(20) NOT NULL, -- DEBUT, PAUSE, REPRISE, FIN
    Phase NVARCHAR(50) NULL,
    Statut NVARCHAR(20) NULL,
    HeureDebut TIME NULL,
    HeureFin TIME NULL,
    DateCreation DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE)
)
```

**Règles métier**:
- `Ident` peut être: `DEBUT`, `PAUSE`, `REPRISE`, `FIN`
- `Statut` peut être: `EN_COURS`, `EN_PAUSE`, `TERMINE`, `FORCE_STOP`, `REASSIGNED`
- `HeureDebut` utilisé pour DEBUT/PAUSE/REPRISE
- `HeureFin` utilisé pour FIN
- `DateCreation` est une DATE (pas de précision heure/minute)
- Plusieurs opérateurs peuvent travailler sur le même lancement simultanément
- Nettoyage des doublons au démarrage (basé sur `OperatorCode`, `CodeLanctImprod`, `DateCreation`, `Ident`, `Phase`)

**Flux**:
- **Start** (`/api/operators/start`): Insère un événement `DEBUT` avec `Statut = 'EN_COURS'`
- **Pause** (`/api/operators/pause`): Insère un événement `PAUSE` avec `Statut = 'EN_PAUSE'`
- **Resume** (`/api/operators/resume`): Insère un événement `REPRISE` avec `Statut = 'EN_COURS'`
- **Stop** (`/api/operators/stop`): Insère un événement `FIN` avec `Statut = 'TERMINE'`

**Problèmes identifiés**:
- Pas de corrélation avec la session (`SessionId`)
- `DateCreation` est une DATE (perte de précision temporelle)
- Pas de `RequestId` pour tracer les requêtes API

### 3. `ABTEMPS_OPERATEURS`
**Rôle**: Agrégation des temps de travail par opérateur/lancement.

**Structure actuelle**:
```sql
CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] (
    TempsId INT IDENTITY(1,1) PRIMARY KEY,
    OperatorCode NVARCHAR(50) NOT NULL,
    LancementCode NVARCHAR(50) NOT NULL,
    StartTime DATETIME2 NOT NULL,
    EndTime DATETIME2 NOT NULL,
    TotalDuration INT NOT NULL, -- en minutes
    PauseDuration INT NOT NULL DEFAULT 0, -- en minutes
    ProductiveDuration INT NOT NULL, -- en minutes
    EventsCount INT NOT NULL DEFAULT 0,
    DateCreation DATETIME2 NOT NULL DEFAULT GETDATE(),
    UNIQUE(OperatorCode, LancementCode, StartTime)
)
```

**Règles métier**:
- `TotalDuration` = temps total en minutes
- `PauseDuration` = somme des pauses en minutes
- `ProductiveDuration` = `TotalDuration - PauseDuration`
- `EventsCount` = nombre d'événements dans `ABHISTORIQUE_OPERATEURS`

**Calcul des durées** (logique dans `backend/routes/admin.js`):
- **Total**: `FIN.DateCreation - DEBUT.DateCreation` (en minutes)
- **Pause**: Somme des intervalles `PAUSE.DateCreation - REPRISE.DateCreation`
- Gestion du passage de minuit (si `HeureFin < HeureDebut`, ajouter 1 jour)

**Problèmes identifiés**:
- Deux logiques de calcul différentes:
  - `admin.js`: Calcul précis basé sur les événements (pauses appariées)
  - `operations.js`: Approximation (pauses * 5 minutes)
- Pas de garantie de cohérence entre `ABHISTORIQUE_OPERATEURS` et `ABTEMPS_OPERATEURS`

### 4. `AB_COMMENTAIRES_OPERATEURS`
**Rôle**: Stocker les commentaires des opérateurs sur les lancements.

**Structure** (définie dans `backend/sql/create_comments_table.sql`):
```sql
CREATE TABLE [dbo].[AB_COMMENTAIRES_OPERATEURS](
    [Id] [int] IDENTITY(1,1) NOT NULL,
    [OperatorCode] [nvarchar](50) NOT NULL,
    [OperatorName] [nvarchar](100) NOT NULL,
    [LancementCode] [nvarchar](50) NOT NULL,
    [Comment] [nvarchar](max) NOT NULL,
    [Timestamp] [datetime2](7) NOT NULL,
    [CreatedAt] [datetime2](7) NOT NULL DEFAULT (GETDATE())
)
```

## Flux métier complets

### Connexion opérateur
1. Client appelle `/api/operators/login` avec `{ code: "843" }`
2. Backend vérifie l'opérateur dans `[SEDI_ERP].[dbo].[RESSOURC]`
3. Ferme toutes les sessions actives de cet opérateur
4. Crée une nouvelle session dans `ABSESSIONS_OPERATEURS`
5. Retourne les infos opérateur + `sessionActive: true`

### Démarrage lancement
1. Client appelle `/api/operators/start` avec `{ operatorId, lancementCode }`
2. Backend valide le lancement dans `[SEDI_ERP].[dbo].[LCTE]`
3. Met à jour/crée la session dans `ABSESSIONS_OPERATEURS` (mise à jour `LoginTime`)
4. Insère un événement `DEBUT` dans `ABHISTORIQUE_OPERATEURS`
5. Crée/met à jour un enregistrement dans `ABTEMPS_OPERATEURS`

### Pause/Reprise
1. Client appelle `/api/operators/pause` ou `/resume`
2. Backend insère un événement `PAUSE` ou `REPRISE` dans `ABHISTORIQUE_OPERATEURS`
3. Met à jour le `Statut` dans `ABHISTORIQUE_OPERATEURS`

### Arrêt lancement
1. Client appelle `/api/operators/stop`
2. Backend calcule les durées (total, pause, productif)
3. Insère un événement `FIN` dans `ABHISTORIQUE_OPERATEURS`
4. Met à jour `ABTEMPS_OPERATEURS` avec les durées finales
5. Si plus d'opérations actives, ferme la session

## Nettoyage automatique

Au démarrage du serveur (`backend/server.js`):
1. Supprime les sessions > 24h
2. Termine les opérations orphelines (actives sans session active)
3. Supprime les doublons dans `ABHISTORIQUE_OPERATEURS`

## Problèmes de cohérence identifiés

1. **Sessions**: `LoginTime` peut être écrasé lors d'une action (perte de l'heure de connexion réelle)
2. **Historique**: Pas de lien avec la session (`SessionId` manquant)
3. **Temps**: Deux logiques de calcul différentes (incohérence)
4. **Audit**: Pas de trace des requêtes API (qui, quand, quoi, combien de temps)
5. **Précision temporelle**: `DateCreation` est une DATE (perte de précision)

## Références

- Routes opérateurs: `backend/routes/operators.js`
- Routes opérations: `backend/routes/operations.js`
- Routes admin: `backend/routes/admin.js`
- Nettoyage: `backend/server.js`
- Migration activité: `backend/sql/migration_add_activity_columns.sql`


