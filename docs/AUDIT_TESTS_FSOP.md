# Audit — tests unitaires et E2E FSOP

Document de référence pour lancer la suite de tests FSOP (formulaires opérateur) dans le cadre d’un audit technique ou qualité.

## Objectif

Vérifier automatiquement que le module **FSOP** (liste des templates, lots, ouverture et sauvegarde de formulaires) fonctionne comme prévu, sans dépendre du serveur de production ni des partages CIFS.

## Prérequis

| Élément | Version / remarque |
|---------|-------------------|
| Windows | 10 ou supérieur |
| Node.js | 18.x ou supérieur ([nodejs.org](https://nodejs.org/)) |
| npm | Fourni avec Node.js |
| Réseau | Uniquement pour la **première** exécution (`npm ci` si `node_modules` absent) |

Aucune base SQL, aucun Docker et aucun montage `/mnt/partage_fsop` n’est requis : les tests utilisent des fichiers temporaires et des mocks.

## Lancement (audit)

1. Ouvrir une invite de commandes ou l’Explorateur Windows.
2. Se placer à la racine du dépôt `Tablette-FSOP`.
3. Exécuter :

```bat
run-audit-tests.bat
```

Ou double-cliquer sur `run-audit-tests.bat`.

### Résultat attendu

- **Succès** : message `Audit FSOP : SUCCES` et code de sortie `0`.
- **Échec** : message `Audit FSOP : ECHEC` et code de sortie `1`.

### Journal d’audit

Chaque exécution produit un fichier horodaté :

```
Tablette-FSOP/audit-logs/audit-fsop-YYYYMMDD-HHMMSS.log
```

Ce fichier contient la sortie complète de Vitest (détail des tests, erreurs éventuelles). À conserver en pièce jointe d’audit.

## Contenu de la suite

| # | Suite | Type | Fichier(s) | Vérifie |
|---|--------|------|------------|---------|
| 1 | Routes FSOP | Unitaire | `backend/tests/fsop.routes.test.js` | API templates, lots invalides, auth session, validation entrées |
| 2 | Flux FSOP | E2E (local) | `backend/tests/fsop.e2e.test.js` | Templates Excel, lots, ouverture `.docx`, sauvegarde + JSON |
| 3 | Templates Excel | Unitaire | `backend/tests/fsopTemplatesExcelService.test.js` | Lecture et parsing du fichier « Liste des formulaires » |
| 4 | Parseur Word | Unitaire | `backend/tests/fsopWordParser.test.js` | Extraction structure document FSOP |
| 5 | Excel mesures | Unitaire | `backend/tests/fsopExcelService.*.test.js` | En-têtes et insertion mesures |
| 6 | Cache offline | Unitaire | `frontend/tests/utils/OfflineApiCache.test.js` | Mode dégradé lecture seule |
| 7 | Parcours UI/API | E2E simulé | `frontend/tests/e2e/fsop-flow.test.js` | Chaîne templates → lots → données ; fallback offline |

## Critères d’acceptation audit

- [ ] `run-audit-tests.bat` se termine avec **SUCCES** (code 0).
- [ ] Le journal `audit-logs/audit-fsop-*.log` ne contient aucun `FAIL`.
- [ ] Les 7 étapes affichent `RESULTAT : OK` dans la console.

## Lancement manuel (optionnel)

Si besoin de relancer une seule suite :

```bat
cd backend
npx vitest run tests/fsop.routes.test.js tests/fsop.e2e.test.js --fileParallelism=false

cd ..\frontend
npx vitest run tests/utils/OfflineApiCache.test.js tests/e2e/fsop-flow.test.js
```

## Limites connues (hors périmètre de ce script)

- Ne teste **pas** la connectivité CIFS production (`/mnt/partage_fsop`, `/mnt/partage_services`).
- Ne teste **pas** l’interface graphique tablette dans un navigateur réel (pas de Playwright).
- Les écritures FSOP en production nécessitent toujours backend + partages montés (voir `backend/docs/RUNBOOK_INCIDENT_RAPIDE.md`).

## Références

- Runbook incident FSOP : `backend/docs/RUNBOOK_INCIDENT_RAPIDE.md`
- Script batch : `run-audit-tests.bat`
- Helpers de test : `backend/tests/helpers/fsopFixtures.js`, `fsopHttpTest.js`

## Historique document

| Date | Version | Auteur / note |
|------|---------|----------------|
| 2026-06-08 | 1.0 | Création suite audit FSOP + script `run-audit-tests.bat` |
