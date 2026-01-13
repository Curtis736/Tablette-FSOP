# 📋 Résumé complet des fonctionnalités FSOP implémentées

## Vue d'ensemble

Système complet de gestion FSOP (Formulaires de Suivi Opérationnel) avec 3 composants principaux :
1. **Backend API** : Génération et injection de données dans les documents Word
2. **Frontend** : Interface opérateur avec bouton FSOP et modal
3. **Agent Windows** : Synchronisation automatique FSOP → Excel (sans oubli, sans action opérateur)

---

## 1️⃣ BACKEND - API FSOP

### Fichiers créés/modifiés
- `backend/routes/fsop.js` - Route POST `/api/fsop/open`
- `backend/services/fsopWordService.js` - Services de manipulation Word
- `backend/server.js` - Ajout de la route FSOP
- `backend/package.json` - Ajout dépendance `adm-zip`

### Fonctionnalités
- **POST `/api/fsop/open`** : Génère un document FSOP Word
  - **Input** : `{ launchNumber, templateCode, serialNumber }`
  - **Validation** : LT (format LT1234567), Template (F469), SN (alphanumérique)
  - **Vérifications** :
    - `TRACEABILITY_DIR` accessible (503 si non monté)
    - Dossier `{LT}/FSOP` existe (422 si absent)
    - Template `TEMPLATE_{Fxxx}.docx` existe (404 si absent)
  - **Logique** :
    - Cherche un Word existant (profondeur limitée, exclut templates)
    - Copie le Word existant OU le template dans `FSOP_DIR`
    - Injecte `{{LT}}` et `{{SN}}` dans le document
    - Renvoie le fichier en téléchargement

### Codes d'erreur
- `400 INPUT_INVALID` - Champs manquants/invalides
- `503 TRACEABILITY_UNAVAILABLE` - Partage réseau non monté
- `422 FSOP_DIR_NOT_FOUND` - Dossier FSOP absent
- `404 TEMPLATE_NOT_FOUND` - Template absent
- `500 INTERNAL_ERROR` - Erreur serveur

---

## 2️⃣ FRONTEND - Interface Opérateur

### Fichiers créés/modifiés
- `frontend/index.html` - Ajout bouton FSOP + modal
- `frontend/components/OperateurInterface.js` - Logique FSOP
- `frontend/assets/styles.css` - Styles modal FSOP

### Fonctionnalités
- **Bouton "FSOP"** à côté du champ LT
- **Modal FSOP** avec :
  - Champ `templateCode` (ex: F469) - obligatoire
  - Champ `serialNumber` (SN) - obligatoire
  - Bouton "Ouvrir FSOP (Word)"
- **Gestion erreurs** via NotificationManager :
  - Messages spécifiques selon les codes d'erreur backend
- **Download automatique** : Blob download du fichier Word généré

---

## 3️⃣ AGENT WINDOWS - Synchronisation FSOP → Excel

### Fichiers créés
- `agent/fsop-sync-agent/index.js` - Watcher principal
- `agent/fsop-sync-agent/lib/docxTags.js` - Extraction tags depuis Word
- `agent/fsop-sync-agent/lib/excelNamedRanges.js` - Mise à jour Excel
- `agent/fsop-sync-agent/agent.config.example.json` - Configuration
- `agent/fsop-sync-agent/package.json` - Dépendances
- `agent/fsop-sync-agent/README.md` - Documentation

### Fonctionnalités
- **Surveillance automatique** : Dossier FSOP (chokidar)
- **Détection fin d'édition** :
  - Vérifie absence de fichier `~$` (lock Word)
  - Vérifie stabilité du fichier (délai configurable)
- **Extraction tags** : Parse `word/document.xml` pour extraire valeurs
- **Mise à jour Excel** :
  - Cherche fichier Excel dans `X:\Tracabilite\` avec pattern `mesure *{SN}*.xlsx`
  - Extrait SN du nom du fichier FSOP (format: `23.199` ou `SN123`)
  - Écrit dans plages nommées Excel (nom = nom du tag)
- **Retry/robustesse** : Gestion verrouillage Excel, retries, logs

### Structure Excel
- **Fichier** : `mesure HOI 23.199.xlsx` (directement dans `X:\Tracabilite\`)
- **Plages nommées** : `HOI_23_199_TEMP`, `HOI_23_199_PRESS`, etc. (sans `{{}}`)

---

## 4️⃣ DOCKER - Configuration Production

### Fichiers modifiés
- `docker/docker-compose.production.yml` - Bind mount paramétrable (défaut: `/srv/services`)
- `docker/docker-compose.prod.yml` - Bind mount paramétrable + variables d'environnement

### Variables d'environnement
- `TRACEABILITY_DIR=/mnt/services/Tracabilite`
- `FSOP_SEARCH_DEPTH=3`

---

## 🧪 TESTS À EFFECTUER

### Test 1 : Backend - Route API
```bash
# Test avec curl
curl -X POST http://localhost:3001/api/fsop/open \
  -H "Content-Type: application/json" \
  -d '{"launchNumber":"LT2501132","templateCode":"F469","serialNumber":"SN123"}'
```

### Test 2 : Backend - Services Word
- Test `safeIsDirectory`, `safeIsFile`
- Test `findExistingDocx` (recherche limitée)
- Test `injectIntoDocx` (remplacement placeholders)

### Test 3 : Frontend - Interface
- Ouvrir l'interface opérateur
- Cliquer sur bouton FSOP
- Remplir formulaire et tester download

### Test 4 : Agent - Synchronisation
- Créer un fichier FSOP test
- Modifier les tags dans Word
- Vérifier mise à jour Excel automatique

---

## 📝 NOTES IMPORTANTES

### Montage SMB (à faire sur VM)
- Cas standard : partage monté sur `/srv/services` → conteneur `/mnt/services`
- Variante VM : si la VM a déjà `/mnt/partage_fsop` (racine traçabilité), utilisez `docker/env.vm.example` :

```bash
cd docker
cp env.vm.example .env
docker compose -f docker-compose.production.yml up -d
```
- Voir instructions dans email IT

### Conventions tags
- **Word** : `{{TAG_NAME}}` (ex: `{{HOI_23_199_TEMP}}`)
- **Excel** : Plage nommée `TAG_NAME` (sans `{{}}`)

### Structure fichiers
- **FSOP** : `X:\Tracabilite\{LT}\FSOP\FSOP_{Fxxx}_{SN}_{LT}.docx`
- **Excel** : `X:\Tracabilite\mesure HOI {SN}.xlsx`

