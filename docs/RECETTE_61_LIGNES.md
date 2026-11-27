# Recette des 61 lignes actives du cahier

Relevé du 27/11/2026, après le relevé Vercel Production et les preuves automatisées de #648. Ce document est un **plan de recette** : les statuts font foi dans [CAHIER_FINAL.md](CAHIER_FINAL.md). La règle de preuve est celle amendée le 27/11 : **ZeyFro ou Melah** sont acceptés ; l’**accès, la visibilité, la confidentialité et l’arrivée** se vérifient avec **Melah** ; pour les lignes à **3 comptes ou plus**, un **scénario automatisé multi-utilisateurs** daté et consigné est accepté, les **éléments Discord** restant vérifiés en réel.

**Périmètre** : 61 lignes actives. Cinq passent au vert par preuve automatisée (**C021, C030, C031, C077, C084**) et neuf ont une preuve automatisée prête avec un contrôle réel restant (**C008, C017, C029, C057, C078, C079, C083, C088, D14**). Les autres restent à tester en réel ; **C050 garde son statut** (consigne du 27/11). Les parcours des cinq lignes vertes restent utiles comme **contrôles de non-régression facultatifs**.

## Conventions

**Comptes**
- **M** : Melah, membre de The Tower (rôle MEMBER et non booster dans Neon le 25/11).
- **M2** : second compte accepté (**ZeyFro ou Melah**), pour être l'autre capitaine, l'ami ou l'invité. Pour une ligne à **3 comptes ou plus**, le scénario automatisé multi-utilisateurs remplace M2.
- **A** : `!!ZeyFro`, administrateur. Il prépare ou observe, et peut prouver les lignes que la règle du 27/11 accepte.

**Qui fait le test**
- **Agent** : un agent avec Chrome, connecté comme M, M2 ou ZeyFro dans GameNight et dans Discord.
- **Maxime** : Maxime seul, pour ce qui demande ses droits de propriétaire sur Discord, Vercel ou Neon, ou son accord.

**Preuve**
- Capture datée, avec l'heure de Paris et le compte visible.
- URL de la page.
- Pour la base, une requête **SELECT en lecture seule** (requêtes types dans [PROCEDURES_PREUVES.md](PROCEDURES_PREUVES.md) § « Requêtes SQL de lecture seule »).
- Le résultat est inscrit dans la colonne « Preuve attendue » du cahier, **sans changer le statut** tant que Maxime n'a pas validé.
- Pour une ligne à 3 comptes ou plus, le rapport du scénario automatisé (fichier, nombre d'utilisateurs, résultat) est joint à la preuve ; les éléments Discord sont vérifiés séparément en réel.

**Allumage** : les flags du relevé Production du 27/11 sont déjà allumés ([ALLUMAGES.md](ALLUMAGES.md)). Aucun autre flag n'est allumé par ce document ; tout nouvel allumage demande l'accord de Maxime, un lot à la fois.

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
| C053 | `SESSION_VISIBILITY_ENABLED` et `DISCORD_TEAM_SPACES_ENABLED` sont **allumés** (Vercel 27/11) | M, M2 | [§ C053](PROCEDURES_PREUVES.md). Le vocal d'équipe exige #642 (D5, permissions par membre). | Captures des vocaux visibles par M et invisibles pour un non-membre. | Agent |
| C056 | Retirer à High Ranker les 3 permissions de modération vocale | A | Corriger le rôle, puis revérifier ([§ C056](PROCEDURES_PREUVES.md)). | **Déjà dans le dépôt** : vérification du 25/11 (Administrateur désactivé sur les 4 grades ; High Ranker garde muet, sourdine, déplacer). Reste la capture après correction. | Maxime |
| C059 | Aucun | M | [§ C059](PROCEDURES_PREUVES.md). | **Déjà dans le dépôt** : essai du 25/11 avec Melah (`/aide`, `/profil`, `/boost`, `/tower defi`, `/tower progression`, `/tower classement`). Reste ce que la colonne du cahier liste encore (formulaire de preuve, votes). | Agent |
| C093 | Aucun | A (journal Vercel) | [§ C093](PROCEDURES_PREUVES.md). | **Déjà dans le dépôt** : PR #613 et livraisons SENT dans Neon. Reste le journal Vercel d'une nouvelle écriture. | Maxime |

### A3. Codé, non vérifié ou preuve automatisée prête (4)

| Id | Prérequis | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- |
| C003 | `NOTIFICATION_EXECUTOR_ENABLED` présent | M | [§ C003](PROCEDURES_PREUVES.md) : une action GameNight, un seul message Discord, puis une interaction en retour. | **Déjà dans le dépôt** : contrôle SQL du 25/11 (groupes historiques de SEND répétés). Reste une nouvelle action sans doublon : SELECT sur `NotificationDelivery` et capture. | Maxime |
| D01 | `DISCORD_CONNECTIONS_SCOPE_ENABLED` **allumé** (Vercel 27/11) | M | [§ D01](PROCEDURES_PREUVES.md) : refuser puis accepter le consentement `connections`. | Captures de l'écran OAuth et des suggestions préremplies. | Agent |
| D14 | `DISCORD_REPORT_COMMAND_ENABLED` allumé | M, puis A pour lire | [§ D14](PROCEDURES_PREUVES.md) : clic droit sur un message, « Signaler ». | Capture du ticket privé staff, sans aucune sanction ; SELECT sur `ModerationReport`. **Couvre aussi C057 et C088.** | Agent puis Maxime |
| D15 | `DISCORD_BOOSTERS_ENABLED` (voir l'incohérence 2 plus bas) | Un vrai booster | [§ D15](PROCEDURES_PREUVES.md). | Captures du rôle « Soutien de la Tour », du mur et des salons ; retrait automatique à la fin du boost. **Couvre aussi C089.** | Maxime (il faut un booster réel) |

### A4. Allumées, contrôles réels restants (7)

| Id | Prérequis | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- |
| C001 | Aucun | M (non booster) | Refaire, sans Nitro ni boost, les parcours essentiels : soirée, équipe, `/tower defi`, `/profil`. Vérifier qu'aucun paiement n'est demandé. | **Déjà dans le dépôt** : Melah MEMBER, non booster, le 25/11 (`/aide`, `/profil`, `/boost`, `/tower`). Reste les autres fonctions essentielles. | Agent |
| C029 | `COMMUNITY_HIGHLIGHTS_ENABLED` allumé | M | Une fois des données réelles disponibles (un défi validé, un exploit saisi par un admin), ouvrir `/tower/palmares` et Profil → Lore. | Capture d'un exploit affiché. Un essai du 26/11 en lecture seule (#632, non fusionnée) n'a trouvé que des tableaux vides. | Agent |
| C052 | `TOWER_CHALLENGES_ENABLED`, `TEAM_RIVALRIES_ENABLED` allumés | M | Ouvrir classements, Hall of Fame et Rankers après des défis et des rivalités réels. | Captures avec données. Tableaux vides le 26/11 (#632). | Agent |
| C057 | `DISCORD_REPORT_COMMAND_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED` allumés | M, M2 | Déposer une preuve et un signalement avec M. Vérifier que M2 ne voit ni la preuve privée, ni le ticket, ni le journal. | Captures vues par M2 (accès refusé ou contenu absent). **D14 en est une partie.** | Agent |
| C078 | `TOWER_DISCORD_VOTES_ENABLED` allumé | M2 (membre depuis ≥ 3 jours) | Voter ✅ ou ❌ sur une preuve de M, ouvrir le fil de la preuve, changer son vote. | Captures du compteur mis à jour et du fil ; SELECT sur les votes. Ancienneté appliquée : **3 jours** (code, `CLAUDE.md`, cahier). Le cahier des charges §27 B est aligné sur 3 jours (décision du 23/11). | Agent |
| C088 | `DISCORD_REPORT_COMMAND_ENABLED` allumé | M | Comme D14. | Même preuve que D14 (ligne en double). | Agent |
| C089 | `DISCORD_BOOSTERS_ENABLED` = `true` en Production depuis le 24/11 (relevé Vercel du 27/11) | Un vrai booster | Comme D15 : rôle « Soutien de la Tour », mur, salons, retrait automatique à la fin du boost. | Captures (voir D15). | Maxime (il faut un booster réel) |

---

## Groupe B — 9 lignes, dont 4 passées au vert par preuve automatisée

C030, C031, C077 et C084 sont passées au vert le 27/11 ([PREUVES_AUTOMATISEES.md](PREUVES_AUTOMATISEES.md)) ; les autres restent à tester en réel. Chaque parcours réel a besoin de **M et M2**.

| Id | Prérequis (PR, migration, flag) | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- |
| C030 | #641 (D8 : passation journalisée), #642 (D5 : dissolution) ; flags `TEAM_APPLICATIONS_ENABLED` et `TEAM_RECRUITERS_ENABLED` (lot E) allumés | M, M2 | M crée une équipe ; M2 la trouve, candidate ; M accepte ; M nomme M2 recruteur. | ✅ Fait (preuve automatisée multi-utilisateurs, décision du 27/11) : [PREUVES_AUTOMATISEES.md](PREUVES_AUTOMATISEES.md) § C030 (5 utilisateurs). Parcours réel facultatif de non-régression. | Agent |
| C031 | `TEAM_RECRUITMENT_CRITERIA_ENABLED` allumé | M, M2 | M renseigne objectifs, critères et rendez-vous ; M2 les voit sur la fiche. | ✅ Fait (preuve automatisée multi-utilisateurs, décision du 27/11) : [PREUVES_AUTOMATISEES.md](PREUVES_AUTOMATISEES.md) § C031 (fiche relue par un autre membre). Parcours réel facultatif. | Agent |
| C077 | #641 ; `TEAM_RECRUITERS_ENABLED` | M, M2 | Recruteur, puis invité de tournoi. La relance à 48 h et l'expiration à 7 jours demandent d'attendre : prévoir une date de contrôle. | ✅ Fait (preuve automatisée multi-utilisateurs, décision du 27/11) : [PREUVES_AUTOMATISEES.md](PREUVES_AUTOMATISEES.md) § C077 (relance 48 h et expiration 7 j simulées). | Agent |
| C043 | #641 (migration `20261126210000_tournament_team_round_robin`, **à appliquer avec l'accord de Maxime**) ; `TOURNAMENT_SCORES_ENABLED` allumé | M, M2 | Créer un tournoi individuel, s'inscrire à deux, déclarer un résultat, voir le classement et l'annonce. | Captures ; SELECT sur `Tournament.status = 'DONE'`. | Agent |
| C081 | #641 ; `TOURNAMENT_TEAMS_ENABLED` allumé | M et M2 capitaines | Tournoi de 2 équipes : les deux capitaines confirment. Puis un désaccord, tranché par l'arbitre **après 24 h** (D6). La poule à 5 équipes demande 5 capitaines (voir le harnais dans #400). | Captures de la confirmation et du refus `too_early` avant 24 h ; SELECT sur `TournamentMatchReport`. | Agent (arbitre = Maxime) |
| C080 | D7 : #646 (brouillon, code et flag non activés) ; `SESSION_VISIBILITY_ENABLED` **allumé** (Vercel 27/11) | M, M2 | Créer une soirée publique, une sur candidature et une privée ; M2 candidate et passe par la liste d'attente ; espaces selon le mode puis suppression à la fin. | Captures ; SELECT sur `SessionDiscordSpace` et sur la suppression. | Agent |
| C083 | #641 (90 jours renouvelables) ; `PROJECT_ORGANIZER_ENABLED` allumé | M, M2 | M crée un projet ; M2 entre ; M valide ; vérifier les deux fils (annonce publique et fil privé, D9) ; clôture, puis archivage 7 jours après. | Captures des deux fils ; SELECT sur `Project.status`. | Agent (archivage : contrôle différé) |
| C084 | #636 (tests seulement), #634 fusionnée ; `TEAM_RIVALRIES_ENABLED` allumé | M, M2 | « Jouer maintenant » : M2 clique « Intéressé » puis « Rejoindre », expiration à 2 h. Rivalité : M défie l'équipe de M2, M2 accepte, les deux déclarent le résultat. | ✅ Fait (preuve automatisée multi-utilisateurs, décision du 27/11) : [PREUVES_AUTOMATISEES.md](PREUVES_AUTOMATISEES.md) § C084 (deux capitaines, trois intéressés). | Agent |
| C006 | #635 fusionnée, **publication du panneau seulement avec l'accord de Maxime** (D11) ; #640 (écran de première connexion) | Compte neuf | Après validation YAGPDB (C109), cliquer les trois boutons du panneau. | Captures des trois réponses privées ; aucun rôle changé. | Maxime (publication) puis Agent |

---

## Groupe C — 23 lignes, flags désormais allumés

Les flags de ces lignes sont allumés en Production depuis le 23–24/11 ([ALLUMAGES.md](ALLUMAGES.md)). Chaque ligne reste à tester par M (et M2 si indiqué). **C050 garde son statut** et attend une fin de saison réelle.

| Lot | Id | Flag(s) | Compte | Étapes | Preuve attendue | Qui |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | C091 | `ADMIN_DASHBOARD_V2_ENABLED` | A seulement | Ouvrir `/admin/tableau-de-bord` ; M obtient une 404. | Capture A et 404 de M. **Pour le contrôle d'accès, seule la vue de M compte.** | Maxime puis Agent |
| **B** | C008 | `TOWER_IRREGULAR_GRANTS_ENABLED` | A (attribue), M (voit) | Attribuer Irregular à M ; M le voit, sans aucun droit nouveau. | Captures ; SELECT sur le journal d'attribution. | Maxime puis Agent |
| **B** | C017 | `TOWER_TEAM_DAILY_ENABLED` + cron 18 h | M capitaine | Après le cron de 18 h, l'équipe reçoit son défi. | SELECT : attribution datée après 18 h et lien avec le cron (deux attributions des 24 et 25/11, d'origine non prouvée). | Maxime (cron) puis Agent |
| **B** | C020 | `TOWER_CHALLENGE_REPLACEMENT_ENABLED` | M | Défi sur un jeu non possédé : bouton « Remplacer », une seule fois. | Capture ; SELECT sur `TowerChallengeReplacement`. | Agent |
| **B** | C021 | `TOWER_CHALLENGE_PROPOSALS_ENABLED` | M Ranker (≥ 30 étages) | Proposer un défi ; l'admin le valide. | ✅ Fait (preuve automatisée multi-utilisateurs, décision du 27/11) : [PREUVES_AUTOMATISEES.md](PREUVES_AUTOMATISEES.md) § C021 (6 utilisateurs). Parcours réel facultatif. | Agent |
| **B** | C079 | `TOWER_STEAM_AUTOVALIDATE_ENABLED` | M (Steam public) | Défi mesurable Steam, validation automatique ; « Signaler un doute » par M2. | Captures ; SELECT sur `measureValue`. | Agent |
| **B + C** | C050 | `TOWER_SEASON_AWARDS_ENABLED`, `PROFILE_CUSTOMIZATION_ENABLED` | M | Récompenses visibles sur le profil après une clôture de saison. | Captures. **Nécessite une fin de saison réelle.** | Agent (date différée) |
| **C** | C035 | `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED` **allumés** (Vercel 27/11) | M, M2 | M2 déclare un niveau de jeu et publie une annonce ; M filtre par jeu et par niveau. | Capture du résultat filtré. | Agent |
| **C** | C036 | `PLAYER_MATCHING_ENABLED` | M | Renseigner langue, préférences et habitudes. | Capture ; SELECT sur le profil de jeu de M. | Agent |
| **C** | C037 | `WHO_PLAYS_TONIGHT_ENABLED` | M, M2 | M2 se déclare dispo ; M le voit sur `/ce-soir`. | Capture vue par M. | Agent |
| **C** | C038 | `PLAYER_MATCHING_ENABLED` | M, M2 | Les partenaires compatibles de M incluent M2. | Capture. | Agent |
| **C** | C039 | `PROFILE_VISIBILITY_ENABLED`, `PLAYER_MATCHING_ENABLED` | M, M2 | M2 masque son profil ; M ne le trouve plus (annonces comprises : correctif dans #637). | Capture vue par M. | Agent |
| **C** | C040 | `GAME_PLATFORMS_ENABLED`, `GAME_LEVELS_ENABLED` | M | Remplir le profil (jeux, plateformes, niveaux, dispos). | Capture du profil vu par M2. | Agent |
| **C** | C086 | `DISCORD_CONNECTIONS_SCOPE_ENABLED`, `GAME_PLATFORMS_ENABLED` | M | Comme D01, puis crossplay sur une fiche jeu. | Captures. **Recoupe D01.** | Agent |
| **C** | C087 | `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED` | M, M2 | Niveau de jeu et matchmaking (tournoi équipes aléatoires). | Captures. **Recoupe C035.** | Agent |
| **C** | C090 | `PROFILE_CUSTOMIZATION_ENABLED` | M, M2 | M achète un élément décoratif ; M2 le voit ; `prefers-reduced-motion` coupe les effets. | Captures. | Agent |
| **C** | C128 | `POTES_FRIENDS_ENABLED` **allumé** (Vercel 27/11) | M, M2 | M cherche M2 par pseudo, envoie une demande, M2 accepte ; M2 voit une soirée publique de M (rejoindre) et une soirée privée (sur invitation). | Captures. | Agent |
| **C** | C076 | `NOTIFICATION_CENTER_ENABLED` | M | Régler ses préférences ; s'abonner à un jeu. | Capture de `/notifications`. | Agent |
| **C** | C044 | `WHO_PLAYS_TONIGHT_ENABLED`, `NOTIFICATION_CENTER_ENABLED` | M | Parcourir « Ce soir », une fiche de soirée, la roulette, le calendrier et `/notifications`. | Captures. **Incohérence 4** : le cahier range `NOTIFICATION_CENTER_ENABLED` au lot G, `ALLUMAGES.md` au lot C. | Agent |
| **C** | C085 | `NOTIFICATION_CENTER_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED` | M, M2 | Un MP ciblé à M2, un message de fil, une annonce. Aucun @everyone (D10). | Captures ; SELECT sur `NotificationDelivery`. **Recoupe D09.** | Agent |
| **C** | D09 | `NOTIFICATION_CENTER_ENABLED`, `SESSION_VISIBILITY_ENABLED` | M (créateur), M2 (abonné au jeu) | Soirée publique d'un seul jeu : le rôle du jeu est mentionné ; M n'est jamais mentionné. | Capture du message ; liste des mentions autorisées. | Agent |
| **G** | C007 | `DISCORD_ROLE_COMMAND_ENABLED` | M | `/role` : choisir un rôle de jeu (D2 : rôles de jeu = GameNight). | Capture privée et rôle obtenu. | Agent |
| **G** | C082 | `DISCORD_ROLE_AUTOCREATE_ENABLED` | M | `/role` sur un jeu sans rôle : création par la file, une seule fois par semaine. | Captures ; SELECT sur `DiscordRoleRequest`. **D2 : l'alerte à 200 rôles sur 250 et le blocage à 200 sont à vérifier.** | Agent |

---

## Lignes couvertes autrement, et points corrigés

**Doublons** : un seul test peut alimenter plusieurs lignes, mais chaque ligne garde sa propre preuve.
- **D14 = C088**, et une partie de **C057** : commande « Signaler ».
- **D15 = C089** : boosters.
- **D01 ⊂ C086** : consentement `connections`.
- **C035 ≈ C087** : niveau de jeu et matchmaking.
- **C085 ≈ D09 ≈ C076** : notifications.

**Incohérences**
1. **États de flags** : le relevé Vercel Production du 27/11 donne `GAME_LEVELS_ENABLED`, `GAME_LEVELS_MATCHMAKING_ENABLED` et `POTES_FRIENDS_ENABLED` à `true` (ajoutés les 23–24/11). Le cahier et ce document sont alignés ; ces lignes restent à tester en réel.
2. **`DISCORD_BOOSTERS_ENABLED`** : C001 et C089 sont désormais alignés sur `true` en Production (relevé Vercel du 27/11, mis à jour le 24/11). C089 est en « Codé, allumé, non vérifié en réel », dans le groupe A4.
3. **C078, ancienneté des votants** : le cahier des charges §27 B, `CAHIER_FINAL.md`, le code (`TOWER_VOTER_MIN_TENURE_MS`), `CLAUDE.md` et `TOWER_VOTES_DISCORD.md` sont alignés sur **3 jours** (décision de Maxime du 23/11, constat 1.4). Aucun écart restant.
4. **`NOTIFICATION_CENTER_ENABLED`** : lot G dans le cahier (C044, C085, D09), lot C dans `ALLUMAGES.md`. **Texte du cahier corrigé** : lot C.
5. **C042** (« ✅ Fait », hors des 61) : #632 en conteste le contenu ICS. À regarder avant le lancement, même si la ligne n'est pas comptée ici.
6. **Lignes sans code** : `PLAN_TESTS.md` était cité comme « procédure », mais n'a aucune section par ligne. **Texte des 12 lignes corrigé dans le cahier** : la procédure renvoie au groupe A1 ci-dessus.

## Ce que ce document ne prouve pas

Rien n'est testé ici : c'est un plan. Les preuves déjà présentes dans le dépôt (C001, C003, C056, C059, C093, C017) sont citées, pas recréées. Les lignes à 3 comptes ou plus peuvent utiliser un scénario automatisé ([PREUVES_AUTOMATISEES.md](PREUVES_AUTOMATISEES.md)) ; les autres utilisent **Melah** et, si besoin, **ZeyFro** comme second compte.
