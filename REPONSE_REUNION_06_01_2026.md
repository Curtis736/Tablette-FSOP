Réponse à la synthèse de réunion du 06/01/2026

De : Curtis Robert KUMBI
À : Jean Marc SOREL, Franck MAILLARD
Date : 2026-01-07
Objet : Point d'avancement suite à la réunion du 06/01/2026

Bonjour,

Voici le point d'avancement suite à la réunion :

Ce qui a été fait :

1. AB_COMMENTAIRES_OPERATEURS : Colonnes QteNonConforme et Statut ajoutées
2. ABTEMPS_OPERATEURS : Colonnes Phase, CodeRubrique et StatutTraitement ajoutées
3. Vues SQL pour SILOG : V_RESSOURC et V_LCTC créées avec tables de mapping temporaires
4. Fonctionnalité Monitoring : Correction, suppression, validation et transmission implémentées
5. Déclenchement EDI_JOB : Service et routes API créés, prêt à être utilisé

Ce qui a été volontairement omis :

- Colonne QteProd dans ABHISTORIQUE_OPERATEURS
- Colonne QteProd dans ABTEMPS_OPERATEURS

Raison : Cette fonctionnalité de saisie de quantité produite n'est pas nécessaire pour le fonctionnement actuel de l'application.

À faire par Franck MAILLARD :

1. Créer l'EDI_JOB dans SILOG qui exécutera la remontée des temps de production dans les tables standard de la base de données SILOG
2. Implémenter dans SILOG les colonnes StatutOperateur et DateConsultation dans les tables/vues des opérateurs et lancements

Note : Des tables de mapping temporaires ont été créées dans SEDI_APP_INDEPENDANTE pour permettre le fonctionnement de l'application en attendant l'implémentation dans SILOG.

Question pour Jean Marc SOREL :

Souhaitez-vous renommer la base de données SEDI_APP_INDEPENDANTE ? Si oui, quel nom préférez-vous ? Le changement peut être fait facilement via la variable d'environnement DB_DATABASE.

Je reste à votre disposition pour toute question.

Cordialement,
Curtis Robert KUMBI
