# Rapport de prévisualisation - Nettoyage des artifacts de build

## Résumé
Ce rapport liste tous les fichiers et dossiers identifiés comme **artifacts de build** (régénérables) qui peuvent être supprimés en toute sécurité.

**Total estimé à supprimer : ~5.17 MB**

---

## Fichiers et dossiers à supprimer

### 1. `backend/coverage/`
- **Type** : Dossier
- **Taille** : 4.62 MB
- **Justification** : Rapport de couverture de tests généré par Vitest/Istanbul. Régénéré lors de l'exécution des tests avec couverture.
- **Contenu** : Rapports HTML de couverture de code, fichiers JSON et LCOV

### 2. `backend/eslint-report.json`
- **Type** : Fichier
- **Taille** : 550.32 KB
- **Justification** : Rapport ESLint généré automatiquement. Régénéré lors de l'exécution d'ESLint avec option de rapport.
- **Contenu** : Rapport JSON des erreurs et avertissements ESLint

---

## Fichiers NON trouvés (mais vérifiés)
Les dossiers suivants n'existent pas dans le projet :
- `dist/` (racine, backend, frontend)
- `build/` (racine, backend, frontend)
- `out/` (racine, backend, frontend)
- `.next/` (racine, backend, frontend)
- `.nyc_output/`
- Fichiers `*.map` (source maps) en dehors de node_modules

---

## Notes importantes
- ✅ Ces fichiers sont **régénérables** et ne contiennent pas de code source
- ✅ Ils sont déjà listés dans `.gitignore` (donc non versionnés)
- ⚠️ La suppression est **irréversible** (mais les fichiers peuvent être régénérés)
- 📝 Après suppression, vous pouvez régénérer :
  - `coverage/` : en exécutant `npm test -- --coverage` dans le dossier backend
  - `eslint-report.json` : en exécutant ESLint avec l'option de génération de rapport

---

## Validation requise
**Veuillez confirmer si vous souhaitez supprimer ces fichiers/dossiers.**

Une fois validé, je procéderai à la suppression.


