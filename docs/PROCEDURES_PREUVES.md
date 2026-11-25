# Procédures de preuve : rendre vérifiable ce qui est codé ou fait côté Discord

Chaque section dit comment **prouver** un élément du [cahier final](CAHIER_FINAL.md) : prérequis, actions numérotées, résultat attendu, ce qu'il faut capturer, critère OK ou KO, retour arrière. Rédigé pour que ChatGPT ou Maxime puissent l'exécuter sans connaître le code. Les 17 éléments : C002, C003, C005, C010, C011, C045, C053, C056, C059, C093, C094, D01, D14, D15, D16, D18, D19.

**Règle de validation fonctionnelle** : une ligne passe au vert lorsque le résultat attendu est observé en Production et consigné dans le journal de [ALLUMAGES.md](ALLUMAGES.md) (date, compte, résultat, sans secret). Une capture aide à garder une trace, mais son archivage ne bloque pas un résultat directement observé. Les tests automatisés prouvent le code ; les essais réels prouvent le comportement du service.

## Règles communes

1. **Aucun secret** dans une capture, un message, une PR ou un document : jamais de jeton, de `CRON_SECRET`, de clé d'API, de chaîne de connexion. Une capture qui en montre un est refusée et refaite.
2. **Lecture seule par défaut.** Les requêtes SQL fournies sont toutes des `SELECT`, à lancer avec un accès en **lecture seule** à la base (console SQL du fournisseur de base, rôle en lecture seule). Aucune requête d'écriture n'est demandée dans ce document. Si personne d'autre n'a cet accès, c'est Maxime.
3. **Aucune écriture Discord, Vercel ou base** n'est faite par une procédure d'ici, sauf une **action humaine explicite et nommée** (par exemple « Maxime clique sur Redeploy »). Ne jamais lancer `--execute`, ni un `PUT` ou `DELETE`.
4. **Compte de test.** Quand une étape demande un membre, utiliser un compte Discord de test réel (jamais l'aperçu administrateur), membre actif du serveur The Tower et de la communauté GameNight. Pas de vraie notification Discord vers un tiers : les tests se font sur le compte de test.
5. **Journaux Vercel** : Vercel → projet → **Logs**, filtre **Request Path**, fenêtre de la **dernière heure seulement** (offre gratuite). Faire l'action, puis lire tout de suite.
6. **Captures** : image datée (date et heure visibles), nom du fichier `<Id>-AAAAMMJJ-HHMM.png`, rangée dans le dossier de preuves choisi par Maxime et citée dans le journal des allumages. Cacher les pseudos d'autres membres.
7. **Critère** : OK seulement si le **résultat attendu** est observé exactement ; sinon KO, noter l'écart observé, ne rien corriger à la main, prévenir Maxime.
8. **Retour arrière** : retirer la variable d'environnement concernée (ChatGPT, Vercel) et redéployer ; les données déjà écrites restent en base (aucune n'est dangereuse).

### Requêtes SQL de lecture seule réutilisées

Remplacer `<ID_COMMUNAUTE>` par l'identifiant de la communauté The Tower (colonne `Community.id`, obtenu par `SELECT id, name, status FROM "Community" ORDER BY "createdAt";`).

- **Livraisons de notifications par état** (C003, C093, D19) :
  `SELECT "channel", "transport", "operation", "status", count(*) FROM "NotificationDelivery" GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;`
- **Doublons d'envoi** (C003) : une même cible d'envoi (`targetSlot`) ne doit avoir qu'**un** `SEND` :
  `SELECT "targetSlot", count(*) FROM "NotificationDelivery" WHERE "operation" = 'SEND' GROUP BY 1 HAVING count(*) > 1;` : **0 ligne attendue**.
- **Livraisons en échec récentes** : `SELECT "channel", "operation", "status", "targetSlot" FROM "NotificationDelivery" WHERE "status" = 'FAILED' ORDER BY "sequence" DESC LIMIT 20;`

---

## C002 : expérience quotidienne depuis Discord (commandes, boutons, modales)

- **Ce qu'on prouve** : un membre fait son parcours Tower sans quitter Discord.
- **Tests existants** : `src/lib/discord-commands-manifest.test.ts` (manifeste et routage alignés), `src/lib/discord-tower-challenges.test.ts`, `src/lib/discord-interactions.test.ts`.
- **Prérequis** : les commandes sont enregistrées (`/aide` répond ; sinon voir [DISCORD_COMMANDES.md](DISCORD_COMMANDES.md), enregistrement par Maxime) ; `TOWER_CHALLENGES_ENABLED` vaut `true` et le drapeau communautaire est allumé ; compte de test membre actif.
- **Actions** :
  1. Dans le salon `commandes-bot`, taper `/aide`. Capturer la réponse (elle liste chaque commande et son état « actif » ou « en attente d'activation »).
  2. Taper `/tower defi`. Capturer la réponse (défi attribué ou défi en cours).
  3. Taper `/tower progression`. Capturer la réponse (étages gagnés, bouton ou consigne pour déposer la preuve).
  4. Taper `/tower classement`. Capturer la réponse.
  5. Vérifier qu'aucune réponse n'est publique par erreur : les réponses de ces commandes sont visibles du seul demandeur (« Visible uniquement par toi »).
- **Résultat attendu** : chaque commande répond en moins de 3 secondes (réponse différée « … réfléchit » puis résultat), en français, sans message d'erreur technique.
- **Critère OK** : les quatre réponses observées sont cohérentes et privées ; KO si « L'application ne répond pas », une réponse publique, ou un texte d'erreur brut.

**Observations en direct — 25/11/2026, compte Melah<3 (Régulars, The Tower).** Sous-tests passés : `/aide` liste les commandes ; `/tower defi` attribue une épreuve ; `/tower progression` renvoie la progression ; `/tower classement` affiche S3 et le classement ; les cinq réponses sont privées. Vérifications complémentaires : `/profil` renvoie le profil et `/boost` indique l'absence de boost ; le bouton « Déposer ma preuve » ouvre le formulaire avec les champs attendus, puis le formulaire est fermé sans envoi. Le test de `/tower defi` a créé une attribution pour Melah ; aucune preuve n'a été déposée.

**Verdict global C002 : ✅ Fait — essai fonctionnel en Production, 25/11/2026.** Melah (Régulars), membre réel de The Tower, a reçu en privé `/aide`, `/tower defi`, `/tower progression` et `/tower classement`. Le défi a été attribué, le bouton a ouvert le formulaire de preuve avec les champs attendus. L’essai couvre le parcours quotidien et l’interface de dépôt ; aucune preuve n’a été envoyée. L’ancienneté de trois jours et l’archivage d’une capture ne sont pas des conditions de fonctionnement.
- **Journal Vercel** (facultatif) : Request Path `/api/discord/interactions`, statuts 200 attendus.
- **Retour arrière** : sans objet (lecture seule pour `/aide`, `/tower classement` ; `/tower defi` attribue un défi au compte de test, sans conséquence).

## C003 : actions GameNight vers Discord sans doublon

- **Ce qu'on prouve** : un événement GameNight produit **un seul** message Discord, et une interaction Discord revient bien dans GameNight.
- **Tests existants** : `src/lib/notification-executor.integration.test.ts`, `src/lib/notification-delivery.integration.test.ts`, `src/lib/session-announce.integration.test.ts`.
- **Prérequis** : `NOTIFICATION_EXECUTOR_ENABLED=true`, jeton du bot présent côté serveur, tâche cron-job.org n° 1 `/api/cron/notification-executor` active ([ALLUMAGES.md](ALLUMAGES.md), « Pour ChatGPT »), annonces de soirées via le bot allumées (`DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, salon configuré).
- **Actions** :
  1. Avec le compte de test, créer une soirée de test sur le site (nom reconnaissable « TEST preuve C003 »).
  2. Attendre 2 minutes (cadence de l'executor).
  3. Capturer le salon d'annonces : **un seul** message pour cette soirée.
  4. Sur le site, modifier l'heure de la soirée ; attendre 2 minutes ; capturer : le **même** message est édité (pas de second message).
  5. Dans Discord, cliquer le bouton de participation du message ; vérifier sur le site que la participation apparaît.
  6. Lancer les requêtes SQL « Doublons d'envoi » et « Livraisons par état ».
  7. Supprimer la soirée de test sur le site.
- **Résultat attendu** : 1 message, édité et non dupliqué ; participation reflétée sur le site ; requête de doublons : **0 ligne** ; aucune livraison `FAILED` pour cette soirée.
- **Critère OK** : les quatre constats ci-dessus ; KO au moindre doublon ou échec.
- **Retour arrière** : retirer `NOTIFICATION_EXECUTOR_ENABLED` (l'executor ne réclame plus rien) ; supprimer la soirée de test.

## C005 : sept espaces et organisation du serveur (côté Discord)

- **Ce qu'on prouve** : les sept zones existent avec les salons du plan, sans toucher aux catégories protégées.
- **Référence** : [PLAN_SERVEUR_DISCORD.md](PLAN_SERVEUR_DISCORD.md) § 1 ; test `src/lib/tower-layout-dryrun.test.ts` ; outil `scripts/tower-discord-dryrun.mjs`.
- **Prérequis** : accès au serveur Discord (Maxime ou un modérateur) ; compte de test membre « Régulars ».
- **Actions** :
  1. Lancer l'inventaire **en lecture seule** : `node scripts/tower-discord-dryrun.mjs --live` depuis un poste de confiance où `DISCORD_BOT_TOKEN` et `DISCORD_BOT_GUILD_ID` sont fournis par un gestionnaire de secrets (jamais affichés ni passés en argument). Sinon, utiliser `GET /api/admin/tower-preflight` (administrateur connecté ; `TOWER_DISCORD_PREFLIGHT_ENABLED=true`).
  2. Capturer le résultat : écarts « à créer », « à corriger », « bloquants ».
  3. Avec le compte de test, parcourir le serveur et capturer la colonne des salons visibles : zones 1 à 4, 6 et 7 attendues (zone 5, `L'ASCENSION`, et zone 7 selon l'accès).
  4. Vérifier qu'aucun salon du staff n'est visible pour le compte de test.
- **Résultat attendu** : zéro écart bloquant ; les sept zones et leurs salons présents ; aucun salon staff visible.
- **Critère OK** : capture de l'inventaire sans écart bloquant + capture de la liste vue par le compte de test ; KO sinon (noter chaque salon manquant).
- **Retour arrière** : sans objet (lecture seule). Les créations manquantes se font à la main dans Discord, décision de Maxime.

## C010 : aucun nouveau rôle Discord permanent par étage

- **Ce qu'on prouve** : monter d'étage ne crée aucun rôle Discord.
- **Tests existants** : `src/lib/tower-etage-roles.test.ts`, `src/lib/tower-challenges.integration.test.ts`.
- **Prérequis** : accès en lecture au serveur Discord ; compte de test ; `TOWER_CHALLENGES_ENABLED=true`.
- **Actions** :
  1. Noter le nombre de rôles du serveur (Paramètres du serveur → Rôles) : capture « avant ».
  2. Faire gagner un étage au compte de test par la voie normale (défi puis validation) ou, à défaut, constater un étage déjà gagné.
  3. Recompter les rôles : capture « après ».
  4. Lancer l'inventaire des anciens rôles Étage (lecture seule) : `node scripts/audit-tower-etage-roles.mjs --check` (deux `GET`, aucune suppression possible dans ce script).
- **Résultat attendu** : le nombre de rôles n'a pas changé ; aucun rôle nommé « Étage N » n'a été créé.
- **Critère OK** : même nombre avant et après ; KO si un rôle apparaît.
- **Retour arrière** : sans objet.

## C011 : examen distinct des rôles techniques et historiques (côté Discord)

- **Ce qu'on prouve** : les rôles de prestige (Régulars, Irregular, Ranker, High Ranker) sont séparés des rôles techniques, staff, bots et historiques, et aucun grade ne porte de droit d'administration.
- **Référence** : [PLAN_SERVEUR_DISCORD.md](PLAN_SERVEUR_DISCORD.md) § 3 ; [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md) ; [TOWER_ROLE_REVIEW.md](TOWER_ROLE_REVIEW.md).
- **Prérequis** : Maxime (droit de lire les rôles) ; l'inventaire local de [AUDIT_DISCORD.md](AUDIT_DISCORD.md).
- **Actions** :
  1. `node scripts/audit-discord-guild.mjs --guild-id <ID_DU_SERVEUR> --out .private-audit/discord` (lecture seule, jeton en mémoire uniquement ; le dossier `.private-audit/` n'est jamais commité ni envoyé).
  2. Dans le résultat, classer chaque rôle : prestige, technique, staff, bot, jeu, équipe, historique ; relever ceux qui ont **Administrateur**, **Gérer les rôles**, **Gérer les salons**, **Gérer les messages**.
  3. Capturer le tableau récapitulatif (sans identifiants de membres).
  4. Vérifier qu'aucun des quatre grades de prestige n'a l'un de ces droits.
- **Résultat attendu** : les quatre grades sans droit de gestion ; les rôles techniques regroupés et nommés ; liste des rôles historiques à revoir.
- **Critère OK** : tableau capturé et les quatre grades sans droit sensible ; KO sinon (noter le rôle fautif, ne rien modifier sans décision de Maxime).
- **Retour arrière** : sans objet (lecture seule).

## C045 : saisons accessibles aux arrivants tardifs

- **Ce qu'on prouve** : un membre arrivé en cours de saison joue la saison courante, sans rattrapage ni blocage.
- **Tests existants** : `src/lib/tower-season-rules.test.ts`, `src/lib/tower-standings.test.ts`, `src/lib/tower-challenge-seasons.test.ts`.
- **Prérequis** : un compte de test **nouvellement** membre (arrivé après le début de la saison) ; `TOWER_CHALLENGES_ENABLED=true`. La saison courante est S3 jusqu'au 30 novembre 2026, puis S1 (1ᵉʳ décembre 2026 au 31 mars 2027).
- **Actions** :
  1. Avec le compte de test, ouvrir `https://gamenight-zeyfro.vercel.app/tower` : capturer le nom de la saison et la progression.
  2. Taper `/tower defi` : capturer le défi attribué.
  3. Lecture seule : `SELECT "userId", "floorsClimbed" FROM "TowerChallengeProgress" WHERE "communityId" = '<ID_COMMUNAUTE>' ORDER BY "floorsClimbed" DESC LIMIT 20;` : le compte de test apparaît avec 0 étage au départ, sans erreur.
  4. Le 1ᵉʳ décembre 2026 (minuit, heure de Paris) : rouvrir `/tower` et capturer le passage à « S1 · 2026-2027 ».
- **Résultat attendu** : saison unique affichée, défi attribuable, pas de message « saison terminée » ou « inscription fermée » pour l'arrivant.
- **Critère OK** : captures 1, 2 et 4 conformes ; KO si le compte de test est bloqué.
- **Retour arrière** : sans objet.

## C053 : salons vocaux (côté Discord)

- **Ce qu'on prouve** : groupes de jeu, équipes, événements et vocaux temporaires fonctionnent sur le vrai serveur.
- **Tests existants** : `src/lib/session-space-plan.test.ts`, `src/lib/discord-team-space-queue.test.ts`, `src/lib/discord-team-space-runner.test.ts`, `src/lib/discord-team-space-service.test.ts` (créations par la file, jamais en direct).
- **Prérequis** : `SESSION_VISIBILITY_ENABLED=true` et `DISCORD_TEAM_SPACES_ENABLED=true` (lot D et E de [ALLUMAGES.md](ALLUMAGES.md)), `NOTIFICATION_EXECUTOR_ENABLED=true`, jeton du bot, salon des soirées, `communityTeamsEnabled`, permissions du bot « Gérer les salons » et « Gérer les rôles » (voir [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md)).
- **Actions (équipe)** :
  1. Avec le compte de test, créer une équipe de test sur le site (nom « TEST preuve C053 »).
  2. Attendre 2 minutes ; capturer le **salon textuel privé et le salon vocal privé** créés, et le rôle d'équipe (visibles seulement du rôle).
  3. Requête : `SELECT "teamId", "channelId", "voiceChannelId", "roleId", "archived" FROM "DiscordTeamSpace" WHERE "communityId" = '<ID_COMMUNAUTE>' ORDER BY "createdAt" DESC LIMIT 5;` : une ligne pour l'équipe de test.
- **Actions (soirée)** :
  4. Créer une soirée de test dans 40 minutes, publique ou privée. À T-30 min, capturer le fil privé et le vocal privé créés.
  5. Terminer la soirée ; vérifier que les espaces temporaires sont supprimés quand le vocal est vide.
- **Résultat attendu** : espaces créés **par la file** (aucun salon créé tant que l'executor n'a pas tourné), privés, supprimés ou archivés ensuite ; jamais de suppression d'un rôle ou salon préexistant.
- **Critère OK** : captures 2, 4 et 5 conformes et ligne SQL présente ; KO sinon.
- **Retour arrière** : retirer les deux variables ; archiver l'équipe de test sur le site (les salons d'équipe sont renommés « archivé », jamais supprimés : nettoyage manuel par Maxime).

## C056 : rôles de prestige séparés des rôles techniques ; permissions sensibles vérifiées avant application

- **Tests existants** : `src/lib/tower-layout-permissions.test.ts`, `src/lib/tower-layout-dryrun.test.ts`.
- **Ce qu'on prouve** : le plan de permissions refuse toute permission sensible avant application.
- **Prérequis** : poste de confiance (lecture seule), aucune application de plan prévue.
- **Actions** :
  1. Lire le plan dans [PLAN_SERVEUR_DISCORD.md](PLAN_SERVEUR_DISCORD.md) § 3 (grades et droits).
  2. Lancer `node scripts/tower-discord-dryrun.mjs --inventory <inventaire.json> --strict` (hors ligne, aucun appel Discord ; l'inventaire vient de l'étape C011) et capturer la sortie : les écarts de permissions sensibles y sont listés comme bloquants et `--strict` sort en code 1 s'il en reste.
  3. Reprendre la liste des rôles de l'étape C011 et confirmer qu'aucun grade de prestige n'a de permission sensible.
- **Résultat attendu** : aucun grade avec Administrateur, Gérer les rôles, Gérer les salons, Gérer les messages, Exclure, Bannir.
- **Critère OK** : sortie capturée sans écart bloquant ; KO sinon.
- **Retour arrière** : sans objet (lecture seule).

## C059 : bot (commandes, boutons, menus, défis, preuves, votes, progression, événements, notifications), côté Discord

- **Ce qu'on prouve** : le parcours complet d'un défi sur le vrai serveur.
- **Tests existants** : `src/lib/discord-tower-challenges.test.ts`, `src/lib/tower-discord-votes.integration.test.ts`, `src/lib/tower-challenge-voting.test.ts`.
- **Prérequis** : lot B de [ALLUMAGES.md](ALLUMAGES.md) allumé (`TOWER_CHALLENGES_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`, `TOWER_DISCORD_VOTES_ENABLED`, salon des preuves), executor actif ; **deux** comptes de test : un auteur, un votant membre depuis au moins 3 jours.
- **Actions** :
  1. L'auteur tape `/tower defi` puis réalise le défi, puis `/tower progression` et dépose la preuve avec consentement de publication. Capturer.
  2. Dans le salon des preuves : le message public avec les boutons ✅ et ❌ et un fil de discussion. Capturer.
  3. Le votant clique ✅ (la preuve d'un autre) : le compteur de votants change, le message est **édité**. Capturer. L'auteur ne peut pas voter pour lui-même : tenter, capturer le refus.
  4. Attendre le résultat (quorum de 3 votants ou fin de délai) : message mis à jour, boutons retirés, étage crédité, MP de l'auteur envoyé par la file.
  5. `SELECT "status", count(*) FROM "NotificationDelivery" WHERE "channel" = 'DISCORD_DM' GROUP BY 1;` : aucun `FAILED` inexpliqué.
- **Résultat attendu** : parcours complet sans erreur ; un seul message par preuve ; étage crédité une seule fois.
- **Critère OK** : captures 1 à 4 conformes et SQL sans échec ; KO sinon.
- **Retour arrière** : retirer `TOWER_DISCORD_VOTES_ENABLED` (retour au vote sur le site) ; l'étage de test reste (sans conséquence).

**Essai ciblé en production — 25/11/2026, Melah<3 (Régulars)** : `/aide`, `/profil`, `/boost`, `/tower defi`, `/tower progression` et `/tower classement` ont répondu en privé et en français. Le bouton « Déposer ma preuve » a ouvert le formulaire (lien, code/description, consentement). Le formulaire a été fermé sans envoi ; aucun vote ni preuve n'a été soumis. Cela confirme seulement ces contrôles ciblés, pas le critère C059 : aucun défi n'a été réalisé, et les étapes de preuve publique, vote avec un second membre, résultat et requête SQL restent non vérifiées. Les captures de l'essai ne sont pas conservées dans le dépôt.

## C093 : écritures Discord par la file et l'executor, jamais en direct

- **Ce qu'on prouve** : aucune action GameNight n'écrit sur Discord sans passer par `NotificationEvent` / `NotificationDelivery`.
- **Tests existants** : `src/lib/write-surface-inventory.test.ts` (inventaire des surfaces d'écriture), `src/lib/discord-role-command.test.ts`, `src/lib/notification-executor.integration.test.ts`.
- **Prérequis** : lecture seule de la base ; accès aux journaux Vercel.
- **Actions** :
  1. Lancer `node scripts/inventory-write-surface.mjs --check=docs/LIVRAISON-BARRIERE.md` (lecture du code, aucun réseau) : la sortie doit dire que l'inventaire est à jour.
  2. Avec le compte de test, déclencher une écriture Discord (par exemple créer une soirée annoncée par le bot). Journal Vercel, Request Path de la route de création : **aucun appel direct** à l'API Discord dans la requête ; l'envoi apparaît ensuite dans les journaux de `/api/cron/notification-executor`.
  3. Requête « Livraisons par état » : une ligne `SENT` correspondante.
- **Résultat attendu** : l'écriture passe par la file ; la livraison est `SENT` après le passage de l'executor.
- **Critère OK** : étapes 1 à 3 conformes ; KO si un message part sans ligne de file.
- **Retour arrière** : sans objet.

## C094 : aucune IA ne valide une preuve ; récompenses cosmétiques

- **Ce qu'on prouve** : la validation d'une preuve est humaine (votes) ou mesurée (Steam), jamais par un modèle ; les récompenses sont cosmétiques.
- **Tests existants** : `src/lib/no-ai-validation.test.ts` (aucune dépendance ni appel à un service d'IA générative dans le code), `src/lib/tower-challenge-voting.test.ts`, `src/lib/tower-ranks.test.ts`.
- **Prérequis** : aucun.
- **Actions** :
  1. Lancer `npx vitest run src/lib/no-ai-validation.test.ts` : vert.
  2. Lire [TOWER_STEAM_AUTOVALIDATE.md](TOWER_STEAM_AUTOVALIDATE.md) : la mesure Steam est un calcul sur les compteurs Steam, avec fenêtre de doute et vote communautaire.
  3. Capturer la page `/tower` d'un compte de test : les récompenses affichées (titres, cadres) n'ont aucun effet de jeu.
- **Résultat attendu** : test vert, documentation conforme.
- **Critère OK** : test vert et capture ; KO si une dépendance d'IA apparaît (échec du test).
- **Retour arrière** : sans objet.

## D01 : scope OAuth `connections` demandé seulement avec consentement, facultatif

- **Tests existants** : `src/lib/discord-connections.test.ts`, `src/auth.connections.test.ts`.
- **Prérequis** : `DISCORD_CONNECTIONS_SCOPE_ENABLED=true`, compte de test, un compte Discord avec au moins une connexion liée (Steam, Xbox…).
- **Actions** :
  1. Connexion ordinaire avec le compte de test : sur l'écran d'autorisation de Discord, capturer les permissions demandées : **identify, email, guilds** seulement, **pas** « connexions ».
  2. Sur `https://gamenight-zeyfro.vercel.app/profil/parametres`, trouver l'encart d'import facultatif ; cliquer sur le bouton de consentement. L'écran d'autorisation Discord demande alors « connexions » : capturer.
  3. Refuser sur Discord : retour sur le site sans erreur et sans import. Capturer.
  4. Recommencer et accepter : les valeurs arrivent comme **suggestions** préremplies et modifiables. Capturer.
  5. Vérifier qu'aucun jeton n'est conservé : la table des suggestions n'a que les colonnes utilisateur, plateforme et valeur. Lecture seule : `SELECT "platform", count(*) FROM "PlatformConnectionSuggestion" GROUP BY 1;` (jamais de `SELECT *` affiché dans une capture).
- **Résultat attendu** : le scope n'est demandé qu'après le clic de consentement ; refus sans conséquence.
- **Critère OK** : captures 1 à 4 conformes ; KO si « connexions » est demandé à la connexion ordinaire.
- **Retour arrière** : retirer la variable ; les suggestions déjà importées restent modifiables.

## D14 : commande « Signaler » → ticket privé du staff, aucune sanction automatique, journalisé

- **Tests existants** : `src/lib/discord-report-command.test.ts`.
- **Prérequis** : `DISCORD_REPORT_COMMAND_ENABLED=true`, `DISCORD_REPORT_STAFF_CHANNEL_ID` posé, executor actif, bot dans le salon du staff, commande enregistrée ; compte de test membre actif.
- **Actions** :
  1. Un **autre** compte de test poste un message anodin « TEST signalement » dans un salon de test.
  2. Le compte signaleur : clic droit sur le message → Applications → **Signaler**. Capturer la réponse privée (« ton signalement a été transmis en privé au staff »).
  3. Dans le salon du staff, après 2 minutes : capturer le ticket (extrait du message, lien, aucune mention). Aucune sanction ni suppression n'a eu lieu : capturer le message d'origine toujours présent.
  4. Signaler une seconde fois le même message : réponse « déjà signalé ». Signaler son propre message : refus. Capturer.
  5. `SELECT "guildId", "channelId", "messageId", "excerpt", "ticketQueuedAt", "closedAt" FROM "ModerationReport" ORDER BY "createdAt" DESC LIMIT 5;` : une ligne avec `ticketQueuedAt` renseigné.
- **Résultat attendu** : ticket privé reçu, journal en base, aucune sanction automatique, doublon et auto-signalement refusés.
- **Critère OK** : captures 2 à 4 et ligne SQL ; KO sinon.
- **Retour arrière** : retirer `DISCORD_REPORT_COMMAND_ENABLED` ; le ticket de test peut être clos par le staff.

## D15 : boosters (rôle « Soutien de la Tour », badge, mur des soutiens, salons réservés, retrait automatique)

- **Tests existants** : `src/lib/booster-support.test.ts`.
- **Prérequis** : `DISCORD_BOOSTERS_ENABLED=true`, `NOTIFICATION_EXECUTOR_ENABLED=true`, bot avec « Gérer les rôles » et « Gérer les salons » ; tâche cron-job.org n° 14 (`/api/cron/booster-sync`, toutes les 30 minutes) ; un compte de test qui **booste réellement** le serveur (action humaine de Maxime, coût d'un boost Nitro : à décider ; à défaut, la preuve reste partielle).
- **Actions** :
  1. Maxime fait booster le serveur par le compte de test. Attendre le prochain passage de `booster-sync` (30 minutes au plus).
  2. Capturer : le rôle « Soutien de la Tour » **sans aucune permission** sur le compte de test ; le badge sur le profil du site ; la page `https://gamenight-zeyfro.vercel.app/soutiens` (compte de test affiché ; profils masqués exclus).
  3. Capturer les deux salons réservés (écrit et vocal) visibles du seul rôle.
  4. `SELECT "discordId", "boosting", "roleGranted", "since", "endedAt" FROM "BoosterSupport" WHERE "communityId" = '<ID_COMMUNAUTE>' ORDER BY "updatedAt" DESC LIMIT 5;`
  5. Retrait : fin du boost (ou retrait du boost par Maxime) ; après le passage suivant, le rôle est retiré ; `boosting` passe à faux et `endedAt` est renseigné.
- **Résultat attendu** : rôle attribué puis retiré automatiquement, jamais de permission, jamais d'XP ni d'avantage de jeu.
- **Critère OK** : captures 2, 3 et 5 + SQL ; KO sinon.
- **Retour arrière** : retirer `DISCORD_BOOSTERS_ENABLED` ; le rôle et les deux salons ne sont jamais supprimés par le code (nettoyage manuel si voulu).

## D16 : V2 (bot gateway permanent, rangs importés), documentation seulement

- **Ce qu'on prouve** : la V2 est **décrite** et **non** livrée ; rien ne l'active par erreur.
- **Preuve dans le dépôt** : [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md) § 27.3 (ligne « v2 ») ; [CAHIER_FINAL.md](CAHIER_FINAL.md) ligne C101 (« feuille de route, après le lancement » : décision du 23/11/2026) ; `docs/CAHIER_FINAL.md` précise qu'aucun interrupteur n'existe.
- **Actions** :
  1. Lire les deux passages ci-dessus et vérifier qu'ils disent la même chose (V2 après lancement).
  2. `grep -n "gateway permanent" docs/CAHIER_DES_CHARGES.md docs/CAHIER_FINAL.md` : les deux fichiers répondent.
  3. Vérifier dans Discord que le bot n'a **pas** l'intention « présences » ni « membres » activée dans le portail développeur (action humaine de Maxime, capture du portail sans jeton).
- **Résultat attendu** : documentation cohérente ; aucune intention de passerelle superflue.
- **Critère OK** : étapes 1 à 3 ; KO si une intention privilégiée est active sans besoin.
- **Retour arrière** : sans objet.

## D18 : rappel : suppression des 134 rôles Étage avant la création automatique de rôles (action manuelle)

- **Tests existants** : `src/lib/tower-etage-roles.test.ts`.
- **Prérequis** : Maxime ; `DISCORD_ROLE_AUTOCREATE_ENABLED` **éteint** tant que la suppression n'est pas faite ([DISCORD_ROLE_AUTOCREATE.md](DISCORD_ROLE_AUTOCREATE.md)).
- **Actions** :
  1. Inventaire en lecture seule : `node scripts/audit-tower-etage-roles.mjs --check` (aucune suppression possible). Capturer le nombre de rôles Étage et leurs dépendances (salons qui les citent).
  2. **Action humaine de Maxime dans Discord** : supprimer les rôles Étage un lot à la fois, après avoir vérifié qu'aucun salon n'en dépend. Capturer le compteur de rôles avant et après.
  3. Relancer l'inventaire : 0 rôle Étage ; total de rôles du serveur sous 200 (alerte à 80 % de 250 : [DISCORD_ROLE_AUTOCREATE.md](DISCORD_ROLE_AUTOCREATE.md)).
  4. Seulement ensuite, ChatGPT peut allumer `DISCORD_ROLE_AUTOCREATE_ENABLED` (lot G).
- **Résultat attendu** : zéro rôle Étage, marge de rôles suffisante.
- **Critère OK** : inventaire à 0 ; KO s'il reste des rôles ou si le total est trop haut.
- **Retour arrière** : un rôle supprimé ne se restaure pas : c'est pourquoi l'inventaire des dépendances précède la suppression.

## D19 : tous les interrupteurs éteints par défaut ; écritures Discord par la file et l'executor

- **Tests existants (preuve dans le dépôt)** : `src/lib/env-example-no-secrets.test.ts` (`.env.example` : aucune valeur allumée hors liste), `src/lib/claude-md-switches.test.ts`, `src/lib/discord-role-command.test.ts`, `src/lib/notification-executor.integration.test.ts`, `src/lib/write-surface-inventory.test.ts`.
- **Prérequis** : Vercel en lecture (ChatGPT).
- **Actions** :
  1. `npx vitest run src/lib/env-example-no-secrets.test.ts src/lib/write-surface-inventory.test.ts` : verts.
  2. Dans Vercel → Settings → Environment Variables (Production), lister les variables `*_ENABLED` présentes et leur état « valeur cachée » : comparer avec le lot allumé le plus récent du journal des allumages ([ALLUMAGES.md](ALLUMAGES.md)). Toute variable allumée hors lot est KO.
  3. Pour l'écriture par la file : section C093.
- **Résultat attendu** : seuls les interrupteurs des lots allumés sont présents.
- **Critère OK** : tests verts et liste Vercel conforme au journal ; KO si une variable inconnue est allumée.
- **Retour arrière** : retirer la variable fautive et redéployer.

---

## Tableau récapitulatif

| Id | Section | Qui | Preuve dans le dépôt | Preuve à capturer |
| --- | --- | --- | --- | --- |
| C002 | C002 | Maxime | `discord-commands-manifest.test.ts` | Captures `/aide`, `/tower …` |
| C003 | C003 | ChatGPT + Maxime | `notification-executor.integration.test.ts` | Soirée de test, SQL doublons |
| C005 | C005 | ChatGPT + Maxime | `tower-layout-dryrun.test.ts` | Inventaire et vue du compte de test |
| C010 | C010 | Maxime | `tower-etage-roles.test.ts` | Compte de rôles avant/après |
| C011 | C011 | Maxime | : | Tableau des rôles |
| C045 | C045 | Maxime | `tower-season-rules.test.ts` | `/tower` d'un arrivant, 1ᵉʳ décembre |
| C053 | C053 | ChatGPT + Maxime | tests des espaces | Salons d'équipe et de soirée |
| C056 | C056 | Maxime | `tower-layout-permissions.test.ts` | Sortie du diff |
| C059 | C059 | ChatGPT + Maxime | tests des votes Discord | Parcours d'un défi |
| C093 | C093 | ChatGPT | `write-surface-inventory.test.ts` | Inventaire, SQL de la file |
| C094 | C094 | Maxime | `no-ai-validation.test.ts` | Test vert |
| D01 | D01 | Maxime | `discord-connections.test.ts` | Écrans d'autorisation |
| D14 | D14 | Maxime | `discord-report-command.test.ts` | Ticket du staff |
| D15 | D15 | Maxime | `booster-support.test.ts` | Boost réel (décision de coût) |
| D16 | D16 | Maxime | documentation | Portail développeur |
| D18 | D18 | Maxime | `tower-etage-roles.test.ts` | Inventaire à 0 |
| D19 | D19 | ChatGPT | `env-example-no-secrets.test.ts` | Liste Vercel |
