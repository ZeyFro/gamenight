# Projets à organisateur

Interrupteur : `PROJECT_ORGANIZER_ENABLED` (exactement `true`, OFF par défaut). Migration additive `20261118130600_project_entries` (deux enums, deux tables ; après #416).

## Règles
- Un projet n'est pas une équipe : pas de limite « une équipe par joueur » ; un membre actif participe à autant de projets que voulu (décision du 18/11/2026). L'équipe principale (#370) est inchangée.
- Organisateur = créateur. Il valide ou refuse chaque entrée (`ProjectEntry` PENDING → ACCEPTED/DECLINED) ; un refus est définitif, un retrait volontaire peut être redéposé. Places : `maxEntries` facultatif (organisateur non compté).
- Date de fin obligatoire (1 h à 365 jours, horloge murale Paris comme `Session.date`). À l'échéance, `/api/cron/reminders` passe le projet en CLOSED (`closedAt`) ; l'organisateur peut aussi clôturer. Plus aucune entrée une fois clos.
- Fils Discord : fil public d'annonce (texte fixe, sans mention) et fil privé (organisateur + participants validés) dans le salon des soirées de la communauté, créés à la création du projet, accès synchronisés à chaque validation ou départ. 7 jours après la clôture, les deux fils sont archivés (jamais supprimés) et le projet passe ARCHIVED ; sans fil, il passe ARCHIVED directement.
- Écritures Discord uniquement par la file : événement ADMIN de synchronisation de projet → `NotificationDelivery` (BOT) → executor (`sync_project_space`, `project-space-runner.ts`). Rien n'est créé si `NOTIFICATION_EXECUTOR_ENABLED`, le jeton du bot ou le salon des soirées manquent ; le projet reste alors utilisable sur le site.
- Notifications : in-app seulement (organisateur à chaque candidature, candidat à la décision). Aucun MP, aucun XP, aucun étage.

## Limites et choix à confirmer
- La commande Discord `/projet` reste la façade sur les équipes (#469) : elle n'est pas modifiée par cette PR (aucun enregistrement de commande). Les projets à organisateur sont gérés sur `/projets`. Une extension de la commande (entrer, valider) est possible ensuite.
- Le salon parent des fils est celui des soirées (`resolveSessionAnnounceConfig`), faute de catégorie de salon « projets ».
- Permissions du bot à vérifier avant activation : créer des fils publics et privés, gérer les fils (archivage).
