# Recette des 61 lignes actives du cahier

Relevé du 26/11/2026 sur `main` `4eec09f9`. Cette PR corrige aussi, dans le cahier, le **texte** de quatre incohérences, n°1, 2, 4 et 6 de la dernière section (la n°3, tranchée par Maxime, aligne le cahier des charges sur 3 jours), et le **statut de C089** (correction factuelle : flag allumé en Production depuis le 24/11). **Aucun autre statut de [CAHIER_FINAL.md](CAHIER_FINAL.md) n’est changé, aucune ligne ne passe au vert** ([décision D1](DECISIONS_PRODUIT_20261126.md)). Une ligne ne devient verte qu'après un **test réel fait par un compte non-admin, daté et consigné** dans le cahier, avec sa preuve. Un flag allumé, une page affichée ou un test automatisé ne suffisent pas.

**Périmètre** : les 148 lignes du cahier, moins les 77 « ✅ Fait » et les 9 reportées (C095 à C103), soit 61 lignes actives : 16 « codé, allumé, non vérifié », 4 « codé, non vérifié », 6 « partiel côté Discord », 23 « codé, éteint » et 12 « sans code » (C089 corrigée le 26/11 : flag allumé en Production).

## Conventions

**Comptes**
- **M** : membre non-admin (Melah, rôle MEMBER et non booster dans Neon le 25/11).
- **M2** : second membre non-admin, pour être l'autre capitaine, l'ami ou l'invité. **Il n'existe pas encore** : à créer, ou à demander à un vrai membre.
- **A** : administrateur (`!!ZeyFro`). Il sert seulement à préparer ou à observer, **jamais à prouver** une ligne.

**Qui fait le test**
- **Agent** : un agent avec Chrome, connecté comme M ou M2 dans GameNight et dans Discord.
- **Maxime** : Maxime seul, pour ce qui demande ses droits de propriétaire sur Discord, Vercel ou Neon, ou son accord.

**Preuve**
- Capture datée, avec l'heure de Paris et le compte visible.
- URL de la page.
- Pour la base, une requête **SELECT en lecture seule** (requêtes types dans [PROCEDURES_PREUVES.md](PROCEDURES_PREUVES.md) § « Requêtes SQL de lecture seule »).
- Le résultat est inscrit dans la colonne « Preuve attendue » du cahier, **sans changer le statut** tant que Maxime n'a pas validé.

**Allumage** : par lot, selon [ALLUMAGES.md](ALLUMAGES.md) (A à H), avec l'accord de Maxime, un lot à la fois. Aucun flag n'est allumé par ce document.

---

## Groupe A — 29 lignes stables (rien à coder)

### A1. Sans code (12) : actions humaines dans Discord ou sur le site

`PLAN_TESTS.md`, cité par le cahier, n'a **pas de section par ligne** pour ces 12 éléments. Les étapes ci-dessous en tiennent lieu.

| Id | Élément | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- |
| C104 | Parcours complet du joueur | M (puis M2) | Enchaîner, avec M, les parcours des groupes B et C déjà verts : découvrir, partenaires, soirées, équipes, Tour, défis, grades, compétitions. | Une capture par étape, puis un tableau récapitulatif daté qui renvoie aux lignes vertes. | Agent |
| C108 | Principes d'organisation (noms, emojis, mobile, pas de salon vide, fils et panneaux) | M | Parcourir le serveur sur mobile et sur ordinateur. Relever les salons vides, les noms sans emoji, les panneaux absents. | Captures mobile et ordinateur ; liste des écarts (vide si aucun). | Agent |
| C109 | Règlement et validation d'accès, rôle Régulars, test comme un vrai nouveau | Compte **neuf** | Rejoindre le serveur, lire le règlement, valider par YAGPDB, vérifier que le rôle Régulars est attribué et ce qui devient visible. | Captures avant et après validation ; SELECT sur `Membership` du compte neuf. | Maxime (invite) puis Agent |
| C111 | Direction artistique | M | Captures de l'icône, de la bannière, des panneaux et des annonces. | Planche de captures datée ; avis de Maxime. | Agent, avis de Maxime |
| C112 | Éléments visuels harmonisés | M | Mêmes éléments que C111, comparés entre eux (couleurs, ton). | Planche comparée ; écarts listés. | Agent, avis de Maxime |
| C115 | Plus de deux sources d'étages (Atlas arrêté) | A pour observer, M pour vérifier | Vérifier qu'Atlas n'attribue plus d'étage : aucun message d'Atlas après une activité de M. Atlas est à expulser ([PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md)). | Capture de la liste des membres et bots (Atlas absent) et du salon d'activité. | Maxime |
| C118 | YAGPDB : validation et sélection de rôles préservées | Compte neuf, M | Valider le règlement (C109), puis choisir un rôle hors jeu par YAGPDB ([D2](DECISIONS_PRODUIT_20261126.md) : rôles hors jeux = YAGPDB). | Captures du message YAGPDB et du rôle obtenu. | Agent |
| C120 | Ticket Tool réparé et réutilisé | M | Ouvrir un ticket depuis le panneau d'assistance, vérifier qu'il est privé, puis le fermer. | Captures du panneau, du ticket privé et de sa fermeture. | Agent (le staff ferme) |
| C121 | Appy conserve son rôle dans les candidatures | M | Ouvrir une candidature Appy, vérifier qu'elle arrive au staff. | Capture de la candidature reçue côté staff. | Agent puis Maxime |
| C123 | Anti-raid, anti-spam, contrôle des bots et applications | A | Relever les réglages AutoMod, la vérification, la liste des bots et leurs permissions. | Captures datées des réglages ; liste des bots. | Maxime |
| C125 | Exigences générales (testable, documenté, mobile, sans effet sur les autres communautés) | M | Vérifier sur mobile 3 pages clés et qu'aucune donnée d'une autre communauté n'apparaît. | Captures mobiles ; SELECT montrant 2 communautés distinctes et l'absence de fuite. | Agent |
| C127 | Développement communautaire (soirées hebdomadaires, créateurs, partenariats, réseaux) | — | Constater les soirées hebdomadaires réelles, le programme créateurs et les partenariats. | Liste datée des actions menées ; captures. | Maxime |

### A2. Partiel côté Discord (6) : procédures existantes

| Id | Prérequis | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- |
| C005 | Aucun | M | [PROCEDURES_PREUVES.md § C005](PROCEDURES_PREUVES.md) | Capture datée des sept espaces vus par M. | Agent |
| C011 | Aucun | A | [§ C011](PROCEDURES_PREUVES.md) : tableau des rôles par famille. | Capture datée de la liste des rôles. | Maxime |
| C053 | `SESSION_VISIBILITY_ENABLED` est **éteint** (C080 bloqué jusqu'à autorisation) ; `DISCORD_TEAM_SPACES_ENABLED` (lot G) est **éteint** | M, M2 | [§ C053](PROCEDURES_PREUVES.md). Le vocal d'équipe exige le lot G et #642 (D5, permissions par membre). | Captures des vocaux visibles par M et invisibles pour un non-membre. | Agent après allumage |
| C056 | Retirer à High Ranker les 3 permissions de modération vocale | A | Corriger le rôle, puis revérifier ([§ C056](PROCEDURES_PREUVES.md)). | **Déjà dans le dépôt** : vérification du 25/11 (Administrateur désactivé sur les 4 grades ; High Ranker garde muet, sourdine, déplacer). Reste la capture après correction. | Maxime |
| C059 | Aucun | M | [§ C059](PROCEDURES_PREUVES.md). | **Déjà dans le dépôt** : essai du 25/11 avec Melah (`/aide`, `/profil`, `/boost`, `/tower defi`, `/tower progression`, `/tower classement`). Reste ce que la colonne du cahier liste encore (formulaire de preuve, votes). | Agent |
| C093 | Aucun | A (journal Vercel) | [§ C093](PROCEDURES_PREUVES.md). | **Déjà dans le dépôt** : PR #613 et livraisons SENT dans Neon. Reste le journal Vercel d'une nouvelle écriture. | Maxime |

### A3. Codé, non vérifié en réel (4)

| Id | Prérequis | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- |
| C003 | `NOTIFICATION_EXECUTOR_ENABLED` présent | M | [§ C003](PROCEDURES_PREUVES.md) : une action GameNight, un seul message Discord, puis une interaction en retour. | **Déjà dans le dépôt** : contrôle SQL du 25/11 (groupes historiques de SEND répétés). Reste une nouvelle action sans doublon : SELECT sur `NotificationDelivery` et capture. | Maxime |
| D01 | `DISCORD_CONNECTIONS_SCOPE_ENABLED` (lot C), **éteint** | M | [§ D01](PROCEDURES_PREUVES.md) : refuser puis accepter le consentement `connections`. | Captures de l'écran OAuth et des suggestions préremplies. | Agent après allumage |
| D14 | `DISCORD_REPORT_COMMAND_ENABLED` allumé | M, puis A pour lire | [§ D14](PROCEDURES_PREUVES.md) : clic droit sur un message, « Signaler ». | Capture du ticket privé staff, sans aucune sanction ; SELECT sur `ModerationReport`. **Couvre aussi C057 et C088.** | Agent puis Maxime |
| D15 | `DISCORD_BOOSTERS_ENABLED` (voir l'incohérence 2 plus bas) | Un vrai booster | [§ D15](PROCEDURES_PREUVES.md). | Captures du rôle « Soutien de la Tour », du mur et des salons ; retrait automatique à la fin du boost. **Couvre aussi C089.** | Maxime (il faut un booster réel) |

### A4. Allumées, à tester sans code neuf (7)

| Id | Prérequis | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- |
| C001 | Aucun | M (non booster) | Refaire, sans Nitro ni boost, les parcours essentiels : soirée, équipe, `/tower defi`, `/profil`. Vérifier qu'aucun paiement n'est demandé. | **Déjà dans le dépôt** : Melah MEMBER, non booster, le 25/11 (`/aide`, `/profil`, `/boost`, `/tower`). Reste les autres fonctions essentielles. | Agent |
| C029 | `COMMUNITY_HIGHLIGHTS_ENABLED` allumé | M | Une fois des données réelles disponibles (un défi validé, un exploit saisi par un admin), ouvrir `/tower/palmares` et Profil → Lore. | Capture d'un exploit affiché. Un essai du 26/11 en lecture seule (#632, non fusionnée) n'a trouvé que des tableaux vides. | Agent |
| C052 | `TOWER_CHALLENGES_ENABLED`, `TEAM_RIVALRIES_ENABLED` allumés | M | Ouvrir classements, Hall of Fame et Rankers après des défis et des rivalités réels. | Captures avec données. Tableaux vides le 26/11 (#632). | Agent |
| C057 | `DISCORD_REPORT_COMMAND_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED` allumés | M, M2 | Déposer une preuve et un signalement avec M. Vérifier que M2 ne voit ni la preuve privée, ni le ticket, ni le journal. | Captures vues par M2 (accès refusé ou contenu absent). **D14 en est une partie.** | Agent |
| C078 | `TOWER_DISCORD_VOTES_ENABLED` allumé | M2 (membre depuis ≥ 3 jours) | Voter ✅ ou ❌ sur une preuve de M, ouvrir le fil de la preuve, changer son vote. | Captures du compteur mis à jour et du fil ; SELECT sur les votes. Ancienneté appliquée : **3 jours** (code, `CLAUDE.md`, cahier). Le cahier des charges §27.2 B est aligné sur 3 jours (incohérence 3, tranchée). | Agent |
| C088 | `DISCORD_REPORT_COMMAND_ENABLED` allumé | M | Comme D14. | Même preuve que D14 (ligne en double). | Agent |
| C089 | `DISCORD_BOOSTERS_ENABLED` = `true` en Production depuis le 24/11 (relevé Vercel du 26/11) | Un vrai booster | Comme D15 : rôle « Soutien de la Tour », mur, salons, retrait automatique à la fin du boost. | Captures (voir D15). | Maxime (il faut un booster réel) |

---

## Groupe B — 9 lignes à tester après le code neuf

À faire dans l'ordre de fusion. Chaque parcours a besoin de **M et M2**.

| Id | Prérequis (PR, migration, flag) | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- |
| C030 | #641 (D8 : passation journalisée), #642 (D5 : dissolution) ; flags `TEAM_APPLICATIONS_ENABLED` et `TEAM_RECRUITERS_ENABLED` (lot E) allumés | M, M2 | M crée une équipe ; M2 la trouve, candidate ; M accepte ; M nomme M2 recruteur. | Captures de chaque étape ; SELECT sur `TeamApplication` (`status`, `decidedById`). | Agent |
| C031 | `TEAM_RECRUITMENT_CRITERIA_ENABLED` allumé | M, M2 | M renseigne objectifs, critères et rendez-vous ; M2 les voit sur la fiche. | Capture de la fiche vue par M2, rendez-vous compris (absent le 26/11, #632). | Agent |
| C077 | #641 ; `TEAM_RECRUITERS_ENABLED` | M, M2 | Recruteur, puis invité de tournoi. La relance à 48 h et l'expiration à 7 jours demandent d'attendre : prévoir une date de contrôle. | Captures ; SELECT sur `TeamApplication.status = 'EXPIRED'` après 7 jours. | Agent (relance : contrôle différé) |
| C043 | #641 (migration `20261126210000_tournament_team_round_robin`, **à appliquer avec l'accord de Maxime**) ; `TOURNAMENT_SCORES_ENABLED` allumé | M, M2 | Créer un tournoi individuel, s'inscrire à deux, déclarer un résultat, voir le classement et l'annonce. | Captures ; SELECT sur `Tournament.status = 'DONE'`. | Agent |
| C081 | #641 ; `TOURNAMENT_TEAMS_ENABLED` allumé | M et M2 capitaines | Tournoi de 2 équipes : les deux capitaines confirment. Puis un désaccord, tranché par l'arbitre **après 24 h** (D6). La poule à 5 équipes demande 5 capitaines (voir le harnais dans #400). | Captures de la confirmation et du refus `too_early` avant 24 h ; SELECT sur `TournamentMatchReport`. | Agent (arbitre = Maxime) |
| C080 | D7 : #646 (brouillon, code et flag non activés) ; `SESSION_VISIBILITY_ENABLED` **éteint**, test bloqué jusqu'à autorisation explicite de Maxime | M, M2 | Créer une soirée publique, une sur candidature et une privée ; M2 candidate et passe par la liste d'attente ; espaces selon le mode puis suppression à la fin. | Captures ; SELECT sur `SessionDiscordSpace` et sur la suppression. | Agent |
| C083 | #641 (90 jours renouvelables) ; `PROJECT_ORGANIZER_ENABLED` allumé | M, M2 | M crée un projet ; M2 entre ; M valide ; vérifier les deux fils (annonce publique et fil privé, D9) ; clôture, puis archivage 7 jours après. | Captures des deux fils ; SELECT sur `Project.status`. | Agent (archivage : contrôle différé) |
| C084 | #636 (tests seulement), #634 fusionnée ; `TEAM_RIVALRIES_ENABLED` allumé | M, M2 | « Jouer maintenant » : M2 clique « Intéressé » puis « Rejoindre », expiration à 2 h. Rivalité : M défie l'équipe de M2, M2 accepte, les deux déclarent le résultat. | Captures ; une notification in-app au créateur. | Agent |
| C006 | #635 fusionnée, **publication du panneau seulement avec l'accord de Maxime** (D11) ; #640 (écran de première connexion) | Compte neuf | Après validation YAGPDB (C109), cliquer les trois boutons du panneau. | Captures des trois réponses privées ; aucun rôle changé. | Maxime (publication) puis Agent |

---

## Groupe C — 23 lignes éteintes, par lot d'allumage

Chaque lot s'allume entier, avec l'accord de Maxime ([ALLUMAGES.md](ALLUMAGES.md)), puis chaque ligne est testée par M (et M2 si indiqué).

| Lot | Id | Flag(s) | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | C091 | `ADMIN_DASHBOARD_V2_ENABLED` | A seulement | Ouvrir `/admin/tableau-de-bord` ; M obtient une 404. | Capture A et 404 de M. **Pour le contrôle d'accès, seule la vue de M compte.** | Maxime puis Agent |
| **B** | C008 | `TOWER_IRREGULAR_GRANTS_ENABLED` | A (attribue), M (voit) | Attribuer Irregular à M ; M le voit, sans aucun droit nouveau. | Captures ; SELECT sur le journal d'attribution. | Maxime puis Agent |
| **B** | C017 | `TOWER_TEAM_DAILY_ENABLED` + cron 18 h | M capitaine | Après le cron de 18 h, l'équipe reçoit son défi. | SELECT : attribution datée après 18 h et lien avec le cron (deux attributions des 24 et 25/11, d'origine non prouvée). | Maxime (cron) puis Agent |
| **B** | C020 | `TOWER_CHALLENGE_REPLACEMENT_ENABLED` | M | Défi sur un jeu non possédé : bouton « Remplacer », une seule fois. | Capture ; SELECT sur `TowerChallengeReplacement`. | Agent |
| **B** | C021 | `TOWER_CHALLENGE_PROPOSALS_ENABLED` | M Ranker (≥ 30 étages) | Proposer un défi ; l'admin le valide. | Captures ; SELECT sur le statut de la proposition. **Il faut un vrai Ranker.** | Agent puis Maxime |
| **B** | C079 | `TOWER_STEAM_AUTOVALIDATE_ENABLED` | M (Steam public) | Défi mesurable Steam, validation automatique ; « Signaler un doute » par M2. | Captures ; SELECT sur `measureValue`. | Agent |
| **B + C** | C050 | `TOWER_SEASON_AWARDS_ENABLED`, `PROFILE_CUSTOMIZATION_ENABLED` | M | Récompenses visibles sur le profil après une clôture de saison. | Captures. **Nécessite une fin de saison réelle.** | Agent (date différée) |
| **C** | C035 | `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED` (**état à confirmer par ChatGPT Work dans Vercel**) | M, M2 | M2 déclare un niveau de jeu et publie une annonce ; M filtre par jeu et par niveau. | Capture du résultat filtré. **Incohérence 1** : le cahier les dit éteints, mais #632 les a vus allumés en Production le 26/11. | Agent |
| **C** | C036 | `PLAYER_MATCHING_ENABLED` | M | Renseigner langue, préférences et habitudes. | Capture ; SELECT sur le profil de jeu de M. | Agent |
| **C** | C037 | `WHO_PLAYS_TONIGHT_ENABLED` | M, M2 | M2 se déclare dispo ; M le voit sur `/ce-soir`. | Capture vue par M. | Agent |
| **C** | C038 | `PLAYER_MATCHING_ENABLED` | M, M2 | Les partenaires compatibles de M incluent M2. | Capture. | Agent |
| **C** | C039 | `PROFILE_VISIBILITY_ENABLED`, `PLAYER_MATCHING_ENABLED` | M, M2 | M2 masque son profil ; M ne le trouve plus (annonces comprises : correctif dans #637). | Capture vue par M. | Agent |
| **C** | C040 | `GAME_PLATFORMS_ENABLED`, `GAME_LEVELS_ENABLED` | M | Remplir le profil (jeux, plateformes, niveaux, dispos). | Capture du profil vu par M2. | Agent |
| **C** | C086 | `DISCORD_CONNECTIONS_SCOPE_ENABLED`, `GAME_PLATFORMS_ENABLED` | M | Comme D01, puis crossplay sur une fiche jeu. | Captures. **Recoupe D01.** | Agent |
| **C** | C087 | `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED` | M, M2 | Niveau de jeu et matchmaking (tournoi équipes aléatoires). | Captures. **Recoupe C035.** | Agent |
| **C** | C090 | `PROFILE_CUSTOMIZATION_ENABLED` | M, M2 | M achète un élément décoratif ; M2 le voit ; `prefers-reduced-motion` coupe les effets. | Captures. | Agent |
| **C** | C128 | `POTES_FRIENDS_ENABLED` (**état à confirmer par ChatGPT Work dans Vercel**) | M, M2 | M cherche M2 par pseudo, envoie une demande, M2 accepte ; M2 voit une soirée publique de M (rejoindre) et une soirée privée (sur invitation). | Captures. **Incohérence 1** : #632 a observé l'interface Potes active le 26/11 alors que le cahier dit « éteint ». | Agent |
| **C** | C076 | `NOTIFICATION_CENTER_ENABLED` | M | Régler ses préférences ; s'abonner à un jeu. | Capture de `/notifications`. | Agent |
| **C** | C044 | `WHO_PLAYS_TONIGHT_ENABLED`, `NOTIFICATION_CENTER_ENABLED` | M | Parcourir « Ce soir », une fiche de soirée, la roulette, le calendrier et `/notifications`. | Captures. **Incohérence 4** : le cahier range `NOTIFICATION_CENTER_ENABLED` au lot G, `ALLUMAGES.md` au lot C. | Agent |
| **C** | C085 | `NOTIFICATION_CENTER_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED` | M, M2 | Un MP ciblé à M2, un message de fil, une annonce. Aucun @everyone (D10). | Captures ; SELECT sur `NotificationDelivery`. **Recoupe D09.** | Agent |
| **C** | D09 | `NOTIFICATION_CENTER_ENABLED`, `SESSION_VISIBILITY_ENABLED` | M (créateur), M2 (abonné au jeu) | Soirée publique d'un seul jeu : le rôle du jeu est mentionné ; M n'est jamais mentionné. | Capture du message ; liste des mentions autorisées. | Agent |
| **G** | C007 | `DISCORD_ROLE_COMMAND_ENABLED` | M | `/role` : choisir un rôle de jeu (D2 : rôles de jeu = GameNight). | Capture privée et rôle obtenu. | Agent |
| **G** | C082 | `DISCORD_ROLE_AUTOCREATE_ENABLED` | M | `/role` sur un jeu sans rôle : création par la file, une seule fois par semaine. | Captures ; SELECT sur `DiscordRoleRequest`. **D2 : l'alerte à 200 rôles sur 250 et le blocage à 200 sont à vérifier.** | Agent |

---

## Lignes couvertes autrement, et incohérences à faire trancher

**Doublons** : un seul test peut alimenter plusieurs lignes, mais chaque ligne garde sa propre preuve.
- **D14 = C088**, et une partie de **C057** : commande « Signaler ».
- **D15 = C089** : boosters.
- **D01 ⊂ C086** : consentement `connections`.
- **C035 ≈ C087** : niveau de jeu et matchmaking.
- **C085 ≈ D09 ≈ C076** : notifications.

**Incohérences**
1. **États de flags périmés** : C035 et C128 étaient dits « éteint » ; #632 (non fusionnée) a observé le 26/11 les niveaux de jeu et Potes **actifs** en Production. Le relevé Vercel du 26/11 est **incomplet** (liste tronquée : ces flags n'y figurent pas). **Texte corrigé dans le cahier** : « état à revérifier dans Vercel ». **À confirmer par ChatGPT Work dans Vercel** ; ces deux lignes restent dans le groupe C tant que ce n'est pas fait.
2. **`DISCORD_BOOSTERS_ENABLED`** : « allumé » en C001, « éteint » en C089. Le relevé Vercel du 26/11 donne `true` en Production (mis à jour le 24/11). **Statut de C089 corrigé** en « Codé, allumé, non vérifié en réel » (décision de Maxime du 26/11 : correction factuelle, pas un passage au vert) ; C089 passe du groupe C au groupe A4.
3. **C078, ancienneté des votants** (tranché par Maxime le 26/11 : **3 jours**, décision du 23/11 ; §27.2 B du cahier des charges aligné) : le cahier, le code (`TOWER_VOTER_MIN_TENURE_MS`), `CLAUDE.md` et `TOWER_VOTES_DISCORD.md` disent **3 jours**. Seul le cahier des charges (§27.2 B, décisions du 18/11) dit **7 jours**. Le passage à 3 jours vient d'une décision de Maxime du 23/11 (constat 1.4, commit `91be15bc`). `DECISIONS_TOWER.md` du 17/11 ne fixe aucune ancienneté. **Maxime a tranché le 26/11 : 3 jours.**
4. **`NOTIFICATION_CENTER_ENABLED`** : lot G dans le cahier (C044, C085, D09), lot C dans `ALLUMAGES.md`. **Texte du cahier corrigé** : lot C.
5. **C042** (« ✅ Fait », hors des 61) : #632 en conteste le contenu ICS. À regarder avant le lancement, même si la ligne n'est pas comptée ici.
6. **Lignes sans code** : `PLAN_TESTS.md` était cité comme « procédure », mais n'a aucune section par ligne. **Texte des 12 lignes corrigé dans le cahier** : la procédure renvoie au groupe A1 ci-dessus.

## Ce que ce document ne prouve pas

Rien n'est testé ici : c'est un plan. Les preuves déjà présentes dans le dépôt (C001, C003, C056, C059, C093, C017) sont citées, pas recréées. Il manque à ce jour un **second compte non-admin (M2)** pour presque tout le groupe B et la moitié du groupe C.
