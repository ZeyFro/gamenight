# Sondages de disponibilités — O01

## Parcours livré dans ce lot

Depuis `/sessions`, l’organisateur ouvre **Préparer une soirée**, choisit les participants, saisit au moins deux créneaux ou ajoute des suggestions calculées à partir des disponibilités existantes, puis crée le sondage. Ces suggestions restent indicatives : elles ne créent aucune réponse.

Chaque participant répond pour lui-même par créneau (oui, peut-être ou non), peut modifier ou effacer sa réponse, et voit les réponses explicites des autres participants. Une absence de réponse reste distincte d’un non. Le créateur peut fermer les réponses et choisir un créneau futur. Ce choix crée une seule vraie `Session`, avec les invitations exactes du sondage et la deadline de vote.

Les notifications internes non-bot respectent les préférences `SESSION` et sont écrites atomiquement avec la conversion ; le bot conserve son outbox transactionnel existant. Les récompenses existantes sont exécutées après le commit et peuvent être rejouées sans double gain. Le parcours n’envoie aucun appel Discord depuis une transaction.

Les pages de sondage sont privées au créateur et aux participants. Les lectures et écritures vérifient la communauté active et les appartenances dans la transaction ; les créations de membership concurrentes sont bloquées pendant la validation du roster. Dans `default` avec isolation OFF, les comptes historiques sans membership restent acceptés, mais un membership explicitement révoqué est refusé. Toute autre communauté exige un membership ACTIVE même sous OFF.

## Données et règles

- Le sondage porte un `communityId` obligatoire, y compris pour `default`.
- Les participants sont explicites et le créateur doit en faire partie. La limite est 100 participants distincts.
- Une réponse référence un créneau et un participant du même sondage par clés étrangères composées. Le choix ne peut pointer vers un créneau étranger.
- Les options ont une durée positive en base. La saisie accepte 2 à 28 options uniques, de 60/90/120/180 minutes, dans les 90 prochains jours.
- Le titre comporte au maximum 120 caractères.
- Le classement compte les réponses explicites : oui décroissants, puis peut-être décroissants. Les ex æquo partagent leur rang ; date et identifiant ne servent qu’à stabiliser l’affichage.
- Les dates suivent l’horloge murale existante ; une option peut traverser minuit.
- La migration additive `20261015100000_session_availability_polls` ajoute quatre tables et deux enums sans transformer ni supprimer de données.
- Le reçu `CreationIntent` rend la création du sondage idempotente. Le `chosenSlotId` conservé empêche une seconde conversion même si la soirée créée est supprimée plus tard.

## Validation

Prisma a validé le schéma, et les 79 migrations ont été appliquées à la base Postgres locale dédiée `gamenight_o01_test`. TypeScript, ESLint et les 15 tests purs/guards passent. La suite d’intégration O01 passe 11/11 sur cette base dédiée, après une reproduction ciblée 1/1 du cas de reprise. L’ancienne base partagée `gamenight_test` contenait des lignes `Community` résiduelles (`id` `a` et `b`) malgré le `TRUNCATE` du fixture; l’erreur exacte était `AvailabilityPollError: Ce sondage n'est plus accessible.` dans `lockedPoll`. L’erreur ne se reproduit pas après migration sur la base vierge. Le build Webpack final passe et génère les trois routes du sondage.

La relecture fonctionnelle a demandé d’exposer la reprise même sans paramètre d’erreur; c’est corrigé. La relecture sécurité ne trouve plus de défaut P0–P2. La PR brouillon attend la stabilisation et la validation Postgres. Le navigateur automatisé n’est pas disponible dans cette session. Aucun Discord réel n’a été contacté.
