# 📋 PROMPT COMPLET - Application SEDI Tablette v2

## 🎯 Vue d'ensemble

**SEDI Tablette** est une application web full-stack de gestion de production industrielle développée pour SEDI ERP. Elle permet aux opérateurs de suivre leurs opérations de production en temps réel via une interface tablette, et aux administrateurs de superviser et gérer toutes les opérations.

### Type d'application
- **Frontend** : Application web JavaScript vanilla (ES6 modules)
- **Backend** : API REST Node.js/Express (conteneurisé Linux Alpine)
- **Base de données** : Microsoft SQL Server (SEDI_APP_INDEPENDANTE + SEDI_ERP)
- **Déploiement** : Docker Compose avec Nginx sur VM Ubuntu
- **Monitoring** : Prometheus + Grafana (optionnel)
- **Stockage fichiers** : Partage réseau SMB monté (UNC `\\ServeurAD\partage reseau\services` → `/mnt/services` dans conteneur)

---

## 🏗️ Architecture

### Structure du projet

```
tablettev2/
├── frontend/              # Interface utilisateur
│   ├── components/        # Composants React-like
│   │   ├── App.js        # Point d'entrée principal
│   │   ├── OperateurInterface.js  # Interface opérateur
│   │   └── AdminPage.js  # Interface administrateur
│   ├── services/         # Services API
│   │   ├── ApiService.js # Client API avec rate limiting
│   │   └── StorageService.js # Gestion localStorage
│   ├── utils/            # Utilitaires
│   │   ├── NotificationManager.js # Système de notifications
│   │   ├── ScannerManager.js # Gestion scanner code-barres
│   │   └── TimeUtils.js  # Utilitaires temps/durée
│   ├── assets/           # CSS et ressources
│   └── index.html        # Point d'entrée HTML
│
├── backend/              # API REST
│   ├── routes/           # Routes Express
│   │   ├── operators.js  # Gestion opérateurs
│   │   ├── lancements.js # Gestion lancements
│   │   ├── operations.js # Gestion opérations
│   │   ├── admin.js      # Routes admin
│   │   ├── auth.js       # Authentification
│   │   └── comments.js   # Système de commentaires
│   ├── middleware/       # Middlewares Express
│   │   ├── auth.js       # Authentification
│   │   ├── metrics.js    # Métriques Prometheus
│   │   ├── dataIsolation.js # Isolation données
│   │   ├── operatorSecurity.js # Sécurité opérateurs
│   │   └── concurrencyManager.js # Gestion concurrence
│   ├── services/        # Services métier
│   │   ├── DataValidationService.js # Validation données
│   │   ├── SecureQueryService.js # Requêtes sécurisées
│   │   ├── emailService.js # Envoi emails
│   │   └── webhookEmailService.js # Webhooks email
│   ├── config/          # Configuration
│   │   ├── database.js  # Connexion SQL Server
│   │   ├── production.js # Config production
│   │   └── security.js  # Config sécurité
│   ├── models/          # Modèles de données
│   │   └── Comment.js   # Modèle commentaire
│   └── server.js        # Serveur Express principal
│
└── docker/              # Configuration Docker
    ├── docker-compose.production.yml
    ├── docker-compose.monitoring.yml
    ├── Dockerfile.backend
    ├── Dockerfile.frontend
    └── nginx.conf
```

---

## 👥 Utilisateurs et rôles

### 1. **Opérateurs**
- **Connexion** : Par code opérateur (sans mot de passe)
- **Fonctionnalités** :
  - Saisie/scan de code de lancement (format: `LT` + 7 chiffres)
  - Démarrer/Reprendre/Pause/Arrêter une opération
  - Visualiser le temps écoulé en temps réel
  - Consulter l'historique de ses opérations
  - Ajouter des commentaires sur les lancements
  - Scanner des codes-barres pour saisie automatique

### 2. **Administrateurs**
- **Accès** : Raccourci clavier `Ctrl+A` depuis l'interface opérateur
- **Fonctionnalités** :
  - Visualiser toutes les opérations en temps réel
  - Filtrer par opérateur, statut, code lancement
  - Modifier les heures de début/fin et statuts
  - Supprimer des opérations
  - Ajouter manuellement des opérations
  - Transférer les opérations terminées vers la base ERP
  - Consulter les statistiques globales
  - Gérer les commentaires

---

## 🔑 Fonctionnalités principales

### Interface Opérateur

#### 1. **Gestion des lancements**
- **Saisie manuelle** : Champ avec préfixe `LT` automatique
- **Scanner code-barres** : Utilise la caméra de la tablette avec ZXing
- **Validation automatique** : Vérifie l'existence du lancement dans LCTE (base ERP)
- **Format** : `LT` + 7 chiffres maximum (ex: `LT1234567`)

#### 2. **Contrôle des opérations**
- **Démarrer** : Démarre une nouvelle opération
- **Reprendre** : Reprend une opération en pause
- **Pause** : Met en pause l'opération en cours
- **Arrêter** : Termine l'opération et enregistre la durée

#### 3. **Timer en temps réel**
- Affichage du temps écoulé (format: `HH:MM:SS`)
- Calcul automatique de l'heure de fin estimée
- Gestion des pauses (temps de pause exclu du calcul)
- Reprise automatique après reconnexion

#### 4. **Historique opérateur**
- Liste des opérations de la journée
- Affichage : Code lancement, Article, Phase, Heure début, Heure fin, Statut
- Actualisation automatique et manuelle
- Indicateurs visuels pour les pauses

#### 5. **Système de commentaires**
- Ajout de commentaires sur les lancements
- Limite : 2000 caractères avec compteur
- Notification email automatique à l'admin
- Suppression possible (propre commentaire uniquement)
- Affichage chronologique

#### 6. **Scanner de code-barres**
- Activation via bouton dédié
- Utilise la caméra de la tablette
- Bibliothèque ZXing pour la détection
- Nettoyage automatique du code scanné
- Ajout automatique du préfixe `LT` si absent
- Validation automatique après scan

### Interface Administrateur

#### 1. **Tableau de bord**
- **Statistiques** :
  - Nombre total d'opérateurs connectés
  - Lancements actifs
  - Lancements en pause
  - Lancements terminés

#### 2. **Gestion des opérations**
- **Affichage** : Tableau avec toutes les opérations
- **Colonnes** : Opérateur, Code lancement, Article, Phase, Heure début, Heure fin, Statut, Actions
- **Filtres** :
  - Par opérateur (menu déroulant)
  - Par statut (EN_COURS, EN_PAUSE, TERMINE, etc.)
  - Par code lancement (recherche textuelle)
- **Actualisation** : Automatique toutes les 15 secondes

#### 3. **Édition des opérations**
- **Modification inline** :
  - Heure de début (input type="time")
  - Heure de fin (input type="time")
  - Statut (select avec options)
- **Validation** :
  - Vérification cohérence des heures
  - Format HH:mm obligatoire
  - Heure fin > heure début
- **Sauvegarde** :
  - Automatique toutes les 30 secondes
  - Immédiate pour les heures critiques
  - Notification de succès/erreur

#### 4. **Actions sur les opérations**
- **Supprimer** : Avec confirmation
- **Ajouter** : Création manuelle d'une opération
- **Transférer** : Export vers SEDI_APP_INDEPENDANTE

#### 5. **Gestion des opérateurs**
- Liste des opérateurs connectés en temps réel
- Indicateurs visuels :
  - ✅ Opérateur correctement lié
  - ⚠️ Association partielle
  - ❌ Pas de ressource associée
  - 🟢 Opérateur actif

---

## 🗄️ Base de données

### Schéma principal : `SEDI_APP_INDEPENDANTE`

#### Table : `ABHISTORIQUE_OPERATEURS`
Stocke toutes les opérations des opérateurs.

**Colonnes principales** :
- `NoEnreg` : ID unique (auto-increment)
- `OperatorCode` : Code opérateur
- `CodeLanctImprod` : Code lancement (format LT + chiffres)
- `Ident` : Type d'événement (DEBUT, PAUSE, REPRISE, FIN)
- `DateCreation` : Date/heure de création
- `DateTravail` : Date/heure de travail
- `HeureDebut` : Heure de début
- `HeureFin` : Heure de fin
- `Phase` : Phase de production (défaut: PRODUCTION)
- `Statut` : Statut (EN_COURS, EN_PAUSE, TERMINE, etc.)

#### Table : `ABSESSIONS_OPERATEURS`
Gère les sessions actives des opérateurs.

**Colonnes principales** :
- `OperatorCode` : Code opérateur
- `SessionStatus` : Statut session (ACTIVE, INACTIVE)
- `DateCreation` : Date de création
- `LastActivity` : Dernière activité

#### Table : `COMMENTS`
Système de commentaires.

**Colonnes principales** :
- `id` : ID unique
- `operatorCode` : Code opérateur
- `operatorName` : Nom opérateur
- `lancementCode` : Code lancement
- `comment` : Texte du commentaire
- `timestamp` : Date/heure

### Schéma ERP : `SEDI_ERP`

#### Table : `LCTE`
Référentiel des lancements.

**Colonnes principales** :
- `CodeLancement` : Code lancement (clé primaire)
- `CodeArticle` : Code article
- `DesignationLct1` : Désignation
- `CodeModele` : Code modèle
- `DesignationArt1` : Désignation article 1
- `DesignationArt2` : Désignation article 2

#### Table : `abetemps_temp`
Table temporaire des temps (ERP).

#### Table : `abetemps_Pause`
Table des pauses (ERP).

---

## 🔌 API REST

### Base URL
- **Développement** : `http://localhost:3033/api`
- **Production** : `/api` (via Nginx proxy)

### Endpoints principaux

#### Opérateurs
- `GET /api/operators/:code` - Récupérer un opérateur
- `GET /api/operators/:code/operations` - Historique opérateur
- `POST /api/operators/:code/start` - Démarrer opération
- `POST /api/operators/:code/pause` - Mettre en pause
- `POST /api/operators/:code/resume` - Reprendre
- `POST /api/operators/:code/stop` - Arrêter opération
- `GET /api/operators/:code/current` - Opération en cours

#### Lancements
- `GET /api/lancements` - Liste des lancements
- `GET /api/lancements/:code` - Détails d'un lancement
- `GET /api/lancements/active` - Lancements actifs

#### Opérations
- `GET /api/operations` - Liste des opérations
- `GET /api/operations/:id` - Détails d'une opération
- `PUT /api/operations/:id` - Modifier une opération
- `DELETE /api/operations/:id` - Supprimer une opération

#### Admin
- `GET /api/admin/data` - Données admin (opérations + stats)
- `GET /api/admin/operators` - Opérateurs connectés
- `GET /api/admin/operators/:code/operations` - Opérations d'un opérateur
- `POST /api/admin/operations` - Créer une opération
- `POST /api/admin/transfer` - Transférer vers ERP

#### Commentaires
- `GET /api/comments/lancement/:code` - Commentaires d'un lancement
- `POST /api/comments` - Ajouter un commentaire
- `DELETE /api/comments/:id` - Supprimer un commentaire

#### FSOP (Formulaires Standardisés d'Opération)
- `POST /api/fsop/open` - Ouvrir/générer un document FSOP Word
  - Body: `{ launchNumber, templateCode, serialNumber }`
  - Retourne: Fichier Word téléchargeable avec LT/SN injectés
  - Codes erreur: 400, 404, 422, 503

#### Santé et métriques
- `GET /api/health` - Santé de l'API
- `GET /metrics` - Métriques Prometheus

---

## 🔒 Sécurité

### Authentification
- **Opérateurs** : Code opérateur uniquement (pas de mot de passe)
- **Admin** : Raccourci clavier `Ctrl+A` (pas d'authentification séparée)

### Middlewares de sécurité
- **Helmet** : Headers de sécurité HTTP
- **CORS** : Configuration des origines autorisées
- **Rate Limiting** : 
  - Production : 200 requêtes / 15 minutes
  - Développement : 2000 requêtes / 15 minutes
- **Data Isolation** : Isolation des données par opérateur
- **Operator Security** : Validation des sessions et propriété des données
- **Secure Query Service** : Protection contre les injections SQL

### Validation des données
- **Joi** : Validation des schémas
- **DataValidationService** : Validation métier
- **Sanitization** : Nettoyage des entrées utilisateur

---

## ⚙️ Configuration

### Variables d'environnement

#### Backend
```env
# Base de données principale
DB_SERVER=192.168.1.26
DB_DATABASE=SEDI_APP_INDEPENDANTE
DB_USER=QUALITE
DB_PASSWORD=QUALITE

# Base de données ERP
DB_ERP_SERVER=192.168.1.26
DB_ERP_DATABASE=SEDI_ERP
DB_ERP_USER=QUALITE
DB_ERP_PASSWORD=QUALITE

# Serveur
PORT=3001
NODE_ENV=production

# Traçabilité FSOP (chemin dans conteneur après montage SMB)
TRACEABILITY_DIR=/mnt/services/Tracabilite
FSOP_SEARCH_DEPTH=3

# Email (optionnel)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=user@example.com
EMAIL_PASSWORD=password
```

#### Frontend
- Détection automatique de l'environnement
- Configuration via `ApiService` (détection du port/host)

### Configuration production
Fichier `backend/config-production.js` (optionnel, prioritaire sur les variables d'environnement)

---

## 🐳 Déploiement Docker

### Services Docker

1. **Backend** (`Dockerfile.backend`)
   - Node.js 16+
   - Port : 3001
   - Health check : `/api/health`

2. **Frontend** (`Dockerfile.frontend`)
   - Serveur HTTP statique (http-server)
   - Port : 8080
   - Nginx pour le reverse proxy

3. **Nginx** (reverse proxy)
   - Proxy `/api` → Backend
   - Servir les fichiers statiques frontend

4. **Prometheus** (optionnel)
   - Port : 9091
   - Scraping des métriques backend

5. **Grafana** (optionnel)
   - Port : 3002
   - Dashboards de monitoring

### Commandes de déploiement

```bash
# Production
docker-compose -f docker/docker-compose.production.yml up -d

# Avec monitoring
docker-compose -f docker/docker-compose.monitoring.yml up -d

# Déploiement complet (script)
cd docker && ./deploy.sh
```

---

## 📊 Monitoring

### Métriques Prometheus

Métriques collectées :
- `sedi_http_requests_total` : Nombre total de requêtes
- `sedi_http_request_duration_seconds` : Durée des requêtes
- `sedi_active_operations` : Opérations actives
- `sedi_active_operators` : Opérateurs connectés
- `sedi_database_connections` : Connexions DB

### Dashboards Grafana

Dashboard pré-configuré : `sedi-dashboard.json`
- Graphiques des requêtes HTTP
- Temps de réponse
- Opérations actives
- Opérateurs connectés
- Erreurs et taux de succès

---

## 🧪 Tests

### Frontend
- **Framework** : Vitest
- **Coverage** : @vitest/coverage-v8
- **Tests** : Unitaires pour composants et services

```bash
npm run test          # Tests avec watch
npm run test:run      # Tests une fois
npm run test:coverage # Avec couverture
```

### Backend
- **Framework** : Vitest + tests natifs Node.js
- **Tests** : Unitaires et intégration

```bash
npm test              # Tests natifs
npm run test:vitest   # Tests Vitest
npm run test:coverage # Avec couverture
```

---

## 🔄 Nettoyage automatique

### Au démarrage
- Nettoyage des sessions expirées (> 24h)
- Terminaison des opérations orphelines (sans opérateur connecté)
- Suppression des doublons d'opérations

### Périodique (toutes les heures)
- Répétition du nettoyage au démarrage

---

## 🎨 Interface utilisateur

### Design
- **Style** : CSS moderne avec animations
- **Icons** : Font Awesome 6.0
- **Responsive** : Optimisé pour tablettes
- **Notifications** : Système de notifications toast
- **Thème** : Couleurs SEDI (bleu/vert)

### Composants UI
- **NotificationManager** : Notifications toast avec types (success, error, warning, info)
- **Scanner Modal** : Modal pour scanner code-barres
- **Time Inputs** : Inputs de type "time" pour les heures
- **Status Badges** : Badges colorés pour les statuts
- **Loading States** : Indicateurs de chargement

---

## 📝 Workflow opérateur typique

1. **Connexion** : Saisie du code opérateur
2. **Saisie lancement** : 
   - Saisie manuelle `LT1234567` OU
   - Scan code-barres
3. **Validation** : Vérification automatique dans LCTE
4. **Démarrage** : Clic sur "Démarrer"
5. **Suivi** : Visualisation du timer en temps réel
6. **Pause/Reprise** : Si nécessaire
7. **Arrêt** : Clic sur "Arrêter" à la fin
8. **Commentaire** : Ajout optionnel de commentaire

---

## 🔧 Technologies utilisées

### Frontend
- **JavaScript ES6+** : Modules, classes, async/await
- **ZXing** : Bibliothèque de scan code-barres
- **Font Awesome** : Icons
- **Vitest** : Tests

### Backend
- **Node.js** : Runtime JavaScript
- **Express 5** : Framework web
- **mssql** : Driver SQL Server
- **Joi** : Validation de schémas
- **Helmet** : Sécurité HTTP
- **Morgan** : Logging HTTP
- **Nodemailer** : Envoi d'emails
- **prom-client** : Métriques Prometheus
- **Vitest** : Tests

### Infrastructure
- **Docker** : Conteneurisation
- **Docker Compose** : Orchestration
- **Nginx** : Reverse proxy
- **Prometheus** : Collecte métriques
- **Grafana** : Visualisation métriques

---

## 🚨 Gestion des erreurs

### Frontend
- **Notifications** : Affichage des erreurs via NotificationManager
- **Retry automatique** : Pour les erreurs réseau
- **Cache** : Données en cache en cas d'erreur
- **Rate limiting** : Gestion côté client avec file d'attente

### Backend
- **Try/catch** : Gestion globale des erreurs
- **Middleware d'erreur** : Handler Express pour erreurs 404/500
- **Logging** : Console + fichiers de logs
- **Validation** : Erreurs de validation renvoyées au client

---

## 📈 Performance

### Optimisations
- **Rate limiting** : Côté client et serveur
- **Cache** : Cache simple côté client (10 secondes)
- **Connection pooling** : Pool de connexions SQL Server
- **Debouncing** : Pour les actions utilisateur (1 seconde)
- **Lazy loading** : Chargement à la demande

### Limites
- **Connexions simultanées** : 20 opérateurs max
- **Pool DB** : 25 connexions max
- **Rate limit** : 200 requêtes / 15 min (prod)

---

## 🔐 Bonnes pratiques de sécurité

1. **Validation** : Toutes les entrées utilisateur validées
2. **Sanitization** : Nettoyage des données avant stockage
3. **SQL Injection** : Protection via paramètres préparés
4. **CORS** : Configuration stricte des origines
5. **Rate Limiting** : Protection contre les abus
6. **Isolation données** : Opérateurs ne voient que leurs données
7. **Sessions** : Gestion des sessions avec expiration
8. **Logs** : Logging des actions sensibles

---

## 📚 Documentation additionnelle

- **README.md** : Guide de déploiement
- **PROMETHEUS_VS_GRAFANA.md** : Guide monitoring
- **Tests** : Documentation dans les fichiers de test
- **Comments** : Code commenté en français

---

## 🎯 Points d'attention

1. **Authentification faible** : Code opérateur uniquement (pas de mot de passe)
2. **Admin sans auth** : Accès admin via raccourci clavier uniquement
3. **Concurrence** : Gestion des opérations simultanées sur même lancement
4. **Synchronisation** : Gestion des reconnexions et opérations en cours
5. **Nettoyage** : Nettoyage automatique des données orphelines
6. **Rate limiting** : Important pour éviter la surcharge

---

## 🔄 Évolutions possibles

1. **Authentification renforcée** : Ajout de mots de passe
2. **Multi-utilisateurs** : Gestion des rôles avancés
3. **Notifications push** : Notifications temps réel
4. **Export Excel** : Export des données en Excel
5. **Rapports** : Génération de rapports automatiques
6. **API mobile** : Support pour application mobile native
7. **WebSockets** : Mise à jour temps réel sans polling
8. **Audit trail** : Traçabilité complète des modifications

---

## 📞 Support et maintenance

### Logs
- **Backend** : Console + fichiers dans `backend/logs/`
- **Frontend** : Console navigateur
- **Docker** : `docker-compose logs -f`

### Health checks
- **API** : `GET /api/health`
- **Docker** : Health checks automatiques

### Scripts utilitaires
- `scripts/health-check.js` : Vérification santé
- `scripts/auto-cleanup.js` : Nettoyage manuel
- `scripts/maintenance.js` : Mode maintenance

---

---

## 📄 Fonctionnalité FSOP (Formulaires Standardisés d'Opération)

### Vue d'ensemble

La fonctionnalité FSOP permet aux opérateurs de générer et ouvrir des documents Word (formulaires standardisés) directement depuis l'interface opérateur, en lien avec le code de lancement (LT) en cours.

### Objectif métier

- Les opérateurs saisissent déjà un LT (Code de lancement) dans l'interface opérateur
- Un bouton "FSOP" est disponible à côté du champ LT
- Le bouton ouvre un mini panneau modal avec 2 champs :
  1. **Numéro de formulaire** : `templateCode` (ex: F469) [obligatoire]
  2. **Numéro de série** : `serialNumber` (SN) [obligatoire]
- Un bouton d'action "Ouvrir FSOP (Word)" génère/trouve le Word, le stocke au bon endroit et le renvoie en téléchargement

### Architecture des chemins

#### Windows (Source)
- **Lecteur réseau** : `X:` pointe vers le partage réseau UNC :
  ```
  \\ServeurAD\partage reseau\services
  ```

#### Linux (VM Ubuntu + Docker)
- **Montage SMB** : Le partage est monté sur la VM hôte, puis bind mount vers le conteneur
- **Chemin monté** : `/srv/services` (sur la VM hôte)
- **Chemin dans conteneur** : `/mnt/services` (bind mount depuis `/srv/services`)

#### Chemins FSOP (Règles bloquantes)

**RÈGLE MÉTIER ABSOLUE** :
- Les FSOP doivent **TOUJOURS** être stockés dans :
  ```
  X:\Tracabilite\{LT}\FSOP
  ```
- Côté Linux (conteneur) :
  ```
  TRACEABILITY_DIR = /mnt/services/Tracabilite
  FSOP_DIR = /mnt/services/Tracabilite/{LT}/FSOP
  ```

**Règles de validation** :
- Si `TRACEABILITY_DIR` est inaccessible (partage non monté) → **503 TRACEABILITY_UNAVAILABLE**
- Si `FSOP_DIR` n'existe pas → **422 FSOP_DIR_NOT_FOUND** (NE PAS créer le dossier)
- Les templates Word sont stockés dans `FSOP_DIR` :
  ```
  X:\Tracabilite\{LT}\FSOP\TEMPLATE_{Fxxx}.docx
  => /mnt/services/Tracabilite/{LT}/FSOP/TEMPLATE_{Fxxx}.docx
  ```
- Si le template n'existe pas → **404 TEMPLATE_NOT_FOUND**

### Montage SMB sur la VM Ubuntu

#### Installation CIFS
```bash
sudo apt-get update
sudo apt-get install -y cifs-utils
```

#### Création du dossier hôte
```bash
sudo mkdir -p /srv/services
```

#### Création des credentials
```bash
sudo mkdir -p /etc/smbcredentials
sudo nano /etc/smbcredentials/services.cred
```

Contenu du fichier :
```
username=SMB_USER
password=SMB_PASS
domain=SMB_DOMAIN   (optionnel)
```

Sécuriser :
```bash
sudo chmod 600 /etc/smbcredentials/services.cred
```

#### Montage manuel (test)
```bash
sudo mount -t cifs "//ServeurAD/partage reseau/services" /srv/services \
  -o credentials=/etc/smbcredentials/services.cred,iocharset=utf8,vers=3.0,noperm,soft
```

Test :
```bash
ls -la /srv/services
# => doit afficher le dossier "Tracabilite" dedans
```

#### Montage persistant (fstab)
```bash
sudo nano /etc/fstab
```

Ajouter :
```
//ServeurAD/partage reseau/services  /srv/services  cifs  credentials=/etc/smbcredentials/services.cred,iocharset=utf8,vers=3.0,noperm,_netdev,x-systemd.automount  0  0
```

Tester :
```bash
sudo umount /srv/services
sudo mount -a
ls /srv/services
```

### Configuration Docker Compose

Dans `docker/docker-compose.production.yml` (service backend), ajouter :

```yaml
volumes:
  - /srv/services:/mnt/services:rw
  - ../backend/logs:/app/logs

environment:
  TRACEABILITY_DIR: /mnt/services/Tracabilite
  FSOP_SEARCH_DEPTH: "3"
```

### Convention des templates

Les templates doivent être déposés dans `FSOP_DIR` par LT :
- `X:\Tracabilite\{LT}\FSOP\TEMPLATE_F469.docx`
- `X:\Tracabilite\{LT}\FSOP\TEMPLATE_F588.docx`
- etc.

**RÈGLE** :
- Si `TEMPLATE_{Fxxx}.docx` est absent → **404 TEMPLATE_NOT_FOUND** (ne pas générer de fallback)

**INSTRUCTION TEMPLATES (IMPORTANT)** :
Dans chaque template Word `TEMPLATE_Fxxx.docx`, les marqueurs `{{LT}}` et `{{SN}}` doivent rester **EXACTEMENT** tels quels :
- Écrits d'un seul bloc
- Sans style différent au milieu
- Sans retour à la ligne
- Sans découpage

Ne jamais modifier/renommer ces marqueurs. Sinon l'auto-remplissage LT/SN échouera.

### Logique Word (existant vs nouveau)

**Entrées** :
- `LT` = `launchNumber` (déjà connu/validé dans l'app)
- `Fxxx` = `templateCode`
- `SN` = `serialNumber`

**But** :
- Il peut exister des Word déjà remplis liés au LT dans `X:\Tracabilite\{LT}\` (ou sous-dossiers)
- Si trouvé : on copie ("calque") ce Word dans `FSOP_DIR` puis on renvoie la copie en download
- Sinon : on crée un nouveau Word en copiant le template `TEMPLATE_{Fxxx}.docx` dans `FSOP_DIR`

**Nom standard du Word final** :
```
DEST_FILENAME = FSOP_{Fxxx}_{SN}_{LT}.docx
DEST_PATH = FSOP_DIR/DEST_FILENAME
```

**IMPORTANT** :
- L'opérateur doit toujours travailler sur un fichier qui est dans `FSOP_DIR`
- On ne renvoie jamais le fichier source trouvé ailleurs : on renvoie la copie dans `FSOP_DIR`

### Recherche rapide du Word existant

**NE PAS scanner tout le partage** (`/mnt/services`).

On cherche uniquement autour du LT :
```
ROOT_LT = TRACEABILITY_DIR/{LT}
ex: /mnt/services/Tracabilite/LT2501132
```

**Search roots (ordre)** :
1. `ROOT_LT/FSOP`
2. `ROOT_LT`

**Filtrage MVP** :
- Fichiers `.docx`
- Exclure les templates : ignorer les fichiers dont le nom commence par `"TEMPLATE_"`
- Garder ceux dont le nom contient `templateCode` (F469) (case-insensitive)
- Si plusieurs candidats → prendre le plus récent (mtime desc)
- Profondeur max : `FSOP_SEARCH_DEPTH` (ex: 3)

### Auto-remplissage LT + SN dans le Word

**RÈGLE OBLIGATOIRE** : Stocker LT + SN dans le Word à l'ouverture

À chaque clic "Ouvrir FSOP (Word)", juste avant le download, le backend **DOIT** écrire LT + SN dans le docx final (dans `FSOP_DIR`), que ce soit :
1. Un Word existant calqué
2. Un Word créé depuis template

**MÉTHODE MVP** (rapide en 3–4h) :
- Les documents contiennent deux placeholders :
  - `{{LT}}`
  - `{{SN}}`
- La fonction `injectIntoDocx(destPath)` :
  - Ouvre le docx (zip)
  - Remplace dans `word/document.xml` :
    - `{{LT}}` → valeur LT
    - `{{SN}}` → valeur SN
  - Ré-écrit le docx
- Ensuite seulement : download

**TEST** :
- Ouvrir le docx téléchargé → LT et SN doivent être visibles dans le document (pas vides, pas seulement dans le nom de fichier)

### Contrainte web : ouvrir Word

Le navigateur ne peut pas ouvrir `X:`.

**Solution** :
- Backend renvoie le docx en téléchargement (stream)
- Frontend déclenche un download blob
- L'opérateur ouvre le fichier téléchargé avec Word

### Backend — Nouvel endpoint Express

**Route** :
```
POST /api/fsop/open
```

**Body JSON** :
```json
{
  "launchNumber": "LT2501132",
  "templateCode": "F469",
  "serialNumber": "SN12345"
}
```

**Codes d'erreur** :
- **400 INPUT_INVALID** : LT/Fxxx/SN manquants
- **503 TRACEABILITY_UNAVAILABLE** : `TRACEABILITY_DIR` inaccessible (partage non monté)
- **422 FSOP_DIR_NOT_FOUND** : `FSOP_DIR` absent (stop)
- **404 TEMPLATE_NOT_FOUND** : `TEMPLATE_Fxxx.docx` absent dans `FSOP_DIR` (stop)
- **200** : Renvoie le docx final en download

**Pseudo-code backend** :
```javascript
openFsop(req, res):
  LT = req.body.launchNumber
  F  = req.body.templateCode
  SN = req.body.serialNumber
  if !LT||!F||!SN => 400

  traceRoot = process.env.TRACEABILITY_DIR
  if !exists(traceRoot) => 503

  fsopDir = join(traceRoot, LT, "FSOP")
  if !exists(fsopDir) => 422

  templatePath = join(fsopDir, `TEMPLATE_${F}.docx`)
  if !exists(templatePath) => 404

  rootLt = join(traceRoot, LT)
  existing = findExistingDocx(rootLt, F, depth=3, excludePrefix="TEMPLATE_")

  destName = `FSOP_${F}_${SN}_${LT}.docx`
  destPath = join(fsopDir, destName)

  if existing:
    copy(existing, destPath)
  else:
    copy(templatePath, destPath)

  injectIntoDocx(destPath, {"{{LT}}": LT, "{{SN}}": SN})
  return res.download(destPath, destName)
```

**Backend : fonctions utilitaires** (`backend/services/fsopWordService.js`) :
- `findExistingDocx(rootDir, templateCode, depthLimit, excludePrefix)`
- `injectIntoDocx(docxPath, replacements)` (adm-zip)
- `safeExists(path)`

### Frontend — Ajout minimal

Dans `frontend/components/OperateurInterface.js` :
- Bouton "FSOP" à côté du champ LT
- Mini panneau/modal :
  - Input `templateCode` (Fxxx)
  - Input `serialNumber` (SN)
  - Bouton submit "Ouvrir FSOP (Word)"
- Submit :
  ```javascript
  fetch POST /api/fsop/open avec {
    launchNumber: LTActuel,
    templateCode,
    serialNumber
  }
  ```
- Gestion erreurs via `NotificationManager` :
  - **503** → "Traçabilité indisponible (partage réseau non monté)."
  - **422** → "Dossier absent: X:/Tracabilité/{LT}/FSOP (stop)."
  - **404** → "Template absent dans FSOP: TEMPLATE_{Fxxx}.docx"
- Si **200** → download blob automatique :
  ```javascript
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filenameFromHeaderOrDefault
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
  ```

### Checklist de livraison

#### A) VM / Infra
1. ✅ Montage SMB OK :
   - `/srv/services` visible
   - `/srv/services/Tracabilite` visible
2. ✅ Docker bind OK :
   - Conteneur voit `/mnt/services/Tracabilite`
3. ✅ Pour un LT test :
   - `/mnt/services/Tracabilite/LTxxxxxxx/FSOP` existe (sinon STOP attendu)
   - Template présent :
     `/mnt/services/Tracabilite/LTxxxxxxx/FSOP/TEMPLATE_F469.docx`

#### B) Code
4. ✅ Ajouter route `/api/fsop/open` + service utilitaire
5. ✅ Ajouter bouton FSOP + mini panneau + download blob

#### C) Tests
6. ✅ Partage down → 503
7. ✅ FSOP_DIR absent → 422
8. ✅ Template absent → 404
9. ✅ OK → docx téléchargé + LT/SN injectés dans le document

---

**Version** : 2.1 (avec FSOP)  
**Dernière mise à jour** : 2025-01-XX  
**Auteur** : SEDI Development Team

