# Activation de la Tour en une soirée

Décision du propriétaire du 17 novembre 2026. Elle remplace « un interrupteur par jour » : les 4 interrupteurs sont conservés mais activés le même soir.

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
| 4 | `TOWER_TEAM_DAILY_ENABLED=true` | Vercel Production | **Non, tant que les prérequis ci-dessous ne sont pas remplis** |

Prérequis hors interrupteurs : `NOTIFICATION_EXECUTOR_ENABLED=true` ; `CRON_SECRET` défini ; commandes `/tower` et `/tower-admin` visibles.

Pourquoi cet ordre : 1 et 2 partent ensemble (un seul redéploiement) mais ne servent à rien sans 3 ; 3 est la porte d'accès par communauté (jamais une autre communauté) ; l'import du catalogue exige 1 et 3 ; 4 est le dernier car il génère des attributions automatiques.

## Prérequis à cocher avant la soirée

- [ ] Pile de PR (#370, #406, #407, #408, #416) fusionnée ou explicitement écartée du périmètre ; migrations appliquées en Production selon [MIGRATIONS.md](MIGRATIONS.md) (CI verte, environnement `production-migrations`).
- [ ] Application GameNight réinvitée avec `applications.commands` ; `node scripts/register-tower-guild-commands.mjs --check` (lecture seule) lu, puis `--execute` par Maxime ; `--check` relancé ; commandes visibles pour un compte membre et un compte modérateur.
- [ ] Salons configurés : `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID`, `TOWER_DISCORD_GENERAL_CHANNEL_ID` renseignés (valeurs jamais dans le dépôt).
- [ ] Arbitre indépendant désigné (obligatoire avant d'annoncer les contestations).
- [ ] Valeurs précédentes relevées (pour le retour arrière) : environnement ET base.
- [ ] Catalogue relu ([TOWER_SAISON1_CATALOGUE_30.md](TOWER_SAISON1_CATALOGUE_30.md)) : le code contient 26 défis solo et 10 d'équipe, soit 36 et non 30 : trancher avant l'import.
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

À ne pas activer tant que : l'attribution à **18:00 Europe/Paris** (décision) n'est pas alignée avec le code (le code de `main` planifie encore 09:00, voir `docs/TOWER_TEAM_DAILY_CRON.md` ; la PR du lot du 18/11 le passe à 18:00 : ne pas activer avant sa fusion) ; les règles d'équipe 2–8 / équipe unique (#370) ne sont pas fusionnées ; la cadence externe n'a pas été constatée en lecture. Sinon, laisser OFF et garder la ligne « défi d'équipe » en [PRÉVUE] dans les textes. Le workflow `.github/workflows/tower-team-daily.yml` est fusionné (#396) ; le fonctionnement reste à observer.

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

# Interrupteurs v1.1 (décisions du 18/11/2026)

> Document de préparation : rien n'est activé, aucune variable Vercel n'est modifiée. Tous les interrupteurs ci-dessous sont **OFF par défaut** (actifs seulement si la valeur vaut exactement `true`). **Rien ne s'active sur une Preview** : l'activation se fait en Production par Maxime, jamais par Claude. Détail des sujets A à O : [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md) §27 ; statut : [COUVERTURE_CAHIER.md](COUVERTURE_CAHIER.md). Un interrupteur n'est utilisable qu'après la fusion de sa PR et l'application de sa migration.

## Prérequis généraux

1. Migrations appliquées en Production avant tout interrupteur qui en dépend ([MIGRATIONS.md](MIGRATIONS.md)). Sans elles, les fonctions répondent `migration_required` et n'écrivent rien.
2. `NOTIFICATION_EXECUTOR_ENABLED=true` et `CRON_SECRET` défini : toute écriture Discord (rôles, salons, messages) passe par la file et l'executor.
3. **Création automatique de rôles (`DISCORD_ROLE_AUTOCREATE_ENABLED`) : prérequis explicite, ne pas l'activer tant que les 134 rôles Étage ne sont pas supprimés.** Le serveur est proche du plafond Discord de 250 rôles ; la suppression est une action manuelle du propriétaire, jamais faite par le dépôt (inventaire : `scripts/audit-tower-etage-roles.mjs`, [TOWER_ROLE_REVIEW.md](TOWER_ROLE_REVIEW.md)).
4. Bot avec les droits nécessaires : gestion des salons et des rôles, **placé au-dessus des rôles d'équipe** dans la hiérarchie (sinon Discord refuse la synchronisation).

## Flags du lot Tower 2.0 (PR #462–#472 et fusionnées)

| Interrupteur | Rôle | Conditions et notes |
| --- | --- | --- |
| `TEAM_APPLICATIONS_ENABLED` | Candidatures d'équipe | Exige `communityTeamsEnabled` ; migration `team_applications` |
| `PROFILE_VISIBILITY_ENABLED` | Visibilité du profil | Migration `profile_visibility` |
| `DISCORD_PROJECT_COMMAND_ENABLED` | Commande `/projet` (lecture) | Commande enregistrée par le propriétaire |
| `DISCORD_PROJECT_WRITE_ENABLED` | `/projet` : écritures | Après `DISCORD_PROJECT_COMMAND_ENABLED` |
| `DISCORD_TEAM_SPACES_ENABLED` | Espaces d'équipe, option A (rôle, salon écrit et vocal privés permanents) | Plus `DISCORD_TEAM_SPACES_MAX_PER_COMMUNITY` (quota produit, défaut 5) ; bot avec droits salons et rôles **au-dessus des rôles d'équipe** ; `NOTIFICATION_EXECUTOR_ENABLED` requis ; migrations `discord_team_space` puis `discord_team_space_voice` |
| `TOWER_TEAM_DAILY_ENABLED` | Défi d'équipe quotidien à **18:00 Europe/Paris** | Cron `GET /api/cron/tower-team-daily` : variable de dépôt GitHub `GAMENIGHT_CRON_BASE_URL` et secret GitHub `CRON_SECRET` ; exige aussi `TOWER_CHALLENGES_ENABLED` et le drapeau communautaire |
| `TOWER_IRREGULAR_GRANTS_ENABLED` | Attribution manuelle d'Irregular par le staff | Prestige, aucun droit |
| `TOWER_CHALLENGE_REPLACEMENT_ENABLED` | Remplacement d'un défi (jeu non possédé) | |
| `TOWER_CHALLENGE_PROPOSALS_ENABLED` | Propositions de défis par les grades élevés | |
| `TOWER_SEASON_AWARDS_ENABLED` | Titres et cadres de distinctions saisonnières | Cosmétique, durée = saison suivante |
| `TEAM_RECRUITMENT_CRITERIA_ENABLED` | Critères de recrutement des équipes | |
| `GAME_LEVELS_ENABLED` | Niveaux par jeu (#468) | Base du sujet K |

## Flags v1.1 (nouveaux)

| Interrupteur | Sujet | Migration |
| --- | --- | --- |
| `NOTIFICATION_CENTER_ENABLED` | I | `20261118130800_notification_center` |
| `ADMIN_DASHBOARD_V2_ENABLED` | O | aucune |
| `TOWER_DISCORD_VOTES_ENABLED` | B | `20261118130100_tower_vote_messages` |
| `TOWER_STEAM_AUTOVALIDATE_ENABLED` | C | `20261118130200_tower_challenge_measure` |
| `TEAM_RECRUITERS_ENABLED` | A | `20261118130000_team_recruiters_guest` |
| `TOURNAMENT_TEAMS_ENABLED` | E | `20261118130400_tournament_teams` |
| `TEAM_RIVALRIES_ENABLED` | H | `20261118130700_team_rivalries` |
| `SESSION_VISIBILITY_ENABLED` | D | `20261118130300_session_visibility_waitlist` |
| `PROJECT_ORGANIZER_ENABLED` | G | `20261118130600_project_entries` |
| `DISCORD_REPORT_COMMAND_ENABLED` | L | `20261118131100_moderation_reports` |
| `DISCORD_ROLE_AUTOCREATE_ENABLED` | F | `20261118130500_discord_role_requests` |
| `DISCORD_BOOSTERS_ENABLED` | M | `20261118131200_booster_support` |
| `DISCORD_CONNECTIONS_SCOPE_ENABLED` | J | `20261118130900_platform_identities_crossplay` |
| `GAME_PLATFORMS_ENABLED` | J | même migration |
| `GAME_LEVELS_MATCHMAKING_ENABLED` | K | aucune (si possible) |
| `PROFILE_CUSTOMIZATION_ENABLED` | N | `20261118131300_profile_customization` |

## Ordre d'activation recommandé (à confirmer par Maxime)

Un groupe à la fois, avec observation (logs Vercel, executor, `failed=0`) avant le suivant. Retour arrière : retirer l'interrupteur ou le passer à une valeur différente de `true`, redéploiement ; les données restent.

| Ordre | Interrupteurs | Pourquoi |
| --- | --- | --- |
| 0 | Fusion des PR puis application des migrations (CI, environnement `production-migrations`) ; aucun interrupteur | Une migration non appliquée rend la fonction inopérante ; rien n'est activé sur Preview |
| 1 | Flags du lot Tower 2.0 : `TEAM_APPLICATIONS_ENABLED`, `PROFILE_VISIBILITY_ENABLED`, `DISCORD_TEAM_SPACES_ENABLED` (avec `DISCORD_TEAM_SPACES_MAX_PER_COMMUNITY`), `DISCORD_PROJECT_COMMAND_ENABLED` puis `DISCORD_PROJECT_WRITE_ENABLED`, `GAME_LEVELS_ENABLED`, `TEAM_RECRUITMENT_CRITERIA_ENABLED`, puis `TOWER_IRREGULAR_GRANTS_ENABLED`, `TOWER_CHALLENGE_REPLACEMENT_ENABLED`, `TOWER_CHALLENGE_PROPOSALS_ENABLED`, `TOWER_SEASON_AWARDS_ENABLED` ; `TOWER_TEAM_DAILY_ENABLED` en dernier (18:00, cadence externe constatée) | Socle déjà conçu : les sujets v1.1 s'appuient dessus (#457, #469, #468) |
| 2 | `NOTIFICATION_CENTER_ENABLED`, puis `ADMIN_DASHBOARD_V2_ENABLED` | Notifications et centre **avant** tout ping : les pings de rôle de jeu en dépendent. Le tableau de bord est en lecture seule et sert à surveiller la suite |
| 3 | `TOWER_DISCORD_VOTES_ENABLED`, puis `TOWER_STEAM_AUTOVALIDATE_ENABLED` | La validation automatique se replie sur le vote communautaire (profil privé, « Signaler un doute ») : le vote Discord doit exister d'abord |
| 4 | `TEAM_RECRUITERS_ENABLED`, `TOURNAMENT_TEAMS_ENABLED`, `TEAM_RIVALRIES_ENABLED`, `SESSION_VISIBILITY_ENABLED`, `PROJECT_ORGANIZER_ENABLED` | Parcours de groupes ; leurs MP et annonces passent par le centre déjà actif. `SESSION_VISIBILITY_ENABLED` crée fils et vocaux temporaires via l'executor |
| 5 | `DISCORD_REPORT_COMMAND_ENABLED` | Nouvelle commande contextuelle : enregistrement du manifeste par Maxime d'abord (rien n'est enregistré par le dépôt) ; ticket privé staff, aucune sanction automatique |
| 6 | `DISCORD_ROLE_AUTOCREATE_ENABLED` | **Seulement après la suppression des 134 rôles Étage** (prérequis explicite ci-dessus), après les notifications (alerte staff à 80 % de 250 rôles) |
| 7 | `DISCORD_BOOSTERS_ENABLED` | **Après la création du salon (écrit + vocal) dédié aux boosters** et du « Mur des soutiens » ; le rôle « Soutien de la Tour » est créé sans permission, uniquement cosmétique |
| 8 | `DISCORD_CONNECTIONS_SCOPE_ENABLED`, `GAME_PLATFORMS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED` | Scope OAuth `connections` : à activer quand le reste est stable (la connexion fermée S0 n'est pas modifiée). Le matchmaking par niveau exige `GAME_LEVELS_ENABLED` |
| 9 | `PROFILE_CUSTOMIZATION_ENABLED` | En dernier : s'appuie sur grades, saisons, titres et cadres, tournois et boosters pour l'obtention ; purement cosmétique |

## Contrôles après chaque groupe

- Aucune erreur dans les logs Vercel ni dans l'executor ; `failed=0` sur les crons concernés.
- Aucune écriture Discord hors file ; aucun `@everyone`.
- Un compte d'une autre communauté ne voit aucune donnée de The Tower.
