# Recette finale GameNight — état et critères

Audit documentaire réconcilié le 19 octobre 2026 avec `origin/main` à `b30e8ef` (PR #281–284 fusionnées). Ce document compare le code et ses tests aux parcours décrits dans README.md, ROADMAP.md et .env.example. La vérification publique Firecrawl et les refus Vercel 403 décrits plus bas sont historiques, depuis un autre poste; ils n’ont pas été rejoués sur le portable 1. Les parcours authentifiés, les migrations distantes et les flags Preview/Production restent non vérifiés ici. La CI et la preview vertes de #284 ne prouvent pas ces parcours.

## Comment lire les états

- Livré et testé : code présent et couvert par les validations automatisées du dépôt. Cela ne prouve pas que le parcours a été exécuté avec un compte Discord réel ni que la configuration de production l’active.
- Livré mais désactivé : le code existe; flag, secret, migration ou réglage humain manque ou n’a pas pu être confirmé.
- Partiellement livré : le parcours existe pour une partie du besoin; les limites restantes sont énumérées ci-dessous.
- Non implémenté : aucun parcours fonctionnel livré pour ce sous-périmètre.

La colonne Livraison de ROADMAP.md décrit la fonctionnalité. Sa colonne Statut reste le suivi de la PR et ne vaut pas validation de disponibilité.

## Validation locale ciblée — portable 1, 19 octobre 2026

- Base de code : `b30e8ef`, avec les corrections documentaires de cette reprise. Aucune correction applicative nécessaire après ces tests.
- Destination vérifiée avant migration et tests : nouveau conteneur `gamenight-portable1-pg`, image `postgres:16-alpine` (PostgreSQL 16.15), port hôte `127.0.0.1:55440`, base `gamenight_portable1_test`. Les 107 migrations existantes ont été appliquées. L’ancien `gamenight-test-pg` reste arrêté et intact; le service local 5432 n’est pas utilisé.
- `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55440/gamenight_portable1_test npx vitest run src/lib/session-availability-poll.integration.test.ts src/lib/game-library.integration.test.ts src/lib/game-suggestions.integration.test.ts --no-file-parallelism --maxWorkers=1` : **39 tests réussis, aucun ignoré**. Ces scénarios vérifient notamment la conversion concurrente en une seule soirée avec invitations exactes, l’intersection des possessions sélectionnées et les refus de jeux/catégories dans les suggestions. Les accès réseau sont interdits par les doubles de test.
- Tests ciblés de `session-availability-poll.test.ts`, `game-preferences.test.ts`, pages bibliothèque groupe/suggestions et actions de préférences : **28 tests réussis, aucun ignoré**, cinq fichiers exécutés en série.
- Limite : ces intégrations et tests de pages ne constituent pas une recette dans un navigateur connecté à Discord. Aucun message réel ni écriture de production; aucune variable d’isolation déployée modifiée. Les valeurs ON/OFF des scénarios d’isolation sont des simulations locales au processus de test.
- Preview : les métadonnées listent un déploiement Ready de #284, tête `cbfccc66`; la lecture du projet avec le scope `mpmaximeparisot-6230s-projects` retourne **403 forbidden**, et le recours CLI échoue car `vercel` n’est pas installé sur ce poste. Neon liste `production` comme branche par défaut prête, `preview-gamenight` archivée et une sauvegarde. Le rattachement DB de la Preview et ses migrations n’ont donc pas été établis : **aucune recette avec écriture n’y a été lancée**.

## Inventaire fonctionnel

| Fonction | État | Utilisable dans le code livré | Configuration nécessaire | Reste à développer ou valider |
|---|---|---|---|---|
| Catalogue, bibliothèque personnelle et inventaire | Livré et testé | Catalogue global, bibliothèque personnelle, import Steam et intersection exacte des possessions sélectionnées; bibliothèque collective, possesseurs et compteurs scopés quand l’isolation est active | Connexion Steam; périmètre global historique si isolation OFF | Recette authentifiée et multi-compte non vérifiée; garder l’isolation désactivée |
| Wishlist | Livré et testé | Ajout et suivi communautaire par jeu | Vérifier l’activation et les migrations déployées dans Vercel | Recette authentifiée et vérification de l’isolation en environnement de test |
| Carnet des joueurs | Livré et testé | Commandes, plateformes, micro et identifiants PSN/Xbox/Switch/Epic/Battle.net déclaratifs sur le profil | Connexion, profil et migration des identifiants | Recette authentifiée non vérifiée; les identifiants hors Steam ne sont pas des liaisons OAuth ni des preuves de propriété |
| Préférences et refus | Livré et testé | Préférences, refus de catégories et jeux nommés utilisés dans /bibliotheque/suggestions pour les participants choisis | Migrations correspondantes; pas de flag dédié | Recette authentifiée non vérifiée; votes et roulettes ne sont pas modifiés par ce parcours |
| Préparation d’un jeu | Livré mais désactivé | Coût, prix, volume, plateforme, source et durée estimée sur une fiche possédée | GAME_PREPARATION_TIME_ENABLED pour la durée | Les valeurs sont déclarées par des membres, sans import officiel ni garantie de fraîcheur |
| Checklist de soirée | Livré mais désactivé | Installation, mise à jour, micro et lobby pour une soirée planifiée | SESSION_PREPARATION_ENABLED et migration session_preparation | Activer seulement après vérification de la migration et des communautés |
| Organisation et disponibilités | Partiellement livré | Suggestions, sondage collectif avec réponses individuelles et conversion en soirée; séries hebdomadaires/mensuelles | Compte connecté et migration session_availability_polls | Recette authentifiée non vérifiée; édition groupée des séries non livrée |
| Roulette | Livré et testé | Roulette de base, pondération tierlist et évitement des jeux récents | État des flags non confirmé | Filtre par nombre de joueurs et veto exigent ROULETTE_PLAYER_FILTER_ENABLED et VOTE_VETO_ENABLED |
| Récompenses et engagement | Livré mais désactivé | Notes, quêtes, boutique XP; saisie de présence | Réglages communauté pour bonus/malus; état de production non vérifié | Les récompenses présence sont désactivées par défaut; aucune transaction financière |
| Wishlist et achats à plusieurs | Partiellement livré | Votes d’intérêt et plan indicatif | COMMUNITY_ISOLATION_ENABLED ne doit pas être activé avant la fin des contrôles; flags d’alertes à vérifier | Aucun paiement, engagement financier ou achat automatique |
| Offres et promotions | Partiellement livré | Prix Steam consultables; curation manuelle d’offres gratuites possible | Flags d’alertes/executor; configuration production à vérifier | Publication automatique des offres gratuites : Non implémenté |
| Tournois | Livré mais désactivé | Création, bracket et tirage des équipes; annonces possibles | TOURNAMENT_PREDICTIONS_ENABLED, TOURNAMENT_SCORES_ENABLED et configuration Discord pour les sous-parcours concernés | Les pronostics et la saisie de scores sont off par défaut; aucun essai Discord authentifié |
| Lore et contenu communautaire | Livré mais désactivé | Chroniques, expressions, épitaphes, sondages et highlights ont du code et des tests | Flags de chaque domaine et migrations correspondantes | Activer après revue des flags et test d’accès multi-compte; aucun parcours réel vérifié |
| Guide par serveur | Livré et testé | Règles et contacts éditables par admin, affichés dans /guide | COMMUNITY_ADMIN_ENABLED pour l’édition, migration et contenu saisi; affichage selon la communauté résolue | Recette authentifiée non vérifiée; aucune activation de l’isolation dans cette reprise |
| Calendrier | Partiellement livré | Téléchargement ponctuel iCal des soirées et dates serveur | Session authentifiée | Abonnement calendrier avec mises à jour : Non implémenté |
| Galerie privée | Partiellement livré | Images JPEG/PNG/GIF/WebP et clips MP4, limites communes de 4 Mo/8 médias, consentement, accès participant et lecture Range | SESSION_MEDIA_BLOB_TOKEN, SESSION_VIDEO_ENABLED exact `true` et activation admin de la galerie | Clips désactivés par défaut; aucun codec/durée garanti; purge séparée différée; état distant de l’activation non vérifié |
| Accueil | Partiellement livré | Accueil courant; variantes récentes présentes dans le code | HOME_V2_ENABLED pour /accueil-v2 | HOME_V2_ENABLED est désactivé par défaut; comparaison authentifiée manquante |
| Mobile et notifications | Livré mais désactivé | Interface web responsive/PWA shell; code Web Push | WEB_PUSH_ENABLED et paire VAPID persistante | Abonnement Push jamais vérifié sur un appareil; expérience navigateur authentifiée manquante |
| Application hors ligne | Partiellement livré | Seule la page de secours /offline.html est livrée | Aucune | Application et données hors ligne : Non implémentées; aucune donnée privée ne doit être mise en cache sans décision sécurité |
| Connexion et actions Discord | Livré mais désactivé | OAuth, commandes et intégrations ont du code et des tests automatisés | Connexion Discord humaine; installation bot, permissions, clés, salons et flags concernés | Vérifier le bouton vocal, les annonces et les commandes sur un serveur de recette; messages personnalisés et règles de ping restent à valider |

## Sous-périmètres explicitement incomplets

| Sous-périmètre | État |
|---|---|
| Clips vidéo dans la galerie | Non implémenté |
| App et données réellement utilisables sans réseau | Non implémenté; seul le fallback offline existe |
| Abonnement iCal continu | Non implémenté |
| Publication automatique des offres Epic/Steam gratuites | Non implémenté; la curation manuelle existe |
| Édition groupée des séries récurrentes | Non implémenté |
| Paiement/achat groupé intégré | Non implémenté |

## Recette navigateur authentifiée à exécuter

### Préconditions et sécurité

1. Utiliser un déploiement Preview et une communauté Discord de recette avec données jetables. Ne pas faire les actions d’écriture ci-dessous en Production.
2. Garder COMMUNITY_ISOLATION_ENABLED désactivé en Production. Le README documente une couverture d’isolation encore partielle; l’activer prématurément peut exposer des données d’une communauté aux membres d’une autre.
3. Pour une recette réelle, ouvrir l’URL Preview du projet GameNight et cliquer « Se connecter avec Discord ». Autoriser l’application avec le compte de recette, puis attendre le retour sur GameNight. Ne pas transmettre de mot de passe, code OAuth ou cookie dans le chat.
4. Préparer deux comptes de test membres de communautés distinctes. Vérifier les refus d’accès croisés avant toute activation limitée de l’isolation, sur Preview seulement et après revue de docs/COMMUNITY_ROLLOUT.md.
5. Vérifier les migrations Preview avant les parcours checklist, chroniques, calendrier, pronostics, scores, galerie et Push. Le statut des migrations distantes n’est pas accessible dans cette session.

### Ordinateur — 1440 × 900

- Se connecter; vérifier retour à l’accueil, navigation, session active et communauté affichée.
- Profil : modifier matériel, plateformes et micro; vérifier l’affichage aux membres autorisés.
- Bibliothèque : importer ou ouvrir les jeux, consulter une fiche, ajouter/retirer un jeu de la wishlist. Ne pas comparer des communautés sans protocole d’isolation sur Preview.
- Préparation : vérifier la saisie coût/volume/source; si le flag checklist est autorisé sur Preview, remplir une checklist puis vérifier qu’un second compte ne peut pas la modifier.
- Organisation : créer une soirée, consulter les disponibilités, créer une série, télécharger l’iCal et vérifier une seule occurrence exportée.
- Roulette : tester tirage standard; vérifier filtre de joueurs et veto uniquement si les flags correspondants sont activés sur Preview.
- Engagement : noter une soirée terminée, consulter XP/badges et saisie de présence sans déclencher d’envoi Discord réel.
- Tournoi : créer un tournoi de recette; tester scores/pronostics uniquement si flags et migrations sont confirmés.
- Lore et communauté : créer puis supprimer un élément de recette; vérifier auteur, membre et administrateur sur deux comptes.
- Galerie : vérifier consentement, limites d’images, accès d’un participant, refus d’un non-participant et suppression. Aucun test de clip vidéo.
- Discord : valider le salon vocal et les messages avec un administrateur de recette; désactiver les destinations de production.

### Mobile — 390 × 844

- Refaire connexion OAuth puis vérifier retour, navigation basse, menus, modales et absence de défilement horizontal.
- Refaire les parcours profil, bibliothèque, création/rejoindre une soirée, roulette, tournoi, calendrier iCal et galerie.
- Vérifier permission Push seulement après configuration VAPID sur Preview; refuser la permission doit laisser le reste de l’application utilisable.
- Désactiver le réseau uniquement pour confirmer l’affichage de /offline.html. Ne pas conclure que l’application fonctionne hors ligne.
- Capturer une capture d’écran pour chaque défaut et relever appareil, navigateur, largeur, URL Preview et identifiant de recette.

### État de cette recette

Recette publique exécutée via la session interactive Firecrawl. Ordinateur : la page d’accueil s’ouvre sans erreur, titre GameNight et bouton Discord visibles. Mobile : largeur CSS observée 375 px, document scrollWidth 375 px (pas de débordement horizontal), bouton Discord présent (224 × 44 px). Parcours authentifiés et actions d’écriture non exécutés; connexion Discord humaine attendue. Playwright n’est pas installé dans le dépôt; Firecrawl fournit le navigateur distant utilisé.

## Inventaire des flags par environnement

Les noms ci-dessous sont ceux présents dans .env.example et le code. Pour les flags booléens, une valeur absente ou différente de la chaîne exacte true laisse la fonction désactivée. Le fichier .env local n’a pas été consulté; l’état réel de l’environnement local est donc inconnu. En CI, les suites utilisent des valeurs de test isolées et ne reflètent pas Vercel. Preview et Production sont inconnus : les deux connexions Vercel renvoient 403 au scope mpmaximeparisot-6230s-projects. Les appels ont utilisé l’accès métadonnées seulement; aucun secret n’a été lu.

| Flag | Fonction / condition documentée | Local par défaut | CI | Preview | Production |
|---|---|---|---|---|---|
| COMMUNITY_ADMIN_ENABLED | Onglet d’administration des communautés; nécessite droits admin et accès Discord aux salons | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| COMMUNITY_AUTO_CREATE_ENABLED | Création de communauté PENDING; webhook Discord signé et cron requis | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| COMMUNITY_CHANNELS_ENABLED | Salons Discord par communauté; nécessite configuration des salons | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| COMMUNITY_EXPRESSIONS_ENABLED | Expressions/running gags; migration community_expressions | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| COMMUNITY_GAME_GRAVEYARD_ENABLED | Épitaphes; migration community_game_epitaphs | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| COMMUNITY_HIGHLIGHTS_ENABLED | Hall of Fame/Shame; migration community_highlights | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| COMMUNITY_ISOLATION_ENABLED | Filtrage des domaines collectifs par memberships actifs; couverture documentée partielle | OFF si absent | Scénarios dédiés | Inconnu (403) | Inconnu (403); ne pas activer |
| COMMUNITY_PICKER_ENABLED | Choix de communauté; migration add_user_active_community et isolation effective requises | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| COMMUNITY_QUICK_POLLS_ENABLED | Sondages éclair; migration community_quick_polls | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| COMMUNITY_SETUP_COMMAND_ENABLED | /gamenight setup; permission Discord et clé de signature requises | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| CSP_REPORT_ENABLED | Réception des rapports CSP; config endpoint | OFF si absent | Stubs/tests ciblés | Inconnu (403) | Inconnu (403) |
| DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED | Invitations « Jouer maintenant » par MP; bot Discord requis | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| DISCORD_BOT_SESSION_ANNOUNCE_ENABLED | Annonces de soirées; bot, serveur et salon requis | OFF si absent | Stubs/intégration | Inconnu (403) | Inconnu (403) |
| DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED | Annonces de tournoi; bot, serveur et salon requis | OFF si absent | Stubs/intégration | Inconnu (403) | Inconnu (403) |
| DISCORD_DM_ROULETTE_ENABLED | Nouveaux MP de roulette; bot requis | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| DISCORD_DM_SESSION_ENABLED | Nouveaux MP de soirée; chemin annonce bot requis | OFF si absent | Stubs/intégration | Inconnu (403) | Inconnu (403) |
| DISCORD_DM_TOURNAMENT_ENABLED | Nouveaux MP tournoi; bot requis | OFF si absent | Tests ciblés; stubs si concernés | Inconnu (403) | Inconnu (403) |
| DISCORD_THREAD_CLEANUP_ENABLED | Nettoyage des fils Discord; mode dry-run par défaut | OFF si absent | Tests isolés | Inconnu (403) | Inconnu (403) |
| DISCORD_THREAD_CLOSE_ON_END_ENABLED | Fermeture du fil à la fin; nettoyage en mode execute requis | OFF si absent | Tests isolés | Inconnu (403) | Inconnu (403) |
| GAME_PREPARATION_TIME_ENABLED | Durée estimée de préparation | OFF si absent | Tests ciblés | Inconnu (403) | Inconnu (403) |
| GUIDE_V2_ENABLED | Sections « Jouer maintenant » et « Tournois » du guide | OFF si absent | Tests ciblés | Inconnu (403) | Inconnu (403) |
| HOME_V2_ENABLED | Route alternative /accueil-v2 | OFF si absent | Tests de page | Inconnu (403) | Inconnu (403) |
| NOTIFICATION_EXECUTOR_ENABLED | Envoi des notifications en file; route cron et CRON_SECRET requis | OFF si absent | Tests d’intégration isolés | Inconnu (403) | Inconnu (403) |
| PAGE_TITLES_DYNAMIC_ENABLED | Titres dynamiques; exige PAGE_TITLES_ENABLED | OFF si absent | Tests unitaires | Inconnu (403) | Inconnu (403) |
| PAGE_TITLES_ENABLED | Titres de pages | OFF si absent | Tests unitaires | Inconnu (403) | Inconnu (403) |
| RETENTION_CLEANUP_ENABLED | Purge de rétention; mode dry-run par défaut | OFF si absent | Tests isolés | Inconnu (403) | Inconnu (403) |
| ROULETTE_PLAYER_FILTER_ENABLED | Filtre joueurs, relance sans doublon; pas de migration | OFF si absent | Tests dédiés | Inconnu (403) | Inconnu (403) |
| SESSION_CHRONICLES_ENABLED | Chroniques; migration session_chronicles | OFF si absent | Tests Postgres dédiés | Inconnu (403) | Inconnu (403) |
| SESSION_PREPARATION_ENABLED | Checklist de soirée; migration session_preparation | OFF si absent | Tests Postgres dédiés | Inconnu (403) | Inconnu (403) |
| SKIP_LINK_ENABLED | Lien d’évitement du contenu principal pour navigation clavier | OFF si absent | Tests UI ciblés | Inconnu (403) | Inconnu (403) |
| STEAM_NOW_PLAYING_ENABLED | Présence Steam dans /potes; migration steam_now_playing et clé Steam requises | OFF si absent | Tests isolés | Inconnu (403) | Inconnu (403) |
| TOURNAMENT_PREDICTIONS_ENABLED | Pronostics; migration tournament_predictions | OFF si absent | Tests Postgres dédiés | Inconnu (403) | Inconnu (403) |
| TOURNAMENT_SCORES_ENABLED | Saisie de scores; migration tournament_match_scores | OFF si absent | Tests unitaires/Postgres | Inconnu (403) | Inconnu (403) |
| VOTE_VETO_ENABLED | Veto de vote/roulette; migrations add_session_veto et add_roulette_veto | OFF si absent | Tests isolés | Inconnu (403) | Inconnu (403) |
| WEB_PUSH_ENABLED | Web Push; exige WEB_PUSH_VAPID_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY et migration web_push_subscriptions | OFF si absent | Tests avec clés de test | Inconnu (403) | Inconnu (403) |

Configuration sensible séparée des flags : SESSION_MEDIA_BLOB_TOKEN pour la galerie, trois paramètres WEB_PUSH_VAPID_* pour Push, clés/jeton Discord et CRON_SECRET pour les intégrations/routes. Seuls les noms sont consignés ici; aucune valeur n’a été consultée ni copiée.

## Diagnostic Vercel — procédure minimale

Les deux connexions ont été testées séparément : MCP Vercel et Vercel dans codex_apps. Les deux identifient le même compte Vercel, puis échouent avec 403 sur l’accès au projet au scope mpmaximeparisot-6230s-projects. Le compte observé est mpmaximeparisot-6230; son équipe par défaut est team_gho4DTcbV8MSZicSAIroYF9c. Le refus demande une réauthentification vers ce scope. Aucun reconnect n’a été lancé.

Procédure unique si l’accès aux environnements est nécessaire : reconnecter une seule des deux intégrations que l’on souhaite conserver, choisir le compte mpmaximeparisot-6230 puis le scope/équipe mpmaximeparisot-6230s-projects, vérifier que le projet gamenight y est inclus, puis effectuer un seul appel de lecture des métadonnées d’environnements avec déchiffrement désactivé. Si l’appel passe, ne pas reconnecter l’autre intégration. S’il renvoie encore 403, arrêter et faire vérifier l’appartenance/portée du projet dans le tableau de bord Vercel; ne pas répéter les reconnexions.

Action humaine Discord requise : dans cette même session Firecrawl, clique « Se connecter avec Discord », autorise GameNight avec un compte de test, puis attends le retour sur GameNight. Ne partage aucun secret OAuth et ne crée/modifie aucune donnée de production. Les parcours authentifiés reprendront dans la session après confirmation.
