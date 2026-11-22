# Phase de test avant l'annonce publique

> **Document de préparation en lecture seule.** Il ne modifie ni Vercel, ni Neon, ni Discord : rien n'est activé par ce document. Il décrit comment Maxime et ChatGPT testent le serveur **avant** l'annonce, un groupe à la fois, du moins risqué au plus risqué. Les valeurs réelles des variables Vercel et l'état de la base de Production n'ont **pas** été relus pour l'écrire : chaque case « Vérifier » est à cocher par Maxime.
>
> Complète [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md) (ordre global des interrupteurs) et [SOIREE_ACTIVATION.md](SOIREE_ACTIVATION.md) (pas-à-pas de la soirée d'activation de la Tour). Règle de lecture : un interrupteur n'est actif que si sa valeur vaut **exactement** `true` ; l'activation se fait en **Production**, jamais sur une Preview ; chaque changement de variable Vercel demande un **redéploiement**.

## 0. Avant le premier groupe

### 0.1 Qui fait quoi

| Rôle | Ce qu'il fait | Ce qu'il ne fait jamais |
| --- | --- | --- |
| **Maxime** | Pose les variables dans Vercel, redéploie, enregistre les commandes du bot depuis son PC, lit l'application avec son compte, décide du retour arrière | — |
| **ChatGPT** | Teste **dans Discord** avec un **compte membre de test** (et, pour `/tower-admin`, un compte avec « Gérer le serveur ») : tape les commandes, lit ce qui apparaît, rapporte | Ne reçoit **jamais** le jeton du bot, un accès Vercel ou Neon, ni `CRON_SECRET`. Ne colle pas de secret dans le chat |
| **Claude** | Écrit et relit la documentation ; aucune écriture Vercel, Neon ou Discord | N'active rien |

Le compte de test doit être **membre du serveur Discord** : la connexion est fermée par défaut (S0), un compte sans appartenance active est refusé.

### 0.2 Prérequis communs (à cocher une fois)

- [ ] **Vérifier** : le dernier run « Migrations Production » est vert et la dernière migration appliquée est `20261121100000_account_deletion_log` (voir [MIGRATIONS.md](MIGRATIONS.md)). Un interrupteur dont la migration manque répond `migration_required` et n'écrit rien.
- [ ] **Vérifier** (présence seulement, sans lire de valeur) dans Vercel → Settings → Environment Variables → Production : `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_APP_PUBLIC_KEY`, `CRON_SECRET`, `TOWER_DISCORD_GUILD_ID`, `DISCORD_BOT_GUILD_ID`.
- [ ] `NOTIFICATION_EXECUTOR_ENABLED=true` : sans lui, **aucune** écriture Discord (MP, messages, fils, salons, rôles) ne part ; la file s'accumule sans rien envoyer.
- [ ] Le bot a les droits nécessaires (Gérer les rôles, Gérer les salons, Gérer les fils, Créer des fils privés, Voir les salons, Envoyer des messages) et son rôle est **au-dessus** des rôles à attribuer et des rôles d'équipe dans la hiérarchie (sinon Discord refuse).
- [ ] Les **appels externes** (cron-job.org ou équivalent) existent pour ce que tu testes : voir [CRONS.md](CRONS.md). **Aucun cron n'est créé par le dépôt.** Sans cron `notification-executor` régulier, les annonces et MP restent en file ; sans cron `reminders`, aucun espace de soirée n'est créé.
- [ ] **Enregistrer les commandes du bot une seule fois** depuis ton PC, avec [SOIREE_ACTIVATION.md § 8](SOIREE_ACTIVATION.md) (étapes 8.1 à 8.4, jeton saisi sans l'afficher, jamais dans un fichier ni dans le chat). Le manifeste `scripts/discord-commands.json` contient 13 commandes. Une commande enregistrée mais dont l'interrupteur est éteint répond « désactivé » : **enregistrer les 13 d'un coup ne les active pas**.
- [ ] `/aide` (tapé par ChatGPT) liste les commandes et leur état : à utiliser **avant et après** chaque groupe pour contrôler l'état.

### 0.3 Quelle commande dépend de quel interrupteur

| Commande | Interrupteur(s) qui l'activent | Groupe |
| --- | --- | --- |
| `/tower`, `/tower-admin` | `TOWER_CHALLENGES_ENABLED` + `Community.towerChallengesEnabled` | 1 |
| `/role` | `DISCORD_ROLE_COMMAND_ENABLED` ; création d'un rôle absent : `DISCORD_ROLE_SELF_CREATION_ENABLED` **ou** `DISCORD_ROLE_AUTOCREATE_ENABLED` | 2 |
| `/equipe`, `/projet` | `Community.communityTeamsEnabled` ; `/projet` : `DISCORD_PROJECT_COMMAND_ENABLED` (+ `DISCORD_PROJECT_WRITE_ENABLED` pour écrire) | 3 |
| `/soiree` | `DISCORD_SESSION_COMMAND_ENABLED` (+ `DISCORD_SESSION_WRITE_ENABLED` pour créer, rejoindre, quitter) | 4 |
| `/tournoi` | `DISCORD_TOURNAMENT_COMMAND_ENABLED` (+ `DISCORD_TOURNAMENT_WRITE_ENABLED`) | 4 |
| `/boost` | `DISCORD_BOOSTER_ENABLED` (commande) ; avantages réels : `DISCORD_BOOSTERS_ENABLED` | 5 |
| `/profil` | `DISCORD_PROFILE_COMMAND_ENABLED` | 6 |
| `/joueurs` | `DISCORD_PLAYER_COMMAND_ENABLED` (+ `DISCORD_PLAYER_WRITE_ENABLED`) | hors groupes |
| `/Signaler` (clic droit sur un message) | `DISCORD_REPORT_COMMAND_ENABLED` | hors groupes |
| `/gamenight setup` | `COMMUNITY_SETUP_COMMAND_ENABLED` | hors groupes |

### 0.4 Règle d'or de la phase de test

Un groupe à la fois, dans l'ordre. Après chaque groupe : lire les logs Vercel (erreurs 5xx), `failed=0` sur les crons, et refaire `/aide`. **Au moindre doute, appliquer le retour arrière du groupe avant de continuer.** Les rôles, salons, fils et messages déjà créés sur Discord ne sont **jamais** supprimés par le code : le nettoyage est manuel, par Maxime, sur identifiant exact.

---

## Groupe 1 — La Tour (défis, annonces)

**Risque : le plus faible des groupes avec écriture Discord.** Écrit dans la base et envoie des annonces dans les salons configurés, via la file. Pas de création de rôle ni de salon.

### Variables et dépendances

| Quoi | Où | Valeur | Remarque |
| --- | --- | --- | --- |
| `TOWER_CHALLENGES_ENABLED` | Vercel Production | `true` | Parcours de défis, `/tower`, `/ascension` |
| `TOWER_DISCORD_ANNOUNCE_ENABLED` | Vercel Production | `true` | Annonces de preuves et de réussites ; exige l'executor |
| `NOTIFICATION_EXECUTOR_ENABLED` | Vercel Production | `true` | Déjà exigé au § 0.2 |
| `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID` | Vercel Production | identifiants du serveur et du salon des défis/preuves | Ne pas publier de valeur dans le dépôt |
| `TOWER_DISCORD_GENERAL_CHANNEL_ID` | Vercel Production | salon des annonces générales | Voir [SOIREE_ACTIVATION.md](SOIREE_ACTIVATION.md) |
| `Community.towerChallengesEnabled` | **Base** de Production | `true` pour le serveur The Tower uniquement | Porte d'accès par communauté : sans elle, les variables ci-dessus n'ont aucun effet |
| `TOWER_DISCORD_VOTES_ENABLED` (**en second temps**) | Vercel Production | `true` | Votes ✅/❌ par boutons et un fil par preuve ; exige `TOWER_DISCORD_ANNOUNCE_ENABLED` et le salon des preuves ; **sans migration** |

Option : `TOWER_TEAM_DAILY_ENABLED` (défi d'équipe quotidien à 18:00 Europe/Paris) **ne fait pas partie de ce groupe** : laisse-le éteint pendant la phase de test, voir [SOIREE_ACTIVATION.md § 5](SOIREE_ACTIVATION.md).

### Commandes à enregistrer

`/tower` (défi, progression, classement, vote, équipe) et `/tower-admin` (ajouter, ajouter-mesure, defis, desactiver, importer, importer-equipe). `/tower-admin` n'apparaît qu'avec la permission « Gérer le serveur ». Enregistrement : § 0.2.

**Catalogue vide au départ** : le catalogue de défis de Production contient **0 défi** tant qu'il n'est pas importé. Avec le compte « Gérer le serveur » : `/tower-admin importer` (défis solo), puis `/tower-admin importer-equipe` **seulement si** `communityTeamsEnabled` est vrai (groupe 3). **Importer avant toute annonce.**

### Retour arrière

1. Incident touchant les données : en premier, côté base, mettre `Community.towerChallengesEnabled` à `false` pour le serveur The Tower (requête exacte dans [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md), sans redéploiement).
2. Puis retirer `TOWER_DISCORD_VOTES_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`, `TOWER_CHALLENGES_ENABLED` (ou les passer à autre chose que `true`) et **redéployer**. Les défis attribués, preuves et étages restent en base ; un message erroné déjà publié se supprime à la main.

### Tests que ChatGPT peut faire dans Discord (compte membre de test)

1. `/aide` : `/tower` est listée comme **active**.
2. `/tower progression` : réponse **privée** (visible de lui seul) avec son étage et son rang ; aucun message public.
3. `/tower defi` : un défi du catalogue lui est attribué ; la réponse reste privée.
4. Soumettre une preuve (suivre la consigne du défi) : **dans le salon `TOWER_DISCORD_CHANNEL_ID`**, une annonce de preuve apparaît **uniquement si le consentement de publication est donné**, avec les boutons ✅ Valider / ❌ Refuser (ou ✅/❌ + un **fil** par preuve avec `TOWER_DISCORD_VOTES_ENABLED`).
5. Un **deuxième** compte de test (membre actif **depuis au moins 7 jours** de la communauté, sinon son vote est refusé) vote : le message public est **édité** (compteur de votants, jamais le détail pour/contre) ; le fil de discussion est créé une seule fois.
6. `/tower classement` : liste sans erreur.
7. Au règlement du vote : boutons retirés, annonce de réussite dans le salon général si configuré.

**Ce qu'il ne doit PAS voir** : aucune mention `@everyone` ni `@here` ; aucune annonce d'un défi d'une autre communauté ; aucun rôle « Étage » créé ni attribué.

### Tests que Maxime fait dans l'application

1. `/tower` répond et affiche le catalogue importé et le défi en cours (le web est en **lecture seule** pour le solo : démarrer un défi et envoyer la preuve passent par Discord).
2. `/ascension` affiche l'étage XP ; avec `LAUNCH_TEXTS_ENABLED=true` (groupe 6) la phrase décidée le 18/11 sur les étages s'affiche.
3. Un compte d'**un autre serveur** (ou sans appartenance) ne voit **aucune** donnée de The Tower.
4. Logs Vercel : aucune erreur 5xx ; `/admin` : opérations Discord en échec = 0 (avec `ADMIN_DASHBOARD_V2_ENABLED=true`, page `/admin/tableau-de-bord`).

### Critère de réussite

Un défi est attribué, une preuve annoncée dans le bon salon, un vote enregistré et le message édité, un classement lisible, **0 erreur** dans les logs et **0 donnée** visible d'une autre communauté.

---

## Groupe 2 — `/role` et création de rôles de jeux

**Risque : moyen à élevé.** La création automatique pousse le serveur vers le plafond Discord de **250 rôles**. Le serveur en est proche à cause des **134 rôles « Étage »** : voir [TOWER_ROLE_REVIEW.md](TOWER_ROLE_REVIEW.md). Selon l'état actuel du serveur (rôles « Étage » supprimés à la main, d'après les échanges de la mission d'activation), **vérifier le nombre de rôles réels avant d'activer**.

### Réponse directe : faut-il `DISCORD_ROLE_SELF_CREATION_ENABLED=true` pour que `/role` fonctionne ?

**Non, pas pour que la commande fonctionne.** Trois niveaux :

| Besoin | Variables | Effet |
| --- | --- | --- |
| `/role` répond, cherche et **attribue/retire les rôles qui existent déjà** | `DISCORD_ROLE_COMMAND_ENABLED=true` seulement | Aucune création. Un rôle absent : la commande ne crée rien |
| `/role` **crée directement** un rôle de jeu absent | + `DISCORD_ROLE_SELF_CREATION_ENABLED=true` | Création immédiate, bornée, sans permission ; fermée tant que la valeur n'est pas exactement `true` |
| `/role` **demande** la création, exécutée par la file | + `DISCORD_ROLE_AUTOCREATE_ENABLED=true` (+ `NOTIFICATION_EXECUTOR_ENABLED=true`, bot, migration `20261118130500_discord_role_requests`) | 1 création par joueur et par semaine ; plafond `DISCORD_ROLE_MAX_GUILD_ROLES` (défaut 200, jamais plus de 250) ; alerte staff dès 80 % de 250 rôles |

`roleCreationAllowed` autorise la création si **l'un des deux** (`SELF_CREATION` ou `AUTOCREATE`) vaut `true` (`src/lib/discord-role-command.ts`).

**Recommandation pour la phase de test** : commencer par `DISCORD_ROLE_COMMAND_ENABLED=true` seul (attribution des rôles existants), puis tester la création avec **`DISCORD_ROLE_AUTOCREATE_ENABLED=true` uniquement** (par la file, avec plafond et quota), et laisser `DISCORD_ROLE_SELF_CREATION_ENABLED` éteint (création directe sans file ni quota par semaine).

### Variables

| Quoi | Valeur | Remarque |
| --- | --- | --- |
| `DISCORD_ROLE_COMMAND_ENABLED` | `true` | Étape 1 |
| `DISCORD_ROLE_AUTOCREATE_ENABLED` | `true` (étape 2) | **Seulement après** vérification du nombre de rôles du serveur |
| `DISCORD_ROLE_MAX_GUILD_ROLES` | facultatif, défaut 200 | Jamais plus de 250 |
| `DISCORD_ROLE_SELF_CREATION_ENABLED` | **laisser éteint** | Voir ci-dessus |

### Retour arrière

Retirer `DISCORD_ROLE_AUTOCREATE_ENABLED` (puis `DISCORD_ROLE_COMMAND_ENABLED`), redéployer. **Les rôles créés restent** sur Discord : suppression manuelle, sur identifiant exact. Les demandes en attente (`DiscordRoleRequest` PENDING) ne sont plus traitées.

### Tests que ChatGPT peut faire dans Discord

1. `/role chercher jeu:<nom d'un rôle existant>` : le rôle est proposé ; aucun rôle technique (administrateur, bot, intégration) n'apparaît jamais.
2. `/role attribuer jeu:<rôle existant>` : le rôle apparaît sur son profil Discord ; refaire la même commande **ne crée pas de doublon**.
3. `/role retirer jeu:<ce rôle>` : le rôle disparaît.
4. (étape 2, création par la file) `/role creer jeu:<jeu inconnu>` : la réponse annonce une **demande**, puis **dans la minute qui suit l'executor**, un rôle du nom du jeu apparaît **sans aucune permission, non mentionnable**, attribué au testeur.
5. Une **deuxième** création dans la même semaine par le même compte : **refus** (1 par joueur et par semaine).
6. Essayer d'attribuer un rôle sensible (nom réservé, permissions élevées) : **refus** avec message clair.

### Tests que Maxime fait

1. Paramètres du serveur → Rôles : le nouveau rôle existe, **aucune case de permission cochée**, le **nombre total de rôles** reste très en dessous de 250.
2. `/profil/parametres` : le centre d'intérêt du jeu est synchronisé avec le rôle.
3. Avec `ADMIN_DASHBOARD_V2_ENABLED=true` : `/admin/tableau-de-bord` affiche rôles et salons contre les limites 250 / 500.

### Critère de réussite

Attribution, retrait et création **idempotents** (jamais de doublon), rôle créé **sans permission**, quota hebdomadaire respecté, nombre de rôles sous le plafond.

---

## Groupe 3 — Équipes et espaces d'équipe

**Risque : élevé.** Crée des **rôles** et des **salons** (un écrit privé et un vocal privé **permanents**) par équipe : la création d'équipe consomme le plafond de rôles et de salons.

### Variables

| Quoi | Où | Valeur |
| --- | --- | --- |
| `Community.communityTeamsEnabled` | **Base** | `true` pour The Tower (condition de tout le groupe) |
| `TEAM_APPLICATIONS_ENABLED` | Vercel | `true` (candidatures, `/equipes/candidatures`) |
| `TEAM_RECRUITMENT_CRITERIA_ENABLED` | Vercel | `true` (critères de recrutement affichés) |
| `DISCORD_PROJECT_COMMAND_ENABLED` puis `DISCORD_PROJECT_WRITE_ENABLED` | Vercel | `true` (`/projet`) |
| `DISCORD_TEAM_SPACES_ENABLED` | Vercel | `true` (**en dernier**) ; exige executor, bot **au-dessus des rôles d'équipe**, `communityTeamsEnabled` et un serveur relié |
| `DISCORD_TEAM_SPACES_MAX_PER_COMMUNITY` | Vercel | par défaut 5 : **laisser 5 pendant la phase de test** |

Migrations : `20261118110000_discord_team_space` puis `20261118110100_discord_team_space_voice` (sans elles, `migration_required` et aucune écriture Discord).

### Retour arrière

Retirer `DISCORD_TEAM_SPACES_ENABLED` en premier. Les salons et rôles d'équipe **restent** (jamais supprimés par le code : « archiver » = renommer). Nettoyage manuel sur identifiant exact. Pour la base : `Community.communityTeamsEnabled = false` coupe `/equipe` et les pages d'équipe.

### Tests que ChatGPT peut faire dans Discord

1. `/equipe liste` : les équipes du serveur, sans erreur.
2. `/equipe moi` : ses équipes (ou « aucune »).
3. `/equipe rejoindre equipe_id:<identifiant>` (l'identifiant est donné par `/equipe liste`) : il rejoint l'équipe ; **un seul rôle d'équipe** lui est attribué.
4. Avec `DISCORD_TEAM_SPACES_ENABLED` : **un rôle d'équipe sans permission** et **deux salons privés** (un écrit, un vocal) apparaissent dans la catégorie ; **seuls les membres de l'équipe les voient** (@everyone n'a pas « Voir les salons »). Le testeur membre voit les salons ; un compte non membre de l'équipe **ne les voit pas**.
5. `/projet liste` puis `/projet voir`, puis (avec l'écriture) `/projet creer`, `/projet rejoindre`, `/projet quitter` : mêmes équipes, 2 à 8 places.
6. Quitter l'équipe (depuis l'application, ou `/projet quitter` avec l'écriture activée) : l'accès aux salons **disparaît** au passage suivant de l'executor.

### Tests que Maxime fait

1. `/equipes` : créer une équipe (2 à 8 places), voir ses critères de recrutement.
2. `/equipes/candidatures` : candidater avec un second compte, accepter/refuser avec le capitaine.
3. Vérifier côté Discord que le **nombre de rôles et de salons** n'a augmenté que de ce qui est attendu (par équipe : 1 rôle, 2 salons).
4. `/admin/tableau-de-bord` : « espaces archivés à nettoyer » et limites 250 / 500.

### Critère de réussite

Une équipe créée → 1 rôle sans permission + 2 salons privés visibles de ses seuls membres ; rejoindre/quitter met l'accès à jour en quelques minutes ; **aucun doublon** de rôle ou de salon ; quota de 5 espaces respecté.

---

## Groupe 4 — Soirées et tournois

**Risque : moyen.** Les commandes lisent/écrivent des soirées et tournois ; les annonces publiques et MP passent par la file. L'**espace Discord temporaire** de soirée (fil privé + vocal privé) fait partie de ce groupe (voir § « Créer un vocal »).

### Variables

| Quoi | Valeur | Remarque |
| --- | --- | --- |
| `DISCORD_SESSION_COMMAND_ENABLED` puis `DISCORD_SESSION_WRITE_ENABLED` | `true` | `/soiree` : lecture, puis écriture |
| `DISCORD_TOURNAMENT_COMMAND_ENABLED` puis `DISCORD_TOURNAMENT_WRITE_ENABLED` | `true` | `/tournoi` |
| `DISCORD_BOT_GUILD_ID`, `DISCORD_BOT_SESSION_CHANNEL_ID`, `DISCORD_BOT_TOURNAMENT_CHANNEL_ID` | identifiants | salons d'annonce |
| `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` | `true` | annonces par le bot |
| `DISCORD_DM_SESSION_ENABLED`, `DISCORD_DM_TOURNAMENT_ENABLED` | `true` | **nouveaux MP** d'invitation ; les MP de soirée exigent aussi le chemin bot soirées |
| `SESSION_VISIBILITY_ENABLED` | `true` (**en dernier**) | soirées publique / sur candidature / privée, coorganisateur, liste d'attente, **espace temporaire** ; migration `20261118130300_session_visibility_waitlist` ; exige executor, bot, salon des soirées ; balayage par `/api/cron/reminders` |
| `TOURNAMENT_TEAMS_ENABLED` | `true` (optionnel) | tournois par équipes, exige `communityTeamsEnabled` ; cron `/api/cron/tournament-teams` ; migration `20261118130400_tournament_teams` |
| `TOURNAMENT_SCORES_ENABLED`, `VOTE_VETO_ENABLED`, `ROULETTE_PLAYER_FILTER_ENABLED` | facultatifs | à ne tester qu'après le socle |

### Retour arrière

Retirer d'abord `SESSION_VISIBILITY_ENABLED`, puis les interrupteurs d'écriture, puis ceux de commande. Les soirées et tournois restent en base. Les annonces, fils et vocaux déjà créés restent sur Discord.

### Tests que ChatGPT peut faire dans Discord

1. `/soiree liste` et `/soiree voir soiree:<soirée>` : lecture sans écriture (la réponse n'est normalement visible que de lui ; à vérifier).
2. `/soiree creer jeu:<jeu> date:<date> heure:<heure>` (écriture ; `places` facultatif) : une soirée est créée ; l'**annonce** apparaît **dans le salon des soirées** avec les boutons de réponse ; le **créateur reçoit un MP** et n'est **jamais mentionné** dans le fil (règle #116).
3. `/soiree rejoindre`, `/soiree quitter` : les places et la liste d'attente se mettent à jour ; l'annonce est **éditée**, pas dupliquée.
4. `/tournoi liste`, `/tournoi voir`, `/tournoi inscription`, `/tournoi desinscription`, `/tournoi mes-inscriptions`.
5. Création d'un tournoi par Maxime (application) : l'annonce apparaît dans le salon des tournois ; à l'inscription, **MP ciblé**, **aucun** `@everyone`.

### Tests que Maxime fait dans l'application

1. Créer une soirée (date, heure, jeu) : un seul écran, 3 champs obligatoires ; inviter le compte de test.
2. Voter pour un jeu, voir le calendrier et l'**abonnement iCal** si `CALENDAR_SUBSCRIPTIONS_ENABLED=true`.
3. Créer un tournoi, inscrire des joueurs, lancer le bracket, saisir un score (avec `TOURNAMENT_SCORES_ENABLED`).
4. Avec `SESSION_VISIBILITY_ENABLED` : passer une soirée en « publique » et vérifier qu'elle apparaît dans « Soirées ouvertes » **sans exposer son contenu**.

### Critère de réussite

Une soirée et un tournoi créés de bout en bout, annonce unique **éditée** (jamais dupliquée), MP **ciblés** seulement, **aucun** `@everyone`, listes lisibles côté Discord et côté application.

---

## Groupe 5 — Boosters

**Risque : élevé et difficile à tester seul** : pour voir un effet réel, **un compte de test doit réellement booster le serveur** (Nitro). Sans booster réel, on ne teste que la création du rôle et des salons.

### Variables

| Quoi | Valeur | Remarque |
| --- | --- | --- |
| `DISCORD_BOOSTERS_ENABLED` | `true` | Migration `20261118131200_booster_support` ; exige `NOTIFICATION_EXECUTOR_ENABLED` et le bot pour les écritures |
| Cron externe | `GET /api/cron/booster-sync` toutes les ~30 min (protégé `CRON_SECRET`) | **Aucun cron n'est créé par le dépôt** |
| `DISCORD_BOOSTER_ENABLED` | `true` | La commande `/boost` |
| Avant d'allumer | Vérifier que le **rôle du bot est au-dessus** du rôle « Soutien de la Tour » et qu'il a « Gérer les rôles » et « Gérer les salons » | Voir [BOOSTERS_NITRO.md](BOOSTERS_NITRO.md) |

Strictement **cosmétique** : jamais d'XP, d'étage, de vote ni de classement.

### Retour arrière

Retirer `DISCORD_BOOSTERS_ENABLED`. Le rôle « Soutien de la Tour » et les deux salons **restent** (jamais supprimés par le code) ; nettoyage manuel sur identifiant exact.

### Tests que ChatGPT peut faire dans Discord

1. `/boost` : liste des avantages Booster, réponse **privée**.
2. Après un passage du cron `booster-sync` **et** de l'executor : le rôle **« Soutien de la Tour »** existe **sans aucune permission** ; **deux salons** (`soutiens-de-la-tour` et un vocal « Soutiens de la Tour ») existent, **invisibles de @everyone**.
3. **Avec un vrai boost** sur un compte lié à GameNight : le rôle est attribué au testeur, qui **voit** les deux salons ; un compte non booster **ne les voit pas**.
4. À la fin du boost (ou en retirant le boost de test) : le rôle est **retiré automatiquement** au passage suivant du cron.

### Tests que Maxime fait

1. `/soutiens` (Mur des soutiens) : le testeur booster apparaît, **sans classement** ; un profil masqué n'apparaît pas.
2. Profil : badge Booster visible sur `/profil` et `/potes/[id]`.
3. Logs du cron `booster-sync` : passage terminé, `failed=0`.

### Critère de réussite

Rôle sans permission, salons réservés au seul rôle, attribution **et retrait** automatiques, **aucun avantage de jeu** accordé.

---

## Groupe 6 — Profils et personnalisation

**Risque : le plus faible (lecture et cosmétique).** À allumer **avant ou en parallèle** des autres groupes si tu veux voir les textes et la navigation d'ouverture ; aucune écriture Discord.

### Variables

| Quoi | Valeur | Migration |
| --- | --- | --- |
| `LAUNCH_TEXTS_ENABLED` | `true` | aucune |
| `NAV_TOWER_ENABLED` | `true` | aucune |
| `PROFILE_VISIBILITY_ENABLED` | `true` | `20261118103100_profile_visibility` |
| `GAME_LEVELS_ENABLED` | `true` | `20261118123100_user_game_levels` |
| `DISCORD_PROFILE_COMMAND_ENABLED` | `true` (commande `/profil`) | aucune |
| `PROFILE_CUSTOMIZATION_ENABLED` | `true` (**en dernier**, après les titres et cadres saisonniers qu'il met en valeur : `TOWER_SEASON_AWARDS_ENABLED`) | `20261118131300_profile_customization` |
| `MEDIA_PRIVACY_ENABLED` (si fusionné) | `true` | aucune : vidéo YouTube chargée au clic, confirmation d'accord des personnes visibles dans la galerie |
| `DISCORD_INVITE_URL` | URL d'invitation du serveur (non secrète) | aucune |

### Retour arrière

Retirer la variable : l'affichage revient à l'état précédent, les choix des membres restent en base.

### Tests que ChatGPT peut faire dans Discord

1. `/profil` : réponse **privée** avec étage, niveau, badges et équipes.
2. Sur une page de connexion (compte **non membre** ou navigation privée) : voir la phrase « accès réservé aux membres du serveur Discord The Tower » et le lien « Rejoindre le serveur » (avec `LAUNCH_TEXTS_ENABLED` et `DISCORD_INVITE_URL`).

### Tests que Maxime fait dans l'application

1. `/profil/parametres` : déclarer un niveau de jeu, masquer son profil (le compte de test disparaît de `/potes` pour les autres).
2. `/profil/personnalisation` : choisir un titre, une couleur de pseudo, un cadre ; vérifier le rendu sur `/profil` et sur `/potes/[id]` d'**un autre** compte ; **aucun** avantage de jeu.
3. Barre latérale et menu mobile : le lien **« The Tower »** est présent avec `NAV_TOWER_ENABLED`.
4. Mobile 320 px : la barre basse reste à six onglets.

### Critère de réussite

Textes d'ouverture lisibles, profil masquable **sans fuite** (un profil masqué n'est ni listé ni lisible), personnalisation **purement décorative**.

---

## Créer un vocal : que fait GameNight ?

**Il n'existe aucune commande `/vocal`** ni fonction « créer un vocal » à la demande. Trois fonctions créent des salons vocaux, chacune derrière son interrupteur :

| Besoin | Fonction | Interrupteur | Durée de vie |
| --- | --- | --- | --- |
| Un vocal **temporaire** pour une soirée | **Espace temporaire de soirée** : un fil privé **et** un vocal privé créés **30 minutes avant** le début d'une soirée planifiée qui a au moins un invité actif ; supprimés après la fin **seulement si le vocal est vide** | `SESSION_VISIBILITY_ENABLED` (+ `NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_BOT_TOKEN`, serveur et salon des soirées configurés) ; création et nettoyage par le cron `/api/cron/reminders` ; migration `20261118130300_session_visibility_waitlist` | Temporaire (supprimé quand la soirée est finie et le vocal vide) |
| Un vocal **permanent** pour une équipe | Espace d'équipe | `DISCORD_TEAM_SPACES_ENABLED` | Permanent (archivé = renommé, jamais supprimé) |
| Un vocal réservé aux boosters | Salons boosters | `DISCORD_BOOSTERS_ENABLED` | Permanent |

**Solution la plus simple pour tester un vocal temporaire** : allumer `SESSION_VISIBILITY_ENABLED` et créer une **soirée planifiée dans un peu plus de 30 minutes**, avec le compte de test invité. Au passage du cron `reminders` après T-30 min, le **vocal privé** apparaît (visible des seuls participants) ; après la fin de la soirée et quand il est vide, il est supprimé aux passages suivants.

Limites à connaître (voir [SOIREES_VISIBILITE.md](SOIREES_VISIBILITE.md)) : pas d'heure de fin dans le modèle (fin présumée = début + 6 h) ; un changement de date après la création de l'espace ne le recrée pas ; si la lecture de l'état vocal est impossible, **rien n'est supprimé** (nettoyage manuel). Permissions du bot à vérifier : Gérer les salons, Gérer les fils, Créer des fils privés, Voir les salons.

Si tu veux seulement un vocal ad hoc, sans soirée : **créer le salon à la main dans Discord**, c'est la solution la plus simple ; GameNight n'a pas besoin d'intervenir.

---

## Droits minimaux de GameNight

> **Pourquoi maintenant.** « Workshop » et « AppBot » n'apparaissent **nulle part dans le dépôt** : ce sont des rôles de ton serveur Discord, que je ne peux pas lire d'ici. D'après toi, ils donnent **Administrateur** au bot. Or **Administrateur contourne toutes les vérifications de permission** (documentation Discord : « ADMINISTRATOR overrides any potential permission overwrites »). Tant qu'il est présent, **les tests de ce document passent même si une permission manque** : ils ne prouvent rien. Retire-le **pendant la phase de test**, pas après l'annonce.

### 1. Les permissions que le bot utilise réellement

Établi à partir de `src/lib/discord-rest.ts`, `session-space-api.ts`, `discord-team-spaces.ts`, `booster-support-runner.ts`, `discord-role-command.ts`, `discord-setup-permissions.ts` et [DISCORD_COMMANDES.md](DISCORD_COMMANDES.md), puis recoupé avec la documentation officielle de Discord (ressources *Channel*, *Voice* et *Permissions*).

| Permission Discord | Bit | Ce que le code fait avec | Interrupteurs concernés |
| --- | ---: | --- | --- |
| **Voir les salons** | 10 | Lire les salons ; condition de toutes les autres permissions de salon | tous |
| **Envoyer des messages** | 11 | `POST /channels/{id}/messages` : annonces Tower, soirées, tournois, ticket staff | groupes 1, 4 ; `DISCORD_REPORT_COMMAND_ENABLED` |
| **Intégrer des liens** | 14 | Cartes (embeds) des annonces | groupes 1, 4 |
| **Voir l'historique des messages** | 16 | Relire un message de preuve Tower ; fils de discussion | groupe 1 |
| **Gérer les salons** | 4 | Créer un salon (`POST /guilds/{id}/channels`), le renommer (archiver un espace d'équipe), le supprimer (vocal temporaire) ; `/gamenight setup` | groupes 3, 4 (`SESSION_VISIBILITY_ENABLED`), 5 |
| **Gérer les rôles** | 28 | Créer un rôle, l'attribuer ou le retirer (`/role`, rôle d'équipe, « Soutien de la Tour ») ; ajouter ou retirer l'accès d'un membre à un salon (`PUT /channels/{id}/permissions/{membre}`) | groupes 2, 3, 4, 5 |
| **Créer des fils publics** | 35 | Fil de discussion d'une preuve, fil public d'un projet | groupe 1 (`TOWER_DISCORD_VOTES_ENABLED`), `PROJECT_ORGANIZER_ENABLED` |
| **Créer des fils privés** | 36 | Fil d'invitation de soirée, espace temporaire, fil privé d'un projet | groupe 4, `PROJECT_ORGANIZER_ENABLED` |
| **Envoyer des messages dans les fils** | 38 | Écrire dans un fil ; Discord l'exige aussi pour ajouter un membre à un fil | groupes 1, 4 |
| **Gérer les fils** | 34 | Supprimer ou archiver un fil | groupes 1, 4 |
| **Se connecter** (vocal) | 20 | **Lire l'état vocal d'un membre** : Discord exige que le bot puisse se connecter au salon (`GET /guilds/{id}/voice-states/{membre}`) ; sert à ne supprimer le vocal temporaire que s'il est vide | `SESSION_VISIBILITY_ENABLED` |
| **Parler** (vocal) | 21 | Le bot ne peut **accorder** à d'autres que les permissions qu'il possède lui-même : les vocaux privés donnent Voir, Se connecter et Parler | groupes 3, 4, 5 |

**Total : 12 permissions.** Masque Discord correspondant : **`395408657424`**. L'invitation actuelle de [DISCORD_COMMANDES.md](DISCORD_COMMANDES.md) (`395137076240`) contient les 9 premières **sans** « Gérer les rôles », « Se connecter » et « Parler » : elle suffit pour la Tour et les annonces, **pas** pour `/role`, les espaces d'équipe, les boosters ni le vocal de soirée.

**Ne demandent aucune permission de serveur** : les messages privés (`POST /users/@me/channels`), les réponses aux commandes et les éditions de réponse, l'enregistrement des commandes (scope `applications.commands`), la lecture des rôles, salons et membres (`GET`), la suppression **de ses propres** messages (annonces de tournoi), les webhooks de récompense (adresse secrète, sans rôle).

**Jamais utilisées, donc à ne pas accorder** : Administrateur, Gérer le serveur, Gérer les messages (supprimer les messages d'autrui), Mentionner @everyone, Bannir, Expulser, Gérer les webhooks, Gérer les pseudos, Exclure temporairement. Aucun appel du code n'en a besoin ; `@everyone` et `@here` sont de toute façon retirés des messages (`discord-rest.ts`).

### 2. Point de blocage : les salons privés créés par le bot

Le code crée des salons **privés** en refusant « Voir le salon » à `@everyone`, puis donne l'accès au rôle de l'équipe, aux participants ou au rôle booster. **Il ne donne aucun accès au bot lui-même** (`session-space-plan.ts`, `discord-team-spaces.ts`, `booster-support-runner.ts`). Avec Administrateur, ça passe. **Sans Administrateur**, le calcul de permissions de Discord retire « Voir le salon » au bot dans ces salons, et la documentation précise que **refuser « Voir le salon » refuse aussi implicitement toutes les autres permissions du salon**.

Conséquences prévisibles sans Administrateur, à confirmer par les tests du § 4 :

| Fonction | Ce qui risque de casser |
| --- | --- |
| Vocal temporaire de soirée (`SESSION_VISIBILITY_ENABLED`) | La lecture de l'état vocal échoue ; le code ne supprime **rien** quand il ne peut pas lire (par sécurité) : le vocal **reste**, nettoyage manuel |
| Espaces d'équipe (`DISCORD_TEAM_SPACES_ENABLED`) | Renommer les salons pour archiver une équipe |
| Salons boosters (`DISCORD_BOOSTERS_ENABLED`) | Même limite (renommage, gestion) |

**Décision à prendre avant de retirer Administrateur** :

- **Option A (recommandée)** : retire Administrateur **maintenant** pour les groupes 1, 2, 4 (sans `SESSION_VISIBILITY_ENABLED`) et 6, qui n'ont pas ce problème. Pour les groupes 3, 5 et le vocal temporaire de soirée, demande d'abord **une petite PR de correction** (non faite par ce document) : ajouter au bot, à la création de ces salons, une permission de **membre** à son propre identifiant (Voir, Se connecter, Parler, Envoyer, Lire l'historique), derrière un interrupteur éteint, avec test. Tant qu'elle n'est pas fusionnée, **n'active pas ces trois fonctions** si tu retires Administrateur.
- **Option B** : garde Administrateur pour la phase de test et assume le risque ; mais alors **aucun test ne prouve les droits minimaux** et il faudra refaire le § 4 après la correction.

### 3. Procédure pour retirer « Workshop » et « AppBot » du bot

Choisis un moment calme (aucun test de groupe en cours). Cette procédure ne supprime **aucun rôle** : elle les retire seulement **du bot**.

1. **Noter l'état de départ.** Paramètres du serveur → **Membres** → le bot GameNight : note la liste de ses rôles (captures). Paramètres du serveur → **Rôles** : pour « Workshop », « AppBot » et le rôle **intégré** du bot (celui que Discord a créé à l'invitation, au nom de l'application), regarde si la permission **Administrateur** est cochée.
2. **Vérifier qui d'autre porte « Workshop » et « AppBot »** (Rôles → clic sur le rôle → membres). Si d'autres bots ou personnes les utilisent, **ne supprime pas ces rôles**.
3. **Donner d'abord au bot ses 12 droits, avant de retirer quoi que ce soit.** Deux façons :
   - **Réinviter** l'application avec le lien ci-dessous (réinviter ne retire rien, il ajoute les droits manquants ; il faut un compte avec « Gérer le serveur ») ;
   - ou cocher à la main les 12 permissions sur le rôle **intégré** du bot (Paramètres → Rôles).

   ```
   https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=395408657424&guild_id=<TOWER_DISCORD_GUILD_ID>&disable_guild_select=true
   ```

   Remplace les deux valeurs depuis Vercel ou le portail développeur ; ne les écris dans aucun fichier du dépôt et ne colle **jamais** le jeton du bot dans un chat.
4. **Placer le rôle intégré du bot assez haut.** Paramètres → Rôles : fais glisser le rôle intégré du bot **au-dessus de tous les rôles qu'il doit attribuer ou créer** (rôles de jeux, rôles d'équipe, « Soutien de la Tour ») et **sous** les rôles de modération humains. « Gérer les rôles » ne permet d'agir que sur les rôles **plus bas** que le plus haut rôle du bot (le code refuse d'ailleurs d'attribuer un rôle au-dessus de celui du bot : `topRolePosition`). Si « Workshop » ou « AppBot » étaient **plus hauts** que le rôle intégré, le bot **perd cette hauteur** en les perdant : fais ce placement **avant** l'étape 6.
5. **Vérifier l'accès aux salons configurés.** Pour chaque salon utilisé par GameNight (défis et preuves, annonces générales, soirées, tournois, **salon staff des signalements**, salons réservés) : Modifier le salon → Permissions → le bot (ou son rôle) doit pouvoir **Voir le salon, Envoyer des messages, Intégrer des liens, Voir l'historique**. Un salon **privé** qui n'autorise que certains rôles est invisible du bot sans Administrateur : ajoute le rôle du bot à ce salon. (Pour dresser la liste : `TOWER_DISCORD_PREFLIGHT_ENABLED=true` donne un inventaire en lecture seule des salons, voir [TOWER_DISCORD_EXECUTION_T17.md](TOWER_DISCORD_EXECUTION_T17.md) ; ne le laisse pas allumé.)
6. **Retirer un rôle à la fois**, puis faire le test rapide ci-dessous entre les deux : d'abord « Workshop » (Membres → le bot → retirer le rôle), test rapide, puis « AppBot », test rapide.
7. **Contrôle final** : Paramètres → Membres → le bot : **plus aucun rôle portant Administrateur**, y compris le rôle intégré.

**Retour arrière (immédiat, sans redéploiement)** : Membres → le bot → ajouter de nouveau le rôle retiré. Aucune donnée n'est touchée.

### 4. Les tests qui prouvent que tout marche après

**Test rapide après chaque rôle retiré** (ChatGPT, compte membre de test) : `/aide` répond ; `/tower progression` répond ; `/role attribuer jeu:<rôle existant>` attribue le rôle ; une annonce de test (une soirée créée par Maxime) apparaît dans le salon des soirées. Un échec = remettre le rôle (retour arrière ci-dessus).

**Tests complets, sur les seules fonctions allumées** (reprend les tests de chaque groupe, avec ce qu'ils prouvent) :

| Fonction | Test | Résultat attendu | Permission prouvée |
| --- | --- | --- | --- |
| Annonces Tower (groupe 1) | Soumettre une preuve avec consentement | Annonce dans le salon des preuves, boutons ✅/❌ | Voir, Envoyer, Intégrer, Historique |
| Vote Tower (groupe 1) | Un second compte vote | Message **édité**, un **fil** créé une seule fois | Créer des fils publics, Envoyer dans les fils |
| `/role` (groupe 2) | `/role attribuer`, puis `/role retirer` ; avec la création par la file : `/role creer jeu:<jeu inconnu>` | Rôle attribué puis retiré ; rôle créé **sans permission** | Gérer les rôles + hauteur du rôle du bot |
| Équipes (groupe 3, **seulement après la correction du § 2**) | Créer une équipe, rejoindre, puis archiver | 1 rôle + 2 salons privés ; accès mis à jour ; archivage = salons renommés | Gérer les salons, Gérer les rôles, Se connecter, Parler |
| Soirée (groupe 4) | Créer une soirée, inviter le compte de test | Annonce unique **éditée**, MP au créateur, aucun `@everyone` | Voir, Envoyer, Intégrer |
| Vocal temporaire (groupe 4, **seulement après la correction du § 2**) | Soirée dans ~31 minutes avec un invité ; attendre T-30 ; la finir ; vocal vide | Fil privé + vocal privé créés ; **vocal supprimé** après la fin | Créer des fils privés, Gérer les salons, Se connecter |
| Boosters (groupe 5, **seulement après la correction du § 2**) | Passage du cron `booster-sync` et de l'executor | Rôle « Soutien de la Tour » sans permission + 2 salons invisibles de `@everyone` | Gérer les rôles, Gérer les salons |
| Signalement (si activé) | « Signaler » sur un message de test | Ticket dans le salon staff | Accès du bot à ce salon (étape 5) |

**Preuves globales à garder** :

1. Capture de Paramètres → Membres → le bot : aucun rôle avec **Administrateur** (étape 7).
2. `/admin/tableau-de-bord` (`ADMIN_DASHBOARD_V2_ENABLED=true`) : **opérations Discord échouées = 0**.
3. Logs Vercel pendant les tests et les 24 h suivantes : **aucun code `50013`** (permission manquante) ; c'est l'erreur Discord qui trahit un droit oublié.
4. Si un test échoue : note la **fonction**, le **code** (`50013` ou `50001`) et **l'heure** ; ne réessaie pas en boucle (limite de débit 429) ; remets le rôle retiré, puis corrige la permission manquante.

**Critère de réussite** : toutes les lignes ci-dessus passent **sans** Administrateur, **0** opération en échec et **0** erreur `50013` sur 24 h. Si une fonction du § 2 ne passe pas, c'est **attendu** tant que la correction du bot n'est pas fusionnée : garde-la éteinte.

---

## À renseigner avant d'allumer les pages légales

Les pages publiques `/mentions-legales`, `/confidentialite` et `/conditions` sont **éteintes par défaut** (404, aucun lien). Tant qu'une variable est vide, la page affiche **« À COMPLÉTER »** à sa place : n'allume l'interrupteur qu'une fois **toutes** les valeurs posées.

| Variable (Vercel → Production, non secrètes) | Contenu attendu | À décider par |
| --- | --- | --- |
| `LEGAL_PUBLISHER` | **Éditeur** du site : ton nom et tes coordonnées, **ou** le nom de l'association et son adresse, **ou** (personne physique qui veut rester anonyme) les coordonnées de l'hébergeur à la place (avis juridique conseillé) | Maxime |
| `LEGAL_PUBLICATION_DIRECTOR` | Directeur de la publication (souvent la même personne) | Maxime |
| `LEGAL_CONTACT_EMAIL` | Adresse e-mail **dédiée** pour les droits RGPD et le signalement de contenu illicite | Maxime |
| `LEGAL_MIN_AGE` | `13`, `15` ou `16` (toute autre valeur est refusée) | Maxime, avec avis juridique |
| `LEGAL_PAGES_ENABLED` | `true` **en dernier** | Maxime |

Autres champs « À COMPLÉTER » qui restent **dans le texte** de la politique et qui ne viennent pas d'une variable :

- **Région du stockage de fichiers Vercel Blob** (photos, clips, bannières) : à relever dans Vercel.
- **Garanties de transfert hors UE** pour chaque prestataire (clauses contractuelles types ou cadre de protection des données UE–États-Unis) : à faire valider par un juriste.
- **Durée de conservation** des preuves de défis Tower et des signalements de modération.
- **Date de mise à jour** des conditions d'utilisation.

Et avant d'allumer : **relecture des trois textes par Maxime** (décision du 22/11/2026 : pas d'avocat ; chaque page porte « Dernière mise à jour : <date> »), puis `DISCORD_INVITE_URL`, `ACCOUNT_DELETION_ENABLED` (export et suppression de compte, migration `20261121100000_account_deletion_log` appliquée d'abord) et, si tu l'as décidé, `MEDIA_PRIVACY_ENABLED`.

Contrôle après activation : les trois pages répondent **sans te connecter**, les trois liens sont au bas de la page de connexion et de chaque page, et **aucun « À COMPLÉTER »** ne s'affiche. Retour arrière : retirer `LEGAL_PAGES_ENABLED` puis redéployer.
