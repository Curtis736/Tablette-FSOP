# 🧪 Guide de test FSOP - Étape par étape

## ✅ Tests structurels (DÉJÀ PASSÉS)

1. ✅ Backend services importés
2. ✅ Route FSOP chargée dans server.js
3. ✅ Frontend éléments présents (bouton, modal, champs)
4. ✅ Agent structure complète
5. ✅ Dépendances installées (`adm-zip` dans backend)
6. ✅ Aucune erreur de lint

---

## 🔬 Tests fonctionnels à effectuer

### TEST 1 : Backend API (nécessite serveur démarré)

#### Prérequis
- Serveur backend démarré sur `http://localhost:3001`
- Partage SMB monté OU simulation locale

#### Commande de test
```bash
curl -X POST http://localhost:3001/api/fsop/open \
  -H "Content-Type: application/json" \
  -d "{\"launchNumber\":\"LT2501132\",\"templateCode\":\"F469\",\"serialNumber\":\"SN123\"}"
```

#### Résultats attendus

**Si partage non monté** :
```json
{"error":"TRACEABILITY_UNAVAILABLE"}
```
Status: `503`

**Si dossier FSOP absent** :
```json
{"error":"FSOP_DIR_NOT_FOUND"}
```
Status: `422`

**Si template absent** :
```json
{"error":"TEMPLATE_NOT_FOUND"}
```
Status: `404`

**Si tout OK** :
- Téléchargement du fichier `FSOP_F469_SN123_LT2501132.docx`
- Fichier contient LT et SN injectés

---

### TEST 2 : Frontend Interface (nécessite navigateur)

#### Prérequis
- Serveur backend démarré
- Frontend accessible (http://localhost:8080 ou via Docker)

#### Étapes
1. Ouvrir l'application dans le navigateur
2. Se connecter en tant qu'opérateur
3. Saisir un LT valide (ex: `LT2501132`)
4. **Cliquer sur le bouton "FSOP"** (à côté du champ LT)
5. Vérifier que le modal s'ouvre
6. Remplir :
   - **Template** : `F469`
   - **SN** : `SN123`
7. Cliquer sur **"Ouvrir FSOP (Word)"**

#### Résultats attendus

**Si champs invalides** :
- Message d'erreur : "Numéro de formulaire invalide" ou "Numéro de série obligatoire"

**Si erreur backend** :
- Messages spécifiques selon le code :
  - 503 : "Traçabilité indisponible (partage réseau non monté)."
  - 422 : "Dossier absent: X:/Tracabilite/{LT}/FSOP (stop)."
  - 404 : "Template absent dans FSOP: TEMPLATE_F469.docx"

**Si succès** :
- Notification : "FSOP téléchargé"
- Fichier Word téléchargé automatiquement
- Modal se ferme

---

### TEST 3 : Agent Windows (nécessite fichiers réels)

#### Prérequis
- Node.js installé
- Accès au partage réseau `X:\Tracabilite\`
- Fichier Excel existant avec plages nommées

#### Installation
```bash
cd agent/fsop-sync-agent
npm install
```

#### Configuration
1. Copier `agent.config.example.json` → `agent.config.json`
2. Configurer :
   ```json
   {
     "fsopDir": "X:\\Tracabilite\\{LT}\\FSOP",
     "excelBaseDir": "X:\\Tracabilite",
     "excelPattern": "mesure *{SN}*.xlsx"
   }
   ```

#### Test manuel
```bash
# Test extraction tags
node test.js "X:\Tracabilite\LT2501132\FSOP\FSOP_F469_23.199_LT2501132.docx"

# Test complet (extraction + Excel)
node test.js "X:\Tracabilite\LT2501132\FSOP\FSOP_F469_23.199_LT2501132.docx" "X:\Tracabilite\mesure HOI 23.199.xlsx"
```

#### Test automatique (watcher)
```bash
node index.js
```

#### Scénario de test
1. Créer un fichier FSOP : `FSOP_F469_23.199_LT2501132.docx` dans `X:\Tracabilite\LT2501132\FSOP\`
2. Ouvrir dans Word
3. Modifier les tags (remplacer `{{HOI_23_199_TEMP}}` par `123.45`)
4. Sauvegarder et fermer Word
5. Attendre 5-10 secondes
6. Vérifier les logs : `logs/fsop-sync-agent.log`
7. Vérifier que l'Excel `mesure HOI 23.199.xlsx` est mis à jour

#### Résultats attendus
- Agent détecte la modification
- Extraction des tags réussie
- Mise à jour Excel réussie
- Logs dans `logs/fsop-sync-agent.log`

---

## 📋 Checklist de validation

### Backend
- [ ] Route `/api/fsop/open` répond
- [ ] Validation des champs fonctionne
- [ ] Codes d'erreur corrects (503, 422, 404)
- [ ] Injection LT/SN dans Word fonctionne
- [ ] Download du fichier fonctionne

### Frontend
- [ ] Bouton FSOP visible et cliquable
- [ ] Modal s'ouvre correctement
- [ ] Validation des champs côté client
- [ ] Messages d'erreur appropriés
- [ ] Download automatique fonctionne

### Agent
- [ ] Agent démarre sans erreur
- [ ] Détection des modifications fonctionne
- [ ] Extraction des tags fonctionne
- [ ] Mise à jour Excel fonctionne
- [ ] Logs écrits correctement

---

## 🐛 Dépannage

### Backend : "Cannot find module 'adm-zip'"
```bash
cd backend
npm install adm-zip
```

### Frontend : Bouton FSOP ne s'affiche pas
- Vérifier que `index.html` contient le bouton
- Vérifier que `OperateurInterface.js` initialise les éléments

### Agent : "Excel file not found"
- Vérifier le pattern dans `agent.config.json`
- Vérifier que le SN est correctement extrait
- Vérifier que le fichier Excel existe dans `X:\Tracabilite\`

### Agent : "No tags found"
- Vérifier que les tags dans Word sont au format `{{TAG_NAME}}`
- Vérifier que les valeurs ont remplacé les placeholders

---

## ✅ STATUT ACTUEL

**Implémentation** : ✅ **100% COMPLÈTE**
**Tests structurels** : ✅ **PASSÉS**
**Tests fonctionnels** : ⏳ **EN ATTENTE** (nécessite environnement réel)




