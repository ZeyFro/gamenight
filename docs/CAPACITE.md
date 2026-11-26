# Capacité GameNight × The Tower — offres gratuites uniquement

> Relevé documentaire du 26 novembre 2026. Les plafonds ci-dessous proviennent des pages officielles de Vercel et Neon ; ils peuvent évoluer. Aucun service payant n’est retenu ni proposé. Les seuils d’alerte servent à limiter le risque de coupure, pas à garantir une capacité en nombre de membres.

## Principes d’exploitation

- Conserver uniquement les offres gratuites existantes.
- Ne pas convertir une consommation estimée en « nombre de membres supportés » : le trafic réel et le coût par action doivent être mesurés.
- Examiner chaque semaine l’usage Vercel, Neon et cron-job.org. Utiliser en priorité les alertes déjà disponibles et les outils gratuits.
- Ne pas activer de tâches, flags ou notifications automatiquement à cause d’un seuil.
- À 70 %, analyser les tâches fréquentes et requêtes coûteuses ; à 85 %, réduire la charge non essentielle de façon contrôlée ; à 95 %, geler l’ouverture de nouveaux accès et prévenir Maxime. Ne jamais changer Production automatiquement.
- Si un plafond gratuit est atteint, le service peut être limité jusqu’au renouvellement du quota. Le plan de continuité est de réduire les tâches et usages facultatifs, pas de passer à une offre payante.

## Vercel Hobby

Plafonds gratuits documentés : 4 heures de CPU actif par mois, 360 GB-heures de mémoire provisionnée, 1 million d’invocations, 100 Go de transfert rapide, et 6 000 minutes de build. Les journaux d’exécution Hobby sont conservés une heure. Dépasser une limite peut empêcher l’usage jusqu’à la période suivante. L’offre Hobby est destinée à un usage personnel et non commercial : l’adéquation du projet à ses conditions doit être vérifiée dans le cadre de l’ouverture.

| Mesure | Alerte de suivi | Action graduée, sans achat |
| --- | ---: | --- |
| CPU actif (4 h/mois) | 50 % / 70 % / 85 % / 95 % | Vérifier la durée et la fréquence des fonctions ; à 85 %, suspendre l’ouverture progressive et réduire les traitements non essentiels après validation. |
| Invocations (1 M/mois) | 50 % / 70 % / 85 % / 95 % | Repérer les appels cron et les navigations qui répètent des requêtes ; espacer uniquement les tâches non critiques après validation. |
| Transfert rapide (100 Go/mois) | 50 % / 70 % / 85 % / 95 % | Mesurer les pages et médias les plus lourds ; limiter le chargement non nécessaire et différer les médias facultatifs. |
| Builds (6 000 min/mois) | 70 % / 85 % / 95 % | Éviter les déploiements répétés et les builds inutiles ; garder les contrôles obligatoires. |
| Journaux (1 h) | Vérification hebdomadaire et après incident | Exporter ou consigner sans données personnelles les éléments utiles dans la fenêtre disponible ; utiliser les alertes existantes. |

Les seuils sont des niveaux d’alerte proposés, pas des plafonds supplémentaires du fournisseur. La consultation des pages Usage et des alertes intégrées ne nécessite aucun abonnement.

## Neon Free

Le plan gratuit documente 100 CU-heures de calcul par projet et par mois, 1 Go de stockage par projet, une mise en veille après cinq minutes d’inactivité par défaut, une capacité maximale de 2 CU et six heures d’historique Instant Restore. Le nombre de branches disponibles dépend du quota affiché pour le projet ; ne pas créer de branche de recette sans vérifier ce quota et l’isolation préalable.

| Mesure | Alerte de suivi | Action graduée, sans achat |
| --- | ---: | --- |
| Calcul (100 CU-h/projet/mois) | 50 % / 70 % / 85 % / 95 % | À 70 %, identifier les réveils fréquents ; réduire les appels périodiques non indispensables après validation. |
| Stockage (1 Go/projet) | 50 % / 70 % / 85 % / 95 % | Mesurer les tables qui croissent et appliquer uniquement les règles de rétention déjà approuvées ; aucune suppression de sauvegarde. |
| Mise en veille (5 min par défaut) | Contrôle hebdomadaire | Éviter les sondes trop fréquentes qui maintiennent le calcul éveillé. |
| Restauration (6 h) | Rappel de limite, pas une alerte d’usage | Les tests de lecture n’exigent pas de pg_dump ni de restauration. Toute opération risquée suit une protection et une autorisation dédiées. |

## Tâches planifiées et code

- Examiner la fréquence réelle des cronjobs et leur consommation Vercel/Neon ; supprimer aucun job sans analyse d’impact.
- Garder les contrôles de sécurité et de migration obligatoires. Éviter les exécutions répétées qui ne produisent pas de preuve nouvelle.
- Utiliser les budgets et limites d’exécution déjà présents dans le code. Réduire les appels SQL répétés, limiter les résultats paginés et ne charger les médias qu’à la demande.
- L’alerte gratuite existante de surveillance d’hébergement ne sera considérée opérationnelle qu’après vérification de ses mesures, de son seuil et de sa destination. Ne pas envoyer d’alerte à des membres Discord.

## Limites de l’estimation

Aucun seuil fixe de membres n’est annoncé : il dépend des pages consultées, des tâches en arrière-plan, des médias et des connexions. Les valeurs d’usage réelles du projet doivent être relevées chaque semaine avant d’augmenter progressivement le nombre de membres.

## Sources officielles

- [Vercel — Limits](https://vercel.com/docs/limits)
- [Vercel — Hobby Plan](https://vercel.com/docs/plans/hobby)
- [Neon — Free plan reaches 1 GB per project](https://neon.com/blog/neon-free-plan-1-gb-per-project)
- [Neon — Free plan guidance, November 2026](https://neon.com/blog/how-to-make-the-most-of-neons-free-plan)
