# Activation de la Tour en une soirée

Décision du propriétaire du 17 novembre 2026. Elle remplace « un interrupteur par jour » : les 4 interrupteurs sont conservés mais activés le même soir.

> **Pas-à-pas détaillé, pour quelqu'un qui n'a jamais ouvert Vercel ni Neon :** [SOIREE_ACTIVATION.md](SOIREE_ACTIVATION.md) (ordre de la soirée, gestes exacts, vérifications et retours arrière en une minute).

## Prérequis

- Migrations Tower appliquées en Production (voir [MIGRATIONS.md](MIGRATIONS.md)).
- Commandes `/tower` et `/tower-admin` enregistrées sur le serveur The Tower. Corriger d'abord le 403 : réinviter l'application (`scope=bot applications.commands`, permissions minimales de `src/lib/discord-setup-permissions.ts`), relancer l'enregistrement et lire le champ `code` de la réponse.
- `NOTIFICATION_EXECUTOR_ENABLED=true` (sans lui, rien n'est envoyé).

## Le soir de l'activation

1. Vercel : `TOWER_CHALLENGES_ENABLED=true` et `TOWER_DISCORD_ANNOUNCE_ENABLED=true`, avec **un seul redéploiement**.
2. Base de Production, drapeau communautaire :
   ```sql
   UPDATE "Community" SET "towerChallengesEnabled" = true WHERE "discordGuildId" = '553922938101825536';
   ```
3. Sur Discord : `/tower-admin importer`, puis `/tower-admin importer-equipe` (voir « Catalogue saison 1 » ci-dessous).

## Catalogue saison 1

Les deux commandes n'importent pas de fichier fourni à l'exécution : elles lisent des tableaux TypeScript du dépôt, regroupés par `src/lib/tower-challenge-import-packs.ts`. Aucun argument n'est à saisir.

| Commande | Fichiers lus | Contenu |
| --- | --- | --- |
| `/tower-admin importer` | `tower-challenge-starter-catalogue.ts` (26 défis de départ) + **`tower-s1-solo-catalogue.ts`** | +60 défis solo : 20 faciles (+1 étage), 25 moyens (+2), 15 difficiles (+3) |
| `/tower-admin importer-equipe` | `tower-team-challenge-starter-catalogue.ts` (10) + **`tower-s1-team-catalogue.ts`** | +20 défis d'équipe : 6 faciles, 9 moyens, 5 difficiles (équipes activées pour la communauté) |

- Format d'une entrée : `title`, `instructions`, `rewardFloors` (barème décidé : 1, 2 ou 3). Pas de champ de difficulté séparé.
- Limites : titre 120 caractères, consigne 1500 (colonnes VarChar et parseur de `/tower-admin ajouter`) ; les tests limitent le barème S1 à 1-3.
- Idempotent : déduplication sur le titre (insensible à la casse) par communauté et par mode ; un second passage ajoute 0 défi et ne réactive aucun défi désactivé. Les titres S1 sont distincts de ceux du pack de départ (test).
- Chaque consigne porte les règles du cahier §18-20 : preuve postérieure à l'attribution, exploit jamais réutilisé d'un autre défi, aucun achat requis (jeu gratuit accepté), aucune validation par IA. `src/lib/tower-s1-catalogue.test.ts` les contrôle avec le parseur réel.
- L'import n'envoie aucune annonce. Contrôle ensuite : `/tower-admin defis page:1` (12 défis par page).

## Contrôle

- `/tower` répond et affiche le catalogue importé.
- Une annonce de test part dans le salon configuré via la file existante.
- Aucune erreur dans les logs Vercel ni dans l'executor.

## Retour arrière

| Élément | Action |
| --- | --- |
| Annonces | `TOWER_DISCORD_ANNOUNCE_ENABLED` retiré ou ≠ `true`, redéploiement |
| Parcours de défis | `TOWER_CHALLENGES_ENABLED` retiré ou ≠ `true`, redéploiement |
| Communauté | `UPDATE "Community" SET "towerChallengesEnabled" = false WHERE "discordGuildId" = '553922938101825536';` |
| Catalogue importé | Conservé ; aucune suppression nécessaire |

---

# Plan de la soirée d'activation (lancement de la semaine du 1er décembre 2026)

> Plan de préparation, pas une exécution : rien n'a été activé, aucune commande Discord enregistrée, aucune variable Vercel modifiée. Chaque action réelle reste exécutée par Maxime (ou sous son accord explicite). Statut de chaque fonction : [CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md). Textes à publier : [LANCEMENT_DISCORD.md](LANCEMENT_DISCORD.md).

## Les 4 interrupteurs et leur ordre

Le texte de décision du 17/11 parle de « 4 interrupteurs » sans les nommer ; la section ci-dessus ne décrit que trois actions. Lecture retenue ici (**à confirmer par Maxime**) :

| N° | Interrupteur | Où | Obligatoire le soir ? |
| --- | --- | --- | --- |
| 1 | `TOWER_CHALLENGES_ENABLED=true` | Vercel Production | Oui |
| 2 | `TOWER_DISCORD_ANNOUNCE_ENABLED=true` | Vercel Production (même redéploiement que le 1) | Oui |
| 3 | `Community.towerChallengesEnabled = true` | Base de Production, serveur The Tower | Oui |
| 4 | `TOWER_TEAM_DAILY_ENABLED=true` | Vercel Production **et** variable GitHub Actions du même nom | **Non, tant que les conditions de l'interrupteur 4 ne sont pas remplies** |

Prérequis hors interrupteurs : `NOTIFICATION_EXECUTOR_ENABLED=true` ; `CRON_SECRET` défini ; commandes `/tower` et `/tower-admin` visibles.

Pourquoi cet ordre : 1 et 2 partent ensemble (un seul redéploiement) mais ne servent à rien sans 3 ; 3 est la porte d'accès par communauté (jamais une autre communauté) ; l'import du catalogue exige 1 et 3 ; 4 est le dernier car il génère des attributions automatiques.

## Prérequis à cocher avant la soirée

- [x] Pile de PR (#370, #406, #407, #408, #416) et lots Tower 2.0 / v1.1 fusionnés sur `main` (20/11/2026). Reste à relire le dernier run « Migrations Production » (environnement `production-migrations`) avant la soirée : [MIGRATIONS.md](MIGRATIONS.md).
- [ ] Application GameNight réinvitée avec `applications.commands` ; `node scripts/register-tower-guild-commands.mjs --check` (lecture seule) lu, puis `--execute` par Maxime ; `--check` relancé ; commandes visibles pour un compte membre et un compte modérateur.
- [ ] Salons configurés : `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID`, `TOWER_DISCORD_GENERAL_CHANNEL_ID` renseignés (valeurs jamais dans le dépôt).
- [ ] Arbitre indépendant désigné (obligatoire avant d'annoncer les contestations).
- [ ] Valeurs précédentes relevées (pour le retour arrière) : environnement ET base.
- [ ] Catalogue relu ([TOWER_SAISON1_CATALOGUE_30.md](TOWER_SAISON1_CATALOGUE_30.md)) : le code contient 26 + 60 défis solo et 10 + 20 d'équipe (116 défis, voir « Catalogue saison 1 » ci-dessus), et non 30 : valider avant l'import.
- [ ] Textes de [LANCEMENT_DISCORD.md](LANCEMENT_DISCORD.md) relus, étiquettes mises à jour.

## Qui fait quoi

| Rôle | Actions |
| --- | --- |
| Maxime (propriétaire) | Seul à modifier Vercel, la base de Production, Discord (enregistrement des commandes, publication des messages) ; décide du go/no-go. |
| Claude (ce dépôt) | Prépare et relit les documents, vérifie l'état du code et des PR ; n'écrit rien sur Discord, Vercel ni Neon. |
| Arbitre indépendant | Joignable pendant la soirée ; ne vote pas ; tranche toute contestation (dès qu'elle est livrée). |
| Testeurs réels (3 au moins, hors auteur) | Compte non modérateur : un défi, une preuve, trois votes distincts. Aucun faux compte. |

## Déroulé (ordre exact)

| Étape | Action | Qui | Contrôle immédiat |
| --- | --- | --- | --- |
| H+0 | Relever les valeurs actuelles des interrupteurs et du flag communautaire | Maxime | Notées sans secret |
| H+0:15 | Interrupteurs 1 et 2 sur Vercel Production, **un seul redéploiement** | Maxime | Déploiement READY, aucune erreur de build |
| H+0:30 | Interrupteur 3 (requête SQL ci-dessus) | Maxime | 1 ligne mise à jour, aucune autre communauté |
| H+0:40 | `/tower-admin importer` puis `/tower-admin importer-equipe` | Maxime | Rapport « ajouté / déjà présent » ; relancer = 0 ajout (idempotence) |
| H+0:50 | Section « Contrôle » ci-dessus, avec un compte non modérateur | Maxime + testeur | `/tower` répond, catalogue visible |
| H+1:10 | Parcours réel : défi, preuve, 3 votes distincts, récompense, quota | Testeurs | Étages crédités une seule fois |
| H+1:40 | Interrupteur 4 seulement si ses prérequis sont remplis ; observer le premier passage du cron | Maxime | `enabled=true`, `failed=0`, `complete=true` |
| H+2:00 | Go/no-go ; annonce d'ouverture publiée **seulement si tout est vert** | Maxime | Étiquettes du guide à jour |

### Condition de l'interrupteur 4 (défi d'équipe quotidien)

L'attribution est alignée sur la décision : **18:00 Europe/Paris** (workflow `.github/workflows/tower-team-daily.yml`, cron `0 16,17 * * *` avec contrôle de l'heure de Paris ; [TOWER_TEAM_DAILY_CRON.md](TOWER_TEAM_DAILY_CRON.md)) ; les règles d'équipe 2–8 / équipe unique (#370) sont sur `main`. À ne pas activer tant que : la variable GitHub `GAMENIGHT_CRON_BASE_URL` et le secret `CRON_SECRET` ne sont pas définis ; la variable GitHub `TOWER_TEAM_DAILY_ENABLED` et la variable Vercel du même nom ne sont pas posées **ensemble** ; le premier passage n'a pas été observé en lecture. Sinon, laisser OFF et garder la ligne « défi d'équipe » en [PRÉVUE] dans les textes.

## Contrôles supplémentaires

- Aucune erreur dans les logs Vercel ni dans l'executor (`/api/cron/notification-executor`, réponse 202, résultat dans les logs).
- Une seule annonce par réussite, sans doublon.
- Un compte d'une autre communauté ne voit aucune donnée de The Tower.
- Aucun rôle Discord ni permission modifié (les rangs restent affichés dans GameNight).
- Plafond de 2 réussites par jour et délai de 12 h vérifiés une fois chacun.

## Arrêt et retour arrière

Arrêt immédiat si : donnée d'une autre communauté, récompense double, annonce en boucle, erreur 5xx persistante. Ne rien supprimer ; défaire dans l'ordre inverse.

| Ordre | Action |
| --- | --- |
| 1 | `UPDATE "Community" SET "towerChallengesEnabled" = false WHERE "discordGuildId" = '553922938101825536';` : coupe l'accès sans redéploiement ; à faire en premier si l'incident touche les données |
| 2 | Interrupteur 4 : `TOWER_TEAM_DAILY_ENABLED` retiré ou ≠ `true` |
| 3 | `TOWER_DISCORD_ANNOUNCE_ENABLED` et `TOWER_CHALLENGES_ENABLED` retirés ou ≠ `true`, un redéploiement |
| 4 | Annonce erronée déjà partie : supprimée à la main par Maxime ; ne pas rejouer la file |
| 5 | Catalogue, étages et preuves conservés (aucune suppression) |

Les migrations ne se défont pas par ce plan : suivre [MIGRATIONS.md](MIGRATIONS.md) et [TOWER_SNAPSHOT_RESTORE_PROCEDURE.md](TOWER_SNAPSHOT_RESTORE_PROCEDURE.md).

---

# Ordre d'activation des interrupteurs (état de `main` au 20/11/2026)

> Document de préparation : **rien n'est activé**, aucune variable Vercel ni variable GitHub Actions n'est modifiée par ce document. Tous les interrupteurs ci-dessous sont **OFF par défaut** : actifs seulement si la valeur vaut exactement `true`. **Rien ne s'active sur une Preview** : l'activation se fait en Production, par Maxime, jamais par Claude. Les 33 PR du lot Tower 2.0 et du cahier v1.1 sont fusionnées sur `main` ; le détail par sujet est dans [COUVERTURE_CAHIER.md](COUVERTURE_CAHIER.md), le sujet A à O dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md) §27. Un interrupteur n'est utilisable que si sa migration est appliquée en Production (run « Migrations Production » vert, voir [MIGRATIONS.md](MIGRATIONS.md)) ; sans elle la fonction répond `migration_required` et n'écrit rien.
>
> L'ordre ci-dessous est **à confirmer par Maxime**. Il suit un risque croissant : lecture ou cosmétique d'abord, puis écritures applicatives, puis messages Discord, puis création de fils, salons ou rôles, et enfin ce qui touche la connexion ou le plafond de rôles du serveur.

## Prérequis généraux

1. Migrations appliquées en Production avant tout interrupteur qui en dépend (colonne « Migration » ci-dessous).
2. `NOTIFICATION_EXECUTOR_ENABLED=true` et `CRON_SECRET` défini : toute écriture Discord (MP, fils, rôles, salons, messages) passe par la file et l'executor. Sans l'executor rien n'est envoyé.
3. **`DISCORD_ROLE_AUTOCREATE_ENABLED` : ne pas l'activer tant que les 134 rôles Étage ne sont pas supprimés.** Le serveur est proche du plafond Discord de 250 rôles ; la suppression est une action manuelle du propriétaire, jamais faite par le dépôt (inventaire : `scripts/audit-tower-etage-roles.mjs`, [TOWER_ROLE_REVIEW.md](TOWER_ROLE_REVIEW.md)).
4. Bot avec les droits nécessaires : gestion des salons et des rôles, **placé au-dessus des rôles d'équipe** dans la hiérarchie (sinon Discord refuse la synchronisation).
5. Un groupe à la fois, avec observation (logs Vercel, executor, `failed=0` sur les crons concernés) avant le suivant.

**Retour arrière commun à tous les interrupteurs** (sauf mention contraire) : retirer la variable ou la passer à une valeur différente de `true`, puis redéployer. Les données restent ; les migrations ne se défont pas (voir [MIGRATIONS.md](MIGRATIONS.md) et [TOWER_SNAPSHOT_RESTORE_PROCEDURE.md](TOWER_SNAPSHOT_RESTORE_PROCEDURE.md)). Les messages, fils, salons et rôles déjà créés sur Discord ne sont jamais supprimés automatiquement : un nettoyage éventuel est manuel, par Maxime, sur ID exact.

## Groupe 1 — Les 4 interrupteurs Tower (soirée d'activation)

Décision du 17/11 : activés le même soir, selon le déroulé ci-dessus. Les interrupteurs 1 à 3 sont obligatoires ; le 4 est conditionné.

| N° | Variable | Effet attendu | Retour arrière |
| --- | --- | --- | --- |
| 1 | `TOWER_CHALLENGES_ENABLED=true` (Vercel Production) | Parcours de défis : `/tower`, `/ascension`, attribution, preuve, vote, étages | Variable retirée ou ≠ `true`, redéploiement |
| 2 | `TOWER_DISCORD_ANNOUNCE_ENABLED=true` (Vercel Production, même redéploiement que le 1) | Annonces de preuves (avec consentement) et de réussites dans les salons configurés, via la file | Variable retirée ou ≠ `true`, redéploiement |
| 3 | `Community.towerChallengesEnabled = true` (base de Production, serveur The Tower uniquement) | Porte d'accès par communauté : sans elle, 1 et 2 n'ont aucun effet | `UPDATE "Community" SET "towerChallengesEnabled" = false WHERE "discordGuildId" = '553922938101825536';` (sans redéploiement ; à faire en premier si l'incident touche les données) |
| 4 | `TOWER_TEAM_DAILY_ENABLED=true` à **deux** endroits : Vercel Production **et** variable GitHub Actions du même nom | Défi d'équipe quotidien attribué à **18:00 Europe/Paris** (cron `GET /api/cron/tower-team-daily`, workflow `tower-team-daily.yml`) ; exige aussi `TOWER_CHALLENGES_ENABLED` et le flag communautaire | Les deux variables retirées ou ≠ `true` ; attributions déjà faites conservées |

Conditions du n° 4 : variable GitHub `GAMENIGHT_CRON_BASE_URL` (origine HTTPS) et secret `CRON_SECRET` définis ; règles d'équipe 2–8 (#370, sur `main`) ; première exécution observée (`enabled=true`, `failed=0`, `complete=true`). Voir [TOWER_TEAM_DAILY_CRON.md](TOWER_TEAM_DAILY_CRON.md).

Interrupteurs Tower qui s'ajoutent à ces quatre, tous conditionnés par `TOWER_CHALLENGES_ENABLED` (groupes 2 et 3 ci-dessous) : `TOWER_IRREGULAR_GRANTS_ENABLED`, `TOWER_CHALLENGE_REPLACEMENT_ENABLED`, `TOWER_CHALLENGE_PROPOSALS_ENABLED`, `TOWER_SEASON_AWARDS_ENABLED`, puis `TOWER_DISCORD_VOTES_ENABLED` et `TOWER_STEAM_AUTOVALIDATE_ENABLED` (groupe 4).

## Groupe 2 — Lecture et cosmétique (aucune écriture Discord)

| Variable | Effet attendu | Dépendances | Migration |
| --- | --- | --- | --- |
| `ADMIN_DASHBOARD_V2_ENABLED` | `/admin/tableau-de-bord` : candidatures en attente, opérations Discord échouées, espaces archivés, contestations, rôles/salons contre les limites Discord ; **lecture seule**, admins ; éteint = 404. Sert à surveiller la suite | aucune | aucune |
| `PROFILE_VISIBILITY_ENABLED` | Masquer son profil dans Potes | — | `20261118103100_profile_visibility` |
| `GAME_LEVELS_ENABLED` | Niveau de jeu auto-déclaré par jeu, dans le profil | — | `20261118123100_user_game_levels` |
| `TEAM_RECRUITMENT_CRITERIA_ENABLED` | Objectifs et critères de recrutement d'une équipe | `communityTeamsEnabled` | `20261118123000_team_recruitment_criteria` |
| `TOWER_IRREGULAR_GRANTS_ENABLED` | Irregular attribué à la main par le staff (`/admin/tower-irregular`), prestige sans droit | `TOWER_CHALLENGES_ENABLED` | `20261118122000_tower_irregular_grants` |
| `TOWER_SEASON_AWARDS_ENABLED` | Titres et cadres cosmétiques saisonniers pour les 3 premiers du palmarès (cron `notification-executor`) | `TOWER_CHALLENGES_ENABLED` | `20261118122300_tower_season_awards` |
| `PROFILE_CUSTOMIZATION_ENABLED` | Pseudo, cartes, cadres, bannières, effets, titre, vitrine de badges ; décoratif uniquement | à placer après les titres et cadres saisonniers qu'il met en valeur | `20261118131300_profile_customization` |

Retour arrière : retirer la variable ; l'affichage disparaît, les choix des membres restent en base.

## Groupe 3 — Écritures applicatives, sans message Discord

| Variable | Effet attendu | Dépendances | Migration |
| --- | --- | --- | --- |
| `TEAM_APPLICATIONS_ENABLED` | Candidatures d'équipe (`/equipes/candidatures`) | `communityTeamsEnabled` | `20261118103000_team_applications` |
| `TOWER_CHALLENGE_REPLACEMENT_ENABLED` | Remplacement d'un défi solo dont le jeu n'est pas possédé | `TOWER_CHALLENGES_ENABLED` | `20261118122100_tower_challenge_replacement` |
| `TOWER_CHALLENGE_PROPOSALS_ENABLED` | Propositions de défis par les Ranker / High Ranker, validées par le staff | `TOWER_CHALLENGES_ENABLED` | `20261118122200_tower_rank_challenge_proposals` |
| `GAME_LEVELS_MATCHMAKING_ENABLED` | Niveau par jeu dans le matchmaking et l'équilibrage des tournois | `GAME_LEVELS_ENABLED` | aucune |
| `TOURNAMENT_TEAMS_ENABLED` | Tournois par équipes inscrites (résultat confirmé par les deux capitaines) | `communityTeamsEnabled` (MP : aussi executor et bot) | `20261118130400_tournament_teams` |
| `TEAM_RIVALRIES_ENABLED` | Rivalités entre équipes et « Jouer maintenant » (Rejoindre / Intéressé, expiration 2 h) | — | `20261118130700_team_rivalries` |
| `GAME_PLATFORMS_ENABLED` | Plateformes et crossplay des jeux, ajout rapide par plateforme, défis jamais impossibles | — | `20261118130900_platform_identities_crossplay` |

Retour arrière : retirer la variable ; candidatures, propositions et tournois en cours restent en base mais ne sont plus accessibles.

## Groupe 4 — Notifications et votes Discord (via la file)

| Variable | Effet attendu | Dépendances | Migration |
| --- | --- | --- | --- |
| `NOTIFICATION_CENTER_ENABLED` | `/notifications`, opt-in aux jeux suivis, MP réservés à ce qui vise le joueur, jamais `@everyone` | executor, bot | `20261118130800_notification_center` |
| `TOWER_DISCORD_VOTES_ENABLED` | Votes de preuves par boutons ✅/❌ : message public mis à jour et un fil par preuve | `TOWER_DISCORD_ANNOUNCE_ENABLED`, flag communautaire | **aucune** |
| `TOWER_STEAM_AUTOVALIDATE_ENABLED` | Validation automatique des défis Steam mesurables (cron `/api/cron/tower-steam-autovalidate`) ; repli sur le vote communautaire | `TOWER_DISCORD_ANNOUNCE_ENABLED`, `STEAM_API_KEY`, `TOWER_DISCORD_VOTES_ENABLED` d'abord | `20261118130200_tower_challenge_measure` |

Ordre : le centre de notifications **avant** tout ping ; le vote Discord **avant** la validation automatique (son repli en dépend). Retour arrière : retirer la variable ; ne pas rejouer la file ; un message erroné déjà parti est supprimé à la main par Maxime.

## Groupe 5 — Commandes Discord

| Variable | Effet attendu | Dépendances | Migration |
| --- | --- | --- | --- |
| `DISCORD_PROJECT_COMMAND_ENABLED` puis `DISCORD_PROJECT_WRITE_ENABLED` | `/projet` : lecture, puis écritures (créer, rejoindre, quitter, recrutement, espace) | commande enregistrée par Maxime | aucune |
| `PROJECT_ORGANIZER_ENABLED` | `/projets` à organisateur : entrées validées, date de fin, fil public et privé, archivage 7 jours après clôture | executor, bot | `20261118130600_project_entries` |
| `DISCORD_REPORT_COMMAND_ENABLED` | Commande contextuelle « Signaler » : ticket privé dans le salon staff `DISCORD_REPORT_STAFF_CHANNEL_ID`, **aucune sanction automatique** | manifeste enregistré à la main (`scripts/discord-commands.json`) ; executor, bot | `20261118131100_moderation_reports` |

Retour arrière : retirer la variable ; la commande reste visible sur Discord tant qu'elle n'est pas retirée du manifeste (action manuelle) mais répond « désactivé ».

## Groupe 6 — Création de fils, vocaux, salons ou rôles d'équipe

| Variable | Effet attendu | Dépendances | Migration |
| --- | --- | --- | --- |
| `TEAM_RECRUITERS_ENABLED` | Recruteurs d'équipe (2 au plus ; MP au capitaine et à eux), relance à 48 h, expiration à 7 jours, invités de tournoi | `TEAM_APPLICATIONS_ENABLED` ; MP : executor et bot | `20261118130000_team_recruiters_guest` |
| `SESSION_VISIBILITY_ENABLED` | Soirées publique / sur candidature / privée, coorganisateur, liste d'attente, espace temporaire (fil privé + vocal 30 min avant, supprimés vides après la fin) | executor, bot | `20261118130300_session_visibility_waitlist` |
| `DISCORD_TEAM_SPACES_ENABLED` (+ `DISCORD_TEAM_SPACES_MAX_PER_COMMUNITY`, défaut 5) | Espaces d'équipe permanents : rôle sans permission, salon écrit privé, salon vocal privé | executor, bot **au-dessus des rôles d'équipe** | `20261118110000_discord_team_space` puis `20261118110100_discord_team_space_voice` |
| `DISCORD_BOOSTERS_ENABLED` | Rôle « Soutien de la Tour » (sans permission, retiré à la fin du boost), salons écrit + vocal réservés, Mur des soutiens (`/soutiens`), badge de profil ; cron `booster-sync` | **salons boosters et Mur des soutiens créés d'abord** ; executor, bot | `20261118131200_booster_support` |

Retour arrière : retirer la variable ; les fils, salons et rôles déjà créés **restent sur Discord** (suppression manuelle uniquement, par Maxime, sur ID exact).

## Groupe 7 — Risque le plus élevé

| Variable | Effet attendu | Dépendances | Migration |
| --- | --- | --- | --- |
| `DISCORD_ROLE_AUTOCREATE_ENABLED` | `/role` : création automatique d'un rôle de jeu (sans permission), 1 par joueur et par semaine, plafond `DISCORD_ROLE_MAX_GUILD_ROLES` (défaut 200, jamais plus de 250), alerte staff dès 80 % de 250 rôles | **134 rôles Étage supprimés d'abord** ; `DISCORD_ROLE_COMMAND_ENABLED`, executor, bot ; après les notifications (alerte staff) | `20261118130500_discord_role_requests` |
| `DISCORD_CONNECTIONS_SCOPE_ENABLED` | Scope OAuth `connections` facultatif (consentement explicite) pour suggérer les identifiants de plateformes ; la connexion fermée S0 n'est pas modifiée | aucune dans le code ; recommandé après `GAME_PLATFORMS_ENABLED` (les identifiants suggérés servent aux plateformes) et quand le reste est stable | `20261118130900_platform_identities_crossplay` |

Retour arrière : retirer la variable ; les rôles créés restent sur Discord (suppression manuelle, sur ID exact).

## Point d'attention : création de rôle par /role (corrigé)

`DISCORD_ROLE_SELF_CREATION_ENABLED` est **fermé par défaut** : seule la valeur exacte `true` ouvre la création directe d'un rôle de jeu absent par `/role` (`roleCreationAllowed` dans `src/lib/discord-role-command.ts`). `DISCORD_ROLE_AUTOCREATE_ENABLED=true` ouvre aussi la création, mais par la file et l'executor. Fermé, `/role` n'attribue que les rôles qui existent déjà. `/role` reste muette tant que `DISCORD_ROLE_COMMAND_ENABLED` n'est pas `true`.

## Contrôles après chaque groupe

- Aucune erreur dans les logs Vercel ni dans l'executor ; `failed=0` sur les crons concernés.
- Aucune écriture Discord hors file ; aucun `@everyone`.
- Un compte d'une autre communauté ne voit aucune donnée de The Tower.
- Un compte sans Membership active reste refusé à la connexion (S0 inchangée).

## Annexe — autres interrupteurs présents dans le code (hors parcours Tower)

Ces interrupteurs précèdent le lot Tower 2.0 ou n'en font pas partie ; ils sont **OFF par défaut** (actifs seulement si la valeur vaut exactement `true`) et indépendants de l'ordre ci-dessus. Détail et valeurs d'exemple : `.env.example` ; règles : `CLAUDE.md`. Retour arrière : retirer la variable ou la passer à une valeur différente de `true` (pour les nettoyages : `MODE` ≠ `execute` = dry-run), puis redéployer.

**Communauté et serveurs**

| Variable | Effet attendu | Prérequis / migration |
| --- | --- | --- |
| `COMMUNITY_ISOLATION_ENABLED` | Filtres communautaires étendus (la garde d'accès Membership de `default` reste appliquée même OFF) | [COMMUNITY_ROLLOUT.md](COMMUNITY_ROLLOUT.md), [SECURITE_CLAUDE.md](SECURITE_CLAUDE.md) |
| `COMMUNITY_PICKER_ENABLED` | Sélecteur de serveur `/serveurs` et porte sur accueil, `/sessions`, `/tournois`, `/classement` | migration `add_user_active_community` |
| `COMMUNITY_ADMIN_ENABLED` | Onglet « Communautés » de `/admin` : activer une communauté PENDING, choisir ses salons | aucune migration |
| `COMMUNITY_CHANNELS_ENABLED` | Salons d'annonce par communauté (soirées, tournois) | — |
| `COMMUNITY_AUTO_CREATE_ENABLED` | Création automatique de communautés PENDING (webhook Discord + cron `community-guild-sync`) | `DISCORD_APP_PUBLIC_KEY` |
| `COMMUNITY_SETUP_COMMAND_ENABLED` | Commande Discord `/gamenight setup` | `DISCORD_APP_PUBLIC_KEY` |
| `COMMUNITY_QUICK_POLLS_ENABLED` | Sondages éclair par serveur (Profil → Lore) | migration `community_quick_polls` |
| `COMMUNITY_GAME_GRAVEYARD_ENABLED` | Cimetière et épitaphes des jeux (Profil → Lore) | migration `community_game_epitaphs` |
| `COMMUNITY_EXPRESSIONS_ENABLED` | Expressions et running gags (Profil → Lore) | migration `community_expressions` |
| `COMMUNITY_HIGHLIGHTS_ENABLED` | Exploits et fails éditables, liens médias sans upload | migration `community_highlights` |

**Soirées, tournois, roulette**

| Variable | Effet attendu | Prérequis / migration |
| --- | --- | --- |
| `SESSION_CHRONICLES_ENABLED` | Chronique texte des soirées terminées ; archive Lore | migration `session_chronicles` |
| `SESSION_PREPARATION_ENABLED` | Checklist de préparation individuelle sur les soirées planifiées | — |
| `SESSION_VIDEO_ENABLED` | Clips MP4 privés dans la galerie des soirées | `SESSION_MEDIA_BLOB_TOKEN`, galerie activée par communauté |
| `SESSION_SERIES_CANCEL_ENABLED` | Annulation des occurrences futures d'une série récurrente | migration `recurring_session_cancellation` |
| `TOURNAMENT_PREDICTIONS_ENABLED` | Pronostics de tournoi (sans mise ni XP) | migration `tournament_predictions` |
| `TOURNAMENT_SCORES_ENABLED` | Saisie facultative des scores de match | migration `tournament_match_scores` |
| `VOTE_VETO_ENABLED` | Veto au vote de jeu et à la roulette asynchrone | migrations `add_session_veto`, `add_roulette_veto` |
| `ROULETTE_PLAYER_FILTER_ENABLED` | Roulette : ne tire que les jeux compatibles avec le nombre d'inscrits | aucune migration |
| `WHO_PLAYS_TONIGHT_ENABLED` | Page `/ce-soir` « Qui joue ce soir ? » | `playerClassifiedsEnabled` ; aucune migration |
| `CALENDAR_SUBSCRIPTIONS_ENABLED` | Abonnement iCal privé et révocable depuis `/calendrier` | migration `calendar_feed_tokens` |
| `VOICE_PRESENCE_ENABLED` | Présence vocale (service dédié auto-hébergé) | décisions du service dédié, [LIVRAISON-VOCAL.md](LIVRAISON-VOCAL.md) |

**Jeux et catalogue**

| Variable | Effet attendu | Prérequis / migration |
| --- | --- | --- |
| `GAME_PREPARATION_TIME_ENABLED` | Durée estimée (1–10 080 min) sourcée sur la fiche jeu | — |
| `FREE_GAME_FEED_ENABLED` | Offres GamerPower filtrées (Steam/Epic) dans les jeux gratuits | `freeGamesEnabled` par communauté |
| `STEAM_NOW_PLAYING_ENABLED` | Indicateur « En jeu » sur `/potes` | migration `steam_now_playing` |

**Discord : annonces par le bot et MP**

| Variable | Effet attendu | Prérequis / migration |
| --- | --- | --- |
| `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` | Annonces de soirées via le bot | `DISCORD_BOT_GUILD_ID` et salon |
| `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` | Annonces de tournois via le bot | `DISCORD_BOT_GUILD_ID` et salon |
| `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED` | Invitation « Jouer maintenant » par MP | aucun salon requis |
| `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED` | Ajout planifié des offres gratuites à l'outbox Discord | `FREE_GAME_FEED_ENABLED`, `COMMUNITY_CHANNELS_ENABLED`, executor, `freeGamesEnabled`, salon dédié |
| `DISCORD_DM_SESSION_ENABLED` | Création de nouveaux MP de soirée | chemin bot soirées |
| `DISCORD_DM_TOURNAMENT_ENABLED` | Création de nouveaux MP de tournoi | — |
| `DISCORD_DM_ROULETTE_ENABLED` | Création de nouveaux MP de roulette | — |
| `DISCORD_THREAD_CLEANUP_ENABLED` | Archivage/suppression des fils (dry-run sauf `DISCORD_THREAD_CLEANUP_MODE=execute`) | — |
| `DISCORD_THREAD_CLOSE_ON_END_ENABLED` | Archive le fil dès la fin de la soirée | nettoyage ci-dessus en `execute` |

**Discord : commandes**

| Variable | Effet attendu | Prérequis / migration |
| --- | --- | --- |
| `DISCORD_SESSION_COMMAND_ENABLED` | `/soiree` en lecture seule (liste, voir) | commande enregistrée par Maxime |
| `DISCORD_SESSION_WRITE_ENABLED` | `/soiree` : création, inscription, désinscription | après `DISCORD_SESSION_COMMAND_ENABLED` |
| `DISCORD_TOURNAMENT_COMMAND_ENABLED` | `/tournoi` en lecture seule | commande enregistrée par Maxime |
| `DISCORD_TOURNAMENT_WRITE_ENABLED` | `/tournoi` : inscription et désinscription | après `DISCORD_TOURNAMENT_COMMAND_ENABLED` |
| `DISCORD_PLAYER_COMMAND_ENABLED` | `/joueurs` en lecture (annonces de la page `/joueurs`) | commande enregistrée par Maxime |
| `DISCORD_PLAYER_WRITE_ENABLED` | `/joueurs` : publier / retirer une annonce | après `DISCORD_PLAYER_COMMAND_ENABLED` |
| `DISCORD_PROFILE_COMMAND_ENABLED` | Commande `/profil` (réponses privées) | déclaration séparée |
| `DISCORD_BOOSTER_ENABLED` | Commande `/boost` (réponses privées) | déclaration séparée |

**The Tower : panneau, préflight, passation**

| Variable | Effet attendu | Prérequis / migration |
| --- | --- | --- |
| `TOWER_ONBOARDING_PANEL_ENABLED` | Panneau Discord d'accueil à trois boutons ; réponses privées, aucun rôle modifié | `TOWER_DISCORD_WELCOME_CHANNEL_ID`, `TOWER_DISCORD_GUILD_ID` ; publication par workflow dédié, jamais sur Preview |
| `TOWER_DISCORD_PREFLIGHT_ENABLED` | `GET /api/admin/tower-preflight` : inventaire en lecture seule des salons (éteint = 404, aucune écriture Discord) | `DISCORD_BOT_GUILD_ID` |
| `TEAM_CAPTAIN_HANDOVER_ENABLED` | Passation du capitaine inactif depuis 30 jours (OFF et simulation par défaut) | cron externe non configuré ; jamais sur Preview |

**Site, sécurité, rétention, push**

| Variable | Effet attendu | Prérequis / migration |
| --- | --- | --- |
| `GUIDE_V2_ENABLED` | Sections « Jouer maintenant » et « Tournois » dans `/guide` | — |
| `HOME_V2_ENABLED` | Variante d'accueil `/accueil-v2` (404 sans activation) | aucune migration |
| `PAGE_TITLES_ENABLED` | Titres d'onglet par page | — |
| `PAGE_TITLES_DYNAMIC_ENABLED` | Titres d'onglet dynamiques selon le jeu ou le joueur | `PAGE_TITLES_ENABLED` |
| `SKIP_LINK_ENABLED` | Lien d'évitement clavier « Aller au contenu » | — |
| `CSP_REPORT_ENABLED` | Collecte des rapports CSP (`/api/csp-report`) ; l'en-tête CSP change au build suivant | [SECURITE_CLAUDE.md](SECURITE_CLAUDE.md) |
| `RETENTION_CLEANUP_ENABLED` | Purge de rétention (dry-run sauf `RETENTION_CLEANUP_MODE=execute`) | — |
| `WEB_PUSH_ENABLED` | Web Push après opt-in par appareil | `WEB_PUSH_VAPID_SUBJECT`, `…_PUBLIC_KEY`, `…_PRIVATE_KEY` ; migration `web_push_subscriptions` |

