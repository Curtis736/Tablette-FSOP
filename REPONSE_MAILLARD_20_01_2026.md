Bonjour M. MAILLARD,

Merci pour votre retour. J'ai corrigé les trois points que vous avez soulevés :

**1. Unité de ProductiveDuration :**
L'unité est bien les minutes. L'incohérence sur l'enregistrement 21 a été corrigée (ProductiveDuration était à 49 au lieu de 1). J'ai créé des scripts de vérification et correction pour garantir la cohérence des durées.

**2. ProductiveDuration = 0 pour les enregistrements non traités :**
C'est normal : les enregistrements non consolidés ont ProductiveDuration = 0. Le système consolide automatiquement les opérations terminées avant le transfert, ce qui calcule correctement ProductiveDuration. Les enregistrements avec ProductiveDuration = 0 ne peuvent plus être transférés à SILOG (validation ajoutée).

**3. Phase et CodeRubrique depuis V_LCTC :**
Corrigé. Les valeurs sont maintenant récupérées depuis V_LCTC (SEDI_2025) à l'identique, sans transformation ni fallback. J'ai exécuté une migration SQL pour corriger les données existantes et les colonnes sont maintenant NOT NULL.

**Résultat :**
- Les durées sont cohérentes (ProductiveDuration = TotalDuration - PauseDuration en minutes)
- Phase et CodeRubrique proviennent de V_LCTC à l'identique
- Les heures s'affichent correctement (problème de timezone résolu)

L'application est prête pour vos tests. Les données générées seront conformes aux exigences de SILOG.

N'hésitez pas si vous avez d'autres questions.

Cordialement,
