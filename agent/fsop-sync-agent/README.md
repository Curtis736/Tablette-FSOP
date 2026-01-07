# Agent de synchronisation FSOP → Excel

Agent Windows qui surveille les fichiers FSOP sur le partage réseau et met à jour automatiquement un fichier Excel avec les valeurs extraites des tags.

## Fonctionnement

1. **Surveillance** : L'agent surveille le dossier `FSOP_DIR` (configurable) pour détecter les modifications de fichiers `FSOP_*.docx`.
2. **Détection fin d'édition** : Quand un fichier Word est fermé (fichier temporaire `~$` disparu + fichier stable), l'agent déclenche la synchronisation.
3. **Extraction** : Extraction des valeurs depuis les tags dans le document Word (format `{{TAG_NAME}}`).
4. **Mise à jour Excel** : Écriture des valeurs dans les plages nommées correspondantes du fichier Excel.

## Conventions de tags

### Dans le template Word
- Format : `{{TAG_NAME}}` (ex: `{{HOI_23_199_TEMP}}`, `{{HOI_23_199_PRESS}}`)
- Les tags doivent être écrits d'un seul bloc (sans style différent au milieu, sans retour à la ligne)
- Les valeurs sont remplacées par l'opérateur lors de l'édition

### Dans l'Excel
- Créer des **plages nommées** avec exactement le même nom que le tag (sans les `{{}}`)
- Exemple : plage nommée `HOI_23_199_TEMP` → l'agent écrira la valeur dans cette cellule

## Installation

### Prérequis
- Node.js 16+ installé
- Accès au partage réseau (lecture FSOP, écriture Excel)

### Installation
```bash
cd agent/fsop-sync-agent
npm install
```

### Configuration
Copier `agent.config.example.json` vers `agent.config.json` et ajuster les chemins :
- `fsopDir` : Chemin vers le dossier FSOP (ex: `X:\Tracabilite\{LT}\FSOP`)
- `excelBaseDir` : Chemin vers le dossier Tracabilite (ex: `X:\Tracabilite`)
- `excelPattern` : Pattern glob pour trouver le fichier Excel avec `{SN}` dans le nom (ex: `mesure *{SN}*.xlsx`) - le fichier Excel se trouve directement dans `Tracabilite\` et son nom contient le SN (ex: `mesure HOI 23.199.xlsx`) - si plusieurs fichiers correspondent, le plus récent est utilisé
- `stabilityDelayMs` : Délai d'attente après dernière modification (défaut: 5000ms)

**Exemple de structure** :
- `X:\Tracabilite\mesure HOI 23.199.xlsx` (fichier directement dans Tracabilite)
- `X:\Tracabilite\mesure AUTRE 45.678.xlsx`

Le SN est extrait du nom du fichier FSOP (format: `FSOP_F469_23.199_LT2501132.docx` ou `FSOP_F469_SN123_LT2501132.docx`).
Le pattern `mesure *{SN}*.xlsx` cherche dans `Tracabilite\` un fichier Excel dont le nom contient le SN (ex: `mesure HOI 23.199.xlsx` où `23.199` est le SN).

### Exécution manuelle
```bash
node index.js
```

### Installation en service Windows
```bash
npm install -g node-windows
node install-service.js
```

## Configuration détaillée

### Fichier `agent.config.json`

```json
{
  "fsopDir": "X:\\Tracabilite\\{LT}\\FSOP",
  "excelPath": "X:\\Tracabilite\\{LT}\\mesures HOI 23.199.xlsx",
  "stabilityDelayMs": 5000,
  "retryAttempts": 3,
  "retryDelayMs": 2000,
  "logLevel": "info",
  "logFile": "logs/fsop-sync-agent.log",
  "tagPattern": "\\{\\{([A-Z0-9_]+)\\}\\}",
  "excelLockRetryMs": 1000,
  "excelLockMaxRetries": 10
}
```

- `fsopDir` : Chemin vers le dossier FSOP (peut contenir `{LT}` qui sera remplacé dynamiquement)
- `excelBaseDir` : Chemin vers le dossier Tracabilite (ex: `X:\Tracabilite`)
- `excelPattern` : Pattern glob avec placeholder `{SN}` (ex: `mesure *{SN}*.xlsx`) - cherche dans `Tracabilite\` un fichier Excel dont le nom contient le SN extrait du nom du fichier FSOP - si plusieurs fichiers correspondent, le plus récent est utilisé
- `stabilityDelayMs` : Délai d'attente après dernière modification avant traitement (ms)
- `retryAttempts` : Nombre de tentatives en cas d'erreur
- `retryDelayMs` : Délai entre les tentatives (ms)
- `tagPattern` : Expression régulière pour détecter les tags (défaut: `{{TAG_NAME}}`)

## Tests

### Test manuel d'extraction de tags
```bash
node test.js "X:\Tracabilite\LT2501132\FSOP\FSOP_F469_SN123_LT2501132.docx"
```

### Test complet (extraction + mise à jour Excel)
```bash
node test.js "X:\Tracabilite\LT2501132\FSOP\FSOP_F469_SN123_LT2501132.docx" "X:\Tracabilite\LT2501132\mesures HOI 23.199.xlsx"
```

## Logs
Les logs sont écrits dans `logs/fsop-sync-agent.log` (rotation automatique).

## Dépannage

### L'agent ne détecte pas les modifications
- Vérifier que le chemin `fsopDir` est correct et accessible
- Vérifier que les fichiers correspondent au pattern `FSOP_*.docx`
- Augmenter `stabilityDelayMs` si Word met du temps à sauvegarder

### Erreur "Excel file is locked"
- L'Excel est ouvert dans Excel → fermer le fichier
- L'agent attend automatiquement (configurable via `excelLockMaxRetries`)

### Tags non extraits
- Vérifier que les tags dans le Word sont au format `{{TAG_NAME}}` (contigus, sans style différent)
- Vérifier que les valeurs ont bien remplacé les placeholders (pas encore des `{{...}}`)

### Plages nommées manquantes dans Excel
- Créer les plages nommées dans Excel avec exactement le même nom que le tag (sans `{{}}`)
- Vérifier que les plages nommées pointent vers des cellules valides

