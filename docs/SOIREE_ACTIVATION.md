# Soirée d'activation de la Tour — pas-à-pas

> **Document de préparation. Rien n'est exécuté ni activé par ce fichier** : aucune variable Vercel, aucune requête Neon, aucune action Discord n'a été faite pour l'écrire. Chaque action ci-dessous est faite **par toi** (Maxime), à la main. Il s'écrit pour quelqu'un qui n'a jamais ouvert Vercel ni Neon : chaque geste est décrit pas à pas.
>
> Sources : [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md) (décision du 17/11 et ordre d'activation), [TOWER_ATLAS_ARRET.md](TOWER_ATLAS_ARRET.md), [DISCORD_COMMANDES.md](DISCORD_COMMANDES.md), `scripts/register-tower-guild-commands.mjs`, et le code de `main` (`cf28cd3`). Les gestes dans Vercel, Neon, GitHub, Discord et PowerShell ont été relus dans leurs documentations officielles le 20/11/2026 ; **les écrans peuvent avoir changé de libellé** : si un bouton n'a pas exactement ce nom, cherche le plus proche et arrête-toi en cas de doute.
>
> **Mise à jour du 20/11/2026 (relevés en lecture seule) :** le projet Neon `misty-tooth-45335023` (nom `gamenight`, branche `production`) **est la Production** ; le drapeau communautaire de The Tower est **déjà à `true`** en base ; le catalogue de défis est **vide** (0 défi) ; les variables `TOWER_CHALLENGES_ENABLED` et `TOWER_DISCORD_ANNOUNCE_ENABLED` sont **absentes** de Vercel.
>
> Règle d'or : **ne colle jamais un jeton, un mot de passe ou un secret dans le chat, un ticket ou un fichier du dépôt.**

## 0. Vue d'ensemble

### Les 4 interrupteurs

| N° | Interrupteur | Où | Valeur exacte | Obligatoire ce soir ? |
| --- | --- | --- | --- | --- |
| 1 | `TOWER_CHALLENGES_ENABLED` | Vercel (Production) | `true` | Oui |
| 2 | `TOWER_DISCORD_ANNOUNCE_ENABLED` | Vercel (Production), **même redéploiement que le 1** | `true` | Oui |
| 3 | `Community.towerChallengesEnabled` | Base de Production (Neon), serveur The Tower | `true` : **déjà posé** (relevé du 20/11), simple contrôle en lecture seule (section 2) | Déjà fait |
| 4 | `TOWER_TEAM_DAILY_ENABLED` | Vercel (Production) **et** variable GitHub Actions du même nom | `true` aux deux endroits | **Non**, seulement si ses conditions sont remplies (section 5) |

La valeur doit valoir **exactement** `true` : en minuscules, sans guillemets, sans espace. `True`, `TRUE`, `1`, `oui` ne fonctionnent pas (le code compare à la chaîne `true`).

Le 3 est **déjà à `true`** : il ne reste que les variables 1 et 2. **Le redéploiement ouvre donc la Tour d'un coup** pour les membres de The Tower, sans autre porte. C'est pourquoi `/tower-admin importer` se fait **avant toute annonce** (section 3) : tant que le catalogue est vide, aucun défi ne peut être attribué.

### Ordre de la soirée

| N° | Heure | Étape | Qui | Section | Durée |
| ---: | --- | --- | --- | --- | --- |
| — | Avant | Contrôle du drapeau communautaire (lecture seule) et prérequis | Maxime | 2 | 10 min |
| 1 | H+0:00 | **Yuichiro met Atlas en pause** | Yuichiro | 4 | 15 min |
| 2 | H+0:15 | **Variables Vercel** (interrupteurs 1 et 2) | Maxime | 1 | 5 min |
| 3 | H+0:20 | **Un seul redéploiement** : la Tour s'ouvre d'un coup | Maxime | 6 | 10 min |
| 4 | H+0:30 | **`/tower-admin importer`** puis `importer-equipe`, **avant toute annonce** | Maxime | 3 | 5 min |
| 5 | H+0:40 | **Enregistrement des 13 commandes** depuis le PC de Maxime (`--check`, `--execute`, `--check`) | Maxime | 8 | 15 min |
| 6 | H+0:55 | **Test minimal** | Maxime | 7 | 10 min |
| — | H+1:10 | Parcours réel avec les testeurs, puis annonce ([ACTIVATION_TOUR.md](ACTIVATION_TOUR.md), « Déroulé ») | tous | — | — |

> **Dépendance à surveiller :** `/tower-admin importer` (étape 4) est une commande du bot. Si `/tower-admin` n'apparaît pas dans Discord quand tu arrives à l'étape 4, **fais d'abord la section 8** (étape 5), puis reviens à l'étape 4. Le plus simple est de lancer `--check` (lecture seule) la veille.

### Avant de commencer (10 minutes)

- [ ] Comptes ouverts : Vercel, Neon, GitHub (administrateur du dépôt), Discord (compte avec « Gérer le serveur » sur The Tower).
- [ ] Dernier run « Migrations Production » (onglet **Actions** de GitHub) **vert** sur le dernier commit de `main`.
- [ ] Commandes du bot : vérifie avec `--check` (section 8, lecture seule) si elles sont déjà enregistrées. Sans elles `/tower` et `/tower-admin` n'existent pas sur Discord.
- [ ] Yuichiro est prévenu et disponible pour mettre Atlas en pause à H+0:00 (section 4).
- [ ] Un arbitre indépendant est désigné pour les contestations.
- [ ] Contrôle de la section 2 fait : la communauté The Tower est `ACTIVE` et son drapeau vaut `true`.
- [ ] Les deux requêtes de contrôle de la section 4 bis (progression et défis existants) donnent `0` avant la première activation.
- [ ] Tu as noté, sans secret, l'état actuel de `TOWER_CHALLENGES_ENABLED` et `TOWER_DISCORD_ANNOUNCE_ENABLED` (**absentes** au relevé du 20/11) pour pouvoir revenir en arrière. `NOTIFICATION_EXECUTOR_ENABLED` est une variable « sensible » : Vercel ne la relit pas, mais les journaux montrent que l'executor tourne.
- [ ] Ces variables **existent déjà** dans Vercel Production (ne rien changer, juste vérifier la présence) : `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_APP_PUBLIC_KEY`, `CRON_SECRET`, `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID` (salon des preuves), `TOWER_DISCORD_GENERAL_CHANNEL_ID` (salon des réussites). Sans les deux salons, aucune annonce ne part.
- [ ] Dans le **Developer Portal** Discord, l'**Interactions Endpoint URL** de l'application pointe sur `https://<ton domaine de production>/api/discord/interactions` (Portal → ton application → General Information). Sans elle, les commandes enregistrées répondent « L'application ne répond pas ».
- [ ] Ton ordonnanceur externe appelle bien `/api/cron/notification-executor` (la clôture des défis en dépend). Tu le vérifies dans les logs Vercel (section 7).

## 1. Étape 2 — Variables Vercel (interrupteurs 1 et 2)

**Où :** [vercel.com](https://vercel.com) → ton équipe → le projet `gamenight`.

### 1.1 Ajouter les deux variables

1. Dans le projet, ouvre **Settings** (barre latérale), puis **Environment Variables**.
2. Section « Add New » :
   - **Name** : `TOWER_CHALLENGES_ENABLED`
   - **Value** : `true`
   - **Environments** : coche **uniquement Production** (décoche Preview et Development : rien ne doit s'activer sur une Preview).
   - Clique **Save**.
3. Recommence avec **Name** `TOWER_DISCORD_ANNOUNCE_ENABLED`, **Value** `true`, **Production** seulement.
4. Si Vercel refuse parce que la variable existe déjà : ouvre-la dans la liste, modifie la valeur (`true` exact) et enregistre.
5. `NOTIFICATION_EXECUTOR_ENABLED` existe déjà (variable sensible : sa valeur ne se relit pas dans Vercel) et les journaux montrent que l'executor tourne : ne la touche pas, sauf si les journaux de l'étape 6 montrent `enabled:false`.
6. Recommandé, **facultatif** : `DISCORD_INVITE_URL` = le lien d'invitation du serveur The Tower (`https://discord.gg/…` ou `https://discord.com/invite/…`, non secret), Production seulement. Il s'affiche sur l'écran « Connexion refusée » pour un compte qui n'est pas membre du serveur. Absent, l'écran s'affiche sans lien.

> Vercel applique une variable modifiée **seulement aux nouveaux déploiements** : tant que tu ne redéploies pas, rien ne change. Tu ne redéploies donc **qu'une fois**, après la dernière variable (étape 3, section 6).

### 1.2 Vérifier

- Dans la liste **Environment Variables**, les deux lignes apparaissent avec l'environnement **Production**.
- Rien n'a encore changé pour les membres : c'est normal avant le redéploiement.

### 1.3 Revenir en arrière en une minute

Avant le redéploiement : supprime les deux variables (ou remets-les à leur valeur d'avant) ; rien n'a été déployé, donc rien à annuler. **Après** le redéploiement, voir les trois retours arrière de la section 6.

## 2. Contrôle de l'interrupteur 3 (Neon) : le drapeau de la communauté est déjà à `true`

> Relevé en lecture seule le 20/11/2026 : `Community.towerChallengesEnabled` vaut déjà **`true`** pour The Tower (communauté `ACTIVE`). **Il n'y a rien à écrire** : cette section n'est qu'un **contrôle en lecture seule**, à faire avant la soirée. Conséquence : le redéploiement (étape 3) ouvre la Tour **d'un coup** pour les membres (voir section 6).

**Où :** [console.neon.tech](https://console.neon.tech) → le projet **`gamenight`** (identifiant `misty-tooth-45335023`) → la branche **`production`** (la branche par défaut).

> ⚠️ **`misty-tooth-45335023` est la Production.** Les environnements de test sont : le projet `winter-scene-14323342` (« gamenight-restore-rehearsal ») et les branches `tower-migration-test-*` du projet `gamenight` (par exemple `tower-migration-test-20261105`). N'utilise aucun d'eux pour cette soirée. Vérifie que la branche sélectionnée s'appelle bien `production`.

### 2.1 Ouvrir l'éditeur SQL

1. Dans la console Neon, sélectionne le projet `gamenight`.
2. Dans la barre latérale, ouvre **Postgres database** puis **SQL Editor** (documentation Neon : « Select your project » → « Postgres database » → choisir une branche et une base).
3. Choisis la branche **`production`** et la base utilisée par l'application (en général la seule de la branche).

Colle **une seule requête à la fois**, puis clique **Run**.

### 2.2 Contrôle (lecture seule)

```sql
SELECT id, name, status, "discordGuildId", "towerChallengesEnabled", "communityTeamsEnabled"
FROM "Community"
WHERE "discordGuildId" = '553922938101825536';
```

Attendu : **exactement 1 ligne**, avec `status` = `ACTIVE` et `towerChallengesEnabled` = `true`. Note la valeur de `communityTeamsEnabled` (`importer-equipe` l'exige à `true`).

- **0 ligne** : tu n'es pas dans la bonne base ou la bonne branche. **Arrête-toi.**
- `status` différent de `ACTIVE` : **arrête-toi** ; le code ignore une communauté qui n'est pas `ACTIVE`.
- `towerChallengesEnabled` = `false` : c'est un écart avec le relevé du 20/11. **N'écris rien ce soir** : la Tour resterait fermée même après le redéploiement ; préviens avant d'aller plus loin.

### 2.3 Vérifier après le redéploiement

Sur le site, connecté avec un compte membre de The Tower, ouvre la page **`/tower`** : le texte « Les défis ne sont pas encore activés pour cette communauté. » ne doit **pas** apparaître ; tu vois « Aucun défi solo en cours. Choisis-en un avec /tower defi sur Discord. » (si aucun défi n'est en cours).

### 2.4 Retour arrière d'urgence (la seule écriture de ce document)

À n'utiliser qu'en cas d'incident (donnée d'une autre communauté, récompense double, annonce en boucle) :

```sql
UPDATE "Community"
SET "towerChallengesEnabled" = false
WHERE "discordGuildId" = '553922938101825536'
RETURNING id, "discordGuildId", "towerChallengesEnabled";
```

L'accès est coupé tout de suite, **sans redéploiement**. C'est le retour arrière à faire **en premier** si l'incident touche les données. Les défis, étages et preuves déjà créés sont conservés.

## 3. Étape 4 — Importer le catalogue (Discord), **avant toute annonce**

> Le redéploiement (étape 3) a ouvert la Tour d'un coup : le catalogue est **vide** (0 défi au relevé du 20/11). **N'annonce rien, n'invite aucun testeur** tant que l'import n'est pas fait et vérifié. La commande exige que `TOWER_CHALLENGES_ENABLED` soit actif, donc après le redéploiement. Si `/tower-admin` n'apparaît pas, fais d'abord la section 8.

Sur le serveur The Tower, avec un compte qui a « Gérer le serveur » :

1. Tape `/tower-admin importer`. Réponse attendue (visible de toi seul) : « ✅ Catalogue prêt : N défis ajoutés, M déjà présents. » (1ᵉʳ passage : 86 défis solo = 26 de départ + 60 de la saison 1).
2. Tape `/tower-admin importer-equipe`. Réponse attendue : « ✅ Catalogue d'équipe prêt : N défis ajoutés… Aucune annonce n'a été envoyée. » (1ᵉʳ passage : 30 défis d'équipe = 10 + 20). **Exige `communityTeamsEnabled` = `true`** (relevé en 2.2) ; s'il vaut `false`, ne lance pas cette commande ce soir et préviens-moi.
3. Relance chaque commande une seconde fois : « 0 ajouté, tout déjà présent » (l'import est idempotent).

**Vérifier :** `/tower-admin defis page:1` liste les 12 premiers défis. **Retour arrière :** aucun nécessaire (l'import n'envoie aucune annonce et ne supprime rien) ; pour retirer un défi des prochaines attributions : `/tower-admin desactiver` avec son identifiant (les tentatives en cours restent intactes).

## 4. Étape 1 — Pause d'Atlas par Yuichiro : où elle se place, et si on l'oublie

### Où dans la soirée

**À H+0:00, avant tout le reste : c'est l'étape 1, faite par Yuichiro.** Elle doit précéder les variables Vercel (étape 2), car le redéploiement (étape 3) ouvre la Tour d'un coup. La pause se fait **dans Atlas**, pas dans ce dépôt : ce dépôt ne contient ni ses réglages ni ses écrans (ils n'ont pas été vérifiés, voir [TOWER_ATLAS_ARRET.md](TOWER_ATLAS_ARRET.md)).

1. **Photographie ou exporte** les réglages actuels d'Atlas (règles d'attribution des rôles Étage, permissions, position du rôle d'Atlas dans la hiérarchie). C'est ton retour arrière.
2. **Mets en pause la génération des rôles Étage**, sans retirer les rôles existants.
3. **Les 134 rôles Étage ont déjà été supprimés à la main** (déclaration du 20/11). Si Atlas est encore actif, il peut les **recréer** ou continuer à compter : c'est une raison de plus de le mettre en pause **avant** l'activation, puis de relire la liste des rôles du serveur pour vérifier qu'aucun rôle « Étage » n'est réapparu (comportement d'Atlas non vérifié depuis le dépôt). Voir la section 4 bis pour ce que cette suppression change.
4. Contrôle dans le **journal d'audit** du serveur Discord (Paramètres du serveur) qu'aucun nouveau changement de rôle Étage n'est fait par Atlas après la pause. L'absence d'événement récent ne prouve pas à elle seule l'arrêt : surveille pendant la période d'essai.

**Retour arrière :** rétablis les réglages d'Atlas que tu as sauvegardés ; ne recrée jamais les 134 rôles « à l'aveugle ».

### Si on l'oublie

- **Deux sources de progression en parallèle** : Atlas continue d'attribuer ses rôles Étage selon ses propres règles pendant que GameNight compte les étages gagnés par les défis. Les membres voient deux échelles qui ne concordent pas. C'est précisément la condition 5 de [CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md) (« Ascension sans double progression ») qui n'est alors pas remplie.
- **Plafond de rôles** : le serveur comptait 197 rôles dont 134 « Étage » (audit du 26/10) pour un plafond Discord de 250. Avec les 134 rôles supprimés, le prérequis de `DISCORD_ROLE_AUTOCREATE_ENABLED` est levé côté Discord ; relève le **nombre de rôles actuel** (tableau de bord staff v2 si `ADMIN_DASHBOARD_V2_ENABLED` est actif, sinon Paramètres du serveur → Rôles). Si Atlas recrée des rôles, tu te rapproches à nouveau du plafond que respectent les espaces d'équipe et la création automatique de rôles.
- **Rien ne casse côté GameNight** : le code n'écrit aucun rôle Discord de grade, et les étages gagnés restent. Ce n'est donc **ni bloquant ni irréversible** : mets Atlas en pause dès que tu t'en aperçois ; les écarts déjà créés entre les deux échelles se rattrapent à la main.

## 4 bis. Les rôles « Étage » ont été supprimés : ce que ça change

> Suppression à la main **déclarée par le propriétaire le 20/11/2026** ; elle n'est pas vérifiable depuis le dépôt. Les réponses ci-dessous viennent du code de `main` et des cahiers, avec le fichier à l'appui.

### Où est stocké l'étage d'un joueur

| Donnée | Où | Dépend des rôles Discord ? |
| --- | --- | --- |
| **Étages gagnés par les défis** (nouvelle Ascension, base du grade) | Table `TowerChallengeProgress`, colonne `floorsClimbed`, une ligne par communauté et par joueur. Elle augmente de `rewardFloors` (1, 2 ou 3) à chaque défi validé (`src/lib/tower-challenges.ts`, `src/lib/tower-steam-measure.ts`). L'historique de chaque défi est dans `TowerChallengeAttempt` (`rewardFloors`, `status` = `APPROVED`) et `TowerChallengeAttemptParticipant` pour les défis d'équipe | **Non** |
| **Étage « XP »** affiché sur `/ascension`, `/tower` et dans le profil Discord | Calculé à la lecture par `getTowerProgress(xpTotal, towerLevelsPerFloor)` (`src/lib/tower-progression.ts`) à partir de `CommunityMemberStats.xpTotal` (progression de la saison) et de `Community.towerLevelsPerFloor` | **Non** |
| **Grade** (Régulars, Irregular, Ranker, High Ranker) | Calculé à la lecture depuis `floorsClimbed` et les défis de la saison (`src/lib/tower-ranks.ts`) ; Irregular = ligne `TowerIrregularGrant` posée à la main par le staff | **Non** : aucun rôle Discord de grade |
| **Ancien étage d'Atlas** | Rôles Discord « Étage N » et base interne d'Atlas | **Oui** : cette donnée n'a **jamais été copiée dans GameNight** |

Aucune fonction du dépôt ne lit les rôles Discord d'un joueur pour calculer un étage. Le script `scripts/audit-tower-etage-roles.mjs` ne fait que lister les rôles et les salons (deux `GET`, aucune suppression ni écriture) et marque lui-même les membres de chaque rôle « non vérifié ».

### GameNight recrée-t-il les rôles d'étage à l'activation ?

**Non, jamais.** Rien dans le code ne crée ni n'attribue de rôle « Étage » :

- Les seuls appels qui créent des rôles Discord sont : le rôle « Soutien de la Tour » (`booster-support-runner.ts`, interrupteur `DISCORD_BOOSTERS_ENABLED`), le rôle d'une équipe (`discord-team-space-api.ts`, `DISCORD_TEAM_SPACES_ENABLED`) et le rôle de jeu de `/role` (`discord-role-autocreate.ts`, `DISCORD_ROLE_AUTOCREATE_ENABLED`). Aucun n'est activé par les 4 interrupteurs Tower.
- Activer `TOWER_CHALLENGES_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED` et le drapeau de la communauté ne déclenche aucun script : ils ouvrent les défis, et les annonces passent par la file.
- Le grade est « dans l'app uniquement » (`src/lib/tower-ranks.ts` : « aucun grade ne donne de droit de modération ni de rôle Discord ») et le cahier §6.3 interdit tout nouveau rôle permanent par étage.
- `scripts/provision-tower-layout.mjs` n'écrit aucun rôle (simulation).

### Peut-on « resynchroniser » ou importer les étages ?

**Il n'existe aucun import d'étages**, et il n'en existait pas avant la suppression non plus :

- `/tower-admin importer` et `/tower-admin importer-equipe` importent le **catalogue de défis** (titres, consignes, barème), **pas les étages des joueurs**.
- `audit-tower-etage-roles.mjs` est en lecture seule : il ne peut rien resynchroniser.
- Décision du cahier §7.2 : « le nouveau compteur démarre de zéro sans effacer les profils GameNight, les soirées ou les autres historiques ». Ce que chaque joueur retrouve donc, en une phrase exacte : **Ton niveau, ton étage XP et ton rang XP sont conservés ; tes étages Tower repartent de zéro et se gagnent par les défis, et ton grade Tower (Régulars, Irregular, Ranker, High Ranker) repart avec eux.** (le niveau, l'étage XP et le rang XP viennent de `CommunityMemberStats.xpTotal`, intacts en base ; les étages Tower viennent de `TowerChallengeProgress.floorsClimbed`, à 0 ; le grade Tower est calculé à partir de ces étages, Irregular étant attribué à la main).

### Qu'est-ce qui a pu être perdu ?

- **Rien dans GameNight** : aucune donnée de la base ne dépendait des rôles supprimés.
- **Possiblement perdu : l'étage d'Atlas de chaque membre.** Il vivait dans les rôles Discord (supprimés) et dans la base d'Atlas (non inspectable depuis le dépôt). Les attributions n'ont jamais été relevées : l'export du 26/10 contient les rôles mais **pas les membres** ([TOWER_ROLE_REVIEW.md](TOWER_ROLE_REVIEW.md)), et leur relevé était à faire à la main ([PLAN-J14-20261201.md](PLAN-J14-20261201.md)). Recréer un rôle crée un rôle **vide** : il ne restitue pas ses membres. Il n'y a donc **pas de sauvegarde connue** de « qui avait quel étage » côté Discord.
- Ce n'est **pas bloquant pour l'activation** (la décision du cahier est un départ à zéro), mais c'est une perte d'historique à assumer ou à reconstruire.

### Reconstruction, si tu veux honorer les anciens étages

1. **Ne supprime pas Atlas ni ses données** : il peut encore connaître le niveau de chaque membre. Cherche dans son tableau de bord ou ses commandes un classement ou un export (non vérifié : ce dépôt ne contient rien sur ses écrans).
2. **Journal d'audit Discord** (Paramètres du serveur) : il conserve les entrées **45 jours** seulement (documentation Discord). Il peut montrer les derniers changements de rôles faits par Atlas, **pas l'état complet** : au mieux une reconstruction partielle. Je peux écrire, à ta demande, un script **en lecture seule** pour l'extraire.
3. **Décide avant d'écrire quoi que ce soit** : écrire directement `floorsClimbed` contournerait la preuve, le vote et les plafonds, et fausserait le grade High Ranker. Pour honorer des vétérans, la voie prévue est le grade **Irregular posé à la main** (`/admin/tower-irregular`, interrupteur `TOWER_IRREGULAR_GRANTS_ENABLED`, prestige sans aucun droit).
4. Toute écriture en Production passe par une PR dédiée, avec simulation d'abord et ton accord explicite.

### Contrôle en lecture seule à faire avant d'activer (Neon, section 2.1)

Dans l'éditeur SQL (une requête à la fois) :

```sql
SELECT COUNT(*) AS lignes, COALESCE(SUM("floorsClimbed"), 0) AS etages_total
FROM "TowerChallengeProgress";
```

```sql
SELECT status, COUNT(*) FROM "TowerChallengeAttempt" GROUP BY status;
```

Attendu **avant la première activation** : `0` ligne, `0` étage, aucune ligne de défi. Si ce n'est pas le cas, la Tour a déjà servi : lance la requête de cohérence ci-dessous. **Zéro ligne en sortie = tout est cohérent** (chaque `floorsClimbed` égale la somme des défis validés ; `TowerChallengeAttempt` permet de le reconstruire).

```sql
WITH solo AS (
  SELECT "communityId", "userId", SUM("rewardFloors")::bigint AS f
  FROM "TowerChallengeAttempt"
  WHERE status = 'APPROVED' AND "teamId" IS NULL
  GROUP BY 1, 2
), equipe AS (
  SELECT p."communityId", p."userId", SUM(a."rewardFloors")::bigint AS f
  FROM "TowerChallengeAttemptParticipant" p
  JOIN "TowerChallengeAttempt" a ON a.id = p."attemptId" AND a."communityId" = p."communityId"
  WHERE p."rewardedAt" IS NOT NULL
  GROUP BY 1, 2
), calc AS (
  SELECT "communityId", "userId", SUM(f)::bigint AS f
  FROM (SELECT * FROM solo UNION ALL SELECT * FROM equipe) u
  GROUP BY 1, 2
)
SELECT COALESCE(c."communityId", g."communityId") AS "communityId",
       COALESCE(c."userId", g."userId") AS "userId",
       COALESCE(c.f, 0) AS recalcule, COALESCE(g."floorsClimbed", 0) AS stocke
FROM calc c
FULL JOIN "TowerChallengeProgress" g ON g."communityId" = c."communityId" AND g."userId" = c."userId"
WHERE COALESCE(c.f, 0) <> COALESCE(g."floorsClimbed", 0);
```

(Requêtes de lecture seule : relis-les avant de les lancer ; elles n'ont pas été exécutées pour écrire ce document.)

## 5. Option — Interrupteur 4 (défi d'équipe quotidien), **facultatif**

À ne faire **que si** toutes ces conditions sont remplies, sinon laisse-le éteint et garde la ligne « défi d'équipe » en [PRÉVUE] dans les textes :

- [ ] Étapes 1 à 6 faites, test minimal (section 7) vert.
- [ ] `communityTeamsEnabled` = `true` pour The Tower.
- [ ] Variable GitHub **`GAMENIGHT_CRON_BASE_URL`** (origine HTTPS de ton domaine de production, sans chemin) et secret GitHub **`CRON_SECRET`** (la même valeur que dans Vercel) existent déjà.
- [ ] Tu as décidé de l'activer maintenant (l'attribution se fait à **18:00 Europe/Paris**, voir [TOWER_TEAM_DAILY_CRON.md](TOWER_TEAM_DAILY_CRON.md)).

### 5.1 Côté Vercel

Pose `TOWER_TEAM_DAILY_ENABLED` = `true` (Production seulement) **à l'étape 2 (variables), avant le redéploiement (étape 3)** : tu évites ainsi un second redéploiement. Sans la variable GitHub (5.2), rien n'appelle la route.

### 5.2 Côté GitHub Actions

1. GitHub → le dépôt → **Settings**.
2. Barre latérale, section « Security » : **Secrets and variables** → **Actions**.
3. Onglet **Variables** → **New repository variable**.
4. **Name** : `TOWER_TEAM_DAILY_ENABLED`, **Value** : `true`, puis **Add variable**.

C'est cette variable qui déclenche l'appel : le workflow la lit à chaque exécution (`0 16,17 * * *` UTC, il n'appelle la route que pendant l'heure 18 de Paris).

### 5.3 Vérifier

- **Où :** onglet **Actions** du dépôt → workflow « Tower team daily challenge » → dernier run → ses journaux. Le premier run utile est celui de **18:00 Paris** du jour (ou du lendemain si tu actives après 18:00). Attendu dans le journal : « Daily team challenge assignment completed successfully. »
- « Daily team challenge schedule is disabled. » = la variable GitHub n'est pas `true` (normal tant qu'elle n'est pas posée).
- Dans Vercel → **Logs** : filtre **Request Path** = `/api/cron/tower-team-daily`, attendu : statut 200.
- Si le journal dit « Endpoint did not confirm enabled=true, failed=0 and complete=true », **ne relance pas en boucle** : retour arrière ci-dessous et on diagnostique.

### 5.4 Revenir en arrière en une minute

GitHub → Settings → Secrets and variables → Actions → Variables → `TOWER_TEAM_DAILY_ENABLED` → mets la valeur à `false` (ou supprime la variable). Effet **immédiat**, sans redéploiement : plus aucun appel. Les attributions déjà faites sont conservées. Tu peux aussi retirer la variable Vercel, mais ce n'est pas nécessaire pour arrêter.

## 6. Étape 3 — Le redéploiement Vercel : moment exact et retours arrière

### Le moment exact

**Une seule fois**, juste après avoir enregistré la **dernière** variable de l'étape 2 (les interrupteurs 1 et 2, plus éventuellement `DISCORD_INVITE_URL` et `TOWER_TEAM_DAILY_ENABLED`), et **avant** `/tower-admin importer` (étape 4). Ne redéploie pas entre deux variables.

**Ce que le redéploiement change :** le drapeau communautaire étant déjà à `true`, la Tour s'**ouvre d'un coup** pour les membres de The Tower dès que le déploiement est **Ready**. Comme le catalogue est vide, aucun défi ne peut encore être attribué : **fais l'import (étape 4) tout de suite et n'annonce rien avant.**

### Les gestes

1. Projet `gamenight` → **Deployments** (barre latérale).
2. Repère le **déploiement de Production le plus récent** (il porte l'étiquette Production et le statut Ready). Un redéploiement reconstruit **le même commit** que le déploiement choisi : prends donc le plus récent.
3. Clique sur les trois points `⋯` à droite de la ligne, puis **Redeploy**.
4. Dans la fenêtre « Redeploy to Production », laisse la case **Use existing Build Cache** telle quelle (ces variables sont lues à l'exécution, le cache n'est pas un problème), puis clique **Redeploy**.
5. Attends le statut **Ready**. Si le build échoue, **n'avance pas** : l'ancien déploiement reste en ligne et les variables ne sont pas appliquées.

### Retours arrière après redéploiement (du plus rapide au plus lent)

| Besoin | Geste | Délai |
| --- | --- | --- |
| Couper l'accès des membres | SQL de retour arrière de la section 2.4 | immédiat, sans redéploiement |
| Revenir à la version d'avant | Projet → page **Overview** → tuile « Production Deployment » → **Instant Rollback** → choisis le déploiement précédent → **Confirm Rollback** | quelques secondes. Les variables d'environnement du projet ne changent pas. **Après un rollback, Vercel coupe l'attribution automatique des domaines de production : les prochains merges dans `main` ne seront plus mis en ligne tant que tu ne re-promeus pas un déploiement.** À n'utiliser que pour un vrai incident. |
| Retirer les interrupteurs 1 et 2 | Settings → Environment Variables : supprime les deux variables (ou mets autre chose que `true`), puis refais un **Redeploy** | quelques minutes (durée du build) |

## 7. Étape 6 — Test minimal après le redéploiement (10 minutes)

Le test est volontairement **en lecture seule** : il ne crée aucun défi réel en Production (le parcours complet défi → preuve → 3 votes se fait ensuite avec les testeurs réels).

1. **Vercel → Deployments** : le déploiement est **Ready** et marqué Production.
2. **Vercel → Logs** (menu « Logs » du projet), filtre **Environment** = Production, **Level** = Error, sur les 10 dernières minutes : aucune erreur 5xx nouvelle.
3. **Discord**, avec un compte **non modérateur** de The Tower (pas ton compte admin) :
   - `/tower progression` : réponse en principe **privée** (visible de lui seul) avec sa progression.
   - `/tower classement` : réponse en principe privée avec le classement de la saison, ou « Aucun étage gagné sur cette période pour le moment. »
4. **Site**, même compte : la page `/tower` s'ouvre et affiche son état (voir 2.3).
5. **Executor** : Vercel → Logs → **Request Path** = `/api/cron/notification-executor` : des appels récents en 200 ou 202 (c'est lui qui envoie les annonces et clôt les défis).
6. Un compte d'une **autre communauté** (s'il en existe un) ne voit aucune donnée de The Tower.

**Si un point est rouge :** applique le retour arrière de la section 2.4 (SQL), puis diagnostique ; ne désactive rien d'autre en urgence.

## 8. Étape 5 — Enregistrer les commandes du bot depuis le PC de Maxime

> **Étape 5 de la soirée.** Si `/tower-admin` n'apparaît pas dans Discord quand tu arrives à l'étape 4, fais cette section **avant** l'étape 4 (ou, mieux, la veille). Le script `scripts/register-tower-guild-commands.mjs` enregistre **les 13 commandes** du manifeste `scripts/discord-commands.json` (`/gamenight`, `/tower`, `/tower-admin`, `/equipe`, `/role`, `/aide`, `/profil`, `/boost`, `/joueurs`, `/soiree`, `/tournoi`, `/projet` et la commande de message « Signaler ») **dans le serveur The Tower seulement** (`553922938101825536`), jamais en global, sans rien supprimer ni toucher aux commandes hors manifeste. Il n'affiche jamais le jeton. Il n'y a **pas de choix commande par commande** : les 13 sont enregistrées d'un coup, et celles dont l'interrupteur reste éteint sont visibles des membres mais sans effet utile (vérifié pour `/role`, qui répond « pas encore ouverte » ; à constater pour les autres).

Les commandes ci-dessous se **tapent une à une dans un terminal** : ce n'est pas un script à enregistrer.

### 8.1 Ce qu'il te faut

- **Node.js 18 ou plus** : `node --version`. (Le script utilise `fetch`, intégré à Node, et aucune dépendance : pas besoin de `npm install`.)
- Le dépôt à jour : dans le dossier du dépôt, `git switch main` puis `git pull`.
- L'application invitée sur The Tower avec le scope `applications.commands`. Lien (remplace les deux valeurs ; ne les copie jamais dans un fichier du dépôt) :

  ```
  https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=395137076240&guild_id=553922938101825536&disable_guild_select=true
  ```

  Si `--check` répond HTTP 403 code `50001`, c'est qu'il faut **réinviter** avec ce lien (cause la plus probable).
- **`DISCORD_CLIENT_ID`** : identifiant public de l'application. Developer Portal → ton application → **General Information** → Application ID. Ce n'est pas un secret.
- **`DISCORD_BOT_TOKEN`** : le jeton du bot (secret). Où le trouver, par ordre de préférence :
  1. Ton gestionnaire de mots de passe, s'il y est.
  2. Vercel → Settings → Environment Variables → la variable `DISCORD_BOT_TOKEN`, **si** Vercel laisse afficher sa valeur. Une variable Vercel marquée « Sensitive » ne peut pas être relue depuis le tableau de bord.
  3. **Dernier recours, pas pendant la soirée** : Developer Portal → ton application → **Bot** → **Reset Token**. Le portail n'affiche le jeton qu'une fois, et un nouveau jeton **invalide l'ancien** : le bot de production cesse de fonctionner tant que tu n'as pas mis le nouveau jeton dans `DISCORD_BOT_TOKEN` côté Vercel **et** redéployé.

### 8.2 Poser les trois variables, dans ce terminal seulement

Ouvre un terminal **PowerShell** (le jeton n'existera que dans cette fenêtre).

```powershell
$env:DISCORD_CLIENT_ID = "COLLE_ICI_L_APPLICATION_ID"
$env:TOWER_DISCORD_GUILD_ID = "553922938101825536"
```

Le jeton se saisit **sans s'afficher à l'écran** (colle-le avec un clic droit, puis Entrée) :

- **PowerShell 7.1 ou plus** (`$PSVersionTable.PSVersion` pour le savoir) :

  ```powershell
  $env:DISCORD_BOT_TOKEN = Read-Host "Jeton du bot (invisible)" -MaskInput
  ```

- **Windows PowerShell 5.1** (celui qui est livré avec Windows) :

  ```powershell
  $s = Read-Host "Jeton du bot (invisible)" -AsSecureString
  $env:DISCORD_BOT_TOKEN = [System.Net.NetworkCredential]::new("", $s).Password
  ```

(`-MaskInput` n'existe qu'à partir de PowerShell 7.1 ; `-AsSecureString` affiche des astérisques à la place des caractères.)

### 8.3 Lancer, dans cet ordre

```powershell
node scripts/register-tower-guild-commands.mjs
node scripts/register-tower-guild-commands.mjs --check
node scripts/register-tower-guild-commands.mjs --execute
node scripts/register-tower-guild-commands.mjs --check
```

1. **Sans option** = simulation : aucun appel réseau, tu relis le plan (13 commandes, dans l'ordre du manifeste).
2. **`--check`** = lecture seule (un GET) : une ligne par commande, `absente`, `présente` ou `différente`, puis le nombre de commandes du serveur hors manifeste (non touchées).
3. **`--execute`** = écriture : un POST par commande. Attendu : `/gamenight : enregistrée sur The Tower.` et ainsi de suite, **13 lignes**. Lance-le **une fois**.
4. **`--check`** de nouveau : les 13 doivent être `présente`.

Tu peux coller ces sorties dans le chat : elles ne contiennent que des statuts HTTP et des codes numériques, jamais le jeton.

| Réponse | Cause | Que faire |
| --- | --- | --- |
| HTTP 403, code `50001` | Application non autorisée avec `applications.commands` | Réinviter avec le lien du 8.1, relancer `--check` |
| HTTP 401 | Jeton absent, régénéré ou d'une autre application | Revoir le jeton (8.2) ; l'ID d'application et le jeton doivent venir de la **même** application |
| HTTP 403 sans `50001` | `DISCORD_CLIENT_ID` d'une autre application, ou application non installée | Revérifier l'Application ID et l'installation |
| HTTP 404 | Identifiant d'application ou de serveur incorrect | Revérifier `DISCORD_CLIENT_ID` |
| HTTP 429 | Limite de débit Discord | Attendre, **ne pas relancer en boucle** |

### 8.4 Nettoyer

```powershell
Remove-Item Env:DISCORD_BOT_TOKEN
Remove-Item Env:DISCORD_CLIENT_ID
Remove-Item Env:TOWER_DISCORD_GUILD_ID
```

Puis ferme la fenêtre et vide ton presse-papiers (copie un mot quelconque). Le jeton n'a été écrit dans aucun fichier.

### 8.5 Ensuite

Vérifie sur Discord avec un compte membre et un compte modérateur que `/tower` et `/tower-admin` apparaissent (`/tower-admin` n'apparaît qu'avec « Gérer le serveur »). Passe ensuite au test minimal (étape 6, section 7).

## 9. Récapitulatif des retours arrière en une minute

| Ce que tu veux défaire | Geste | Redéploiement ? |
| --- | --- | --- |
| Interrupteur 3 (accès des membres aux défis) | SQL `UPDATE … SET "towerChallengesEnabled" = false …` (section 2.4) | Non |
| Interrupteur 4 (défi d'équipe quotidien) | Variable GitHub `TOWER_TEAM_DAILY_ENABLED` = `false` (section 5.4) | Non |
| Interrupteurs 1 et 2 | Supprimer les variables Vercel puis **Redeploy** ; ou **Instant Rollback** pour un vrai incident (section 6) | Oui (ou rollback) |
| Atlas | Rétablir les réglages sauvegardés (section 4) | — |
| Catalogue importé | Rien à faire, il est conservé | — |

Arrêt immédiat si : donnée d'une autre communauté, récompense double, annonce en boucle, erreur 5xx persistante. **Ne supprime rien** (défis, étages, preuves, rôles, messages) : défais dans l'ordre inverse, en commençant par le SQL. Un message erroné déjà parti sur Discord se supprime à la main, sans rejouer la file. Les migrations ne se défont pas par ce plan : voir [MIGRATIONS.md](MIGRATIONS.md) et [TOWER_SNAPSHOT_RESTORE_PROCEDURE.md](TOWER_SNAPSHOT_RESTORE_PROCEDURE.md).

## 9 bis. Option — Pages légales (à faire avant l’ouverture publique)

Aucune action Discord ni Neon. Les pages sont éteintes tant que `LEGAL_PAGES_ENABLED` n’est pas exactement `true` (404, aucun lien).

1. [ ] Vercel → Settings → Environment Variables → **Production** : ajoute `LEGAL_PUBLISHER` (nom et coordonnées, ou association), `LEGAL_PUBLICATION_DIRECTOR`, `LEGAL_CONTACT_EMAIL` (adresse dédiée) et `LEGAL_MIN_AGE` (13, 15 ou 16). Aucune n’est un secret.
2. [ ] Fais relire les trois textes (`src/app/mentions-legales`, `confidentialite`, `conditions`) par un professionnel du droit : chaque page porte « Version provisoire, à faire relire par un professionnel du droit ».
3. [ ] Renseigne aussi ce qui reste « À COMPLÉTER » dans la politique : région du stockage de fichiers Vercel Blob, garanties de transfert hors UE, durée de conservation des preuves et des signalements, date de mise à jour des conditions.
4. [ ] Ajoute `LEGAL_PAGES_ENABLED` = `true` puis **Redeploy**.
5. [ ] Contrôle : `/mentions-legales`, `/confidentialite`, `/conditions` répondent (sans te connecter), les trois liens sont au bas de la page de connexion et de chaque page, et aucun « À COMPLÉTER » ne s’affiche.
6. Retour arrière : supprime `LEGAL_PAGES_ENABLED` puis **Redeploy** (les pages redeviennent 404).

## 10. Ce que ce document ne garantit pas

- Les écrans d'**Atlas** ne sont pas lisibles depuis le dépôt : ils sont décrits par leur rôle, pas par leur nom. Le projet Neon de Production (`gamenight`, `misty-tooth-45335023`, branche `production`) a été relevé en lecture seule le 20/11/2026.
- L'état réel des variables Vercel, de la base de Production et de Discord n'a **pas** été vérifié (aucune action Vercel, Neon ou Discord n'a été faite pour préparer ce document).
- Le test minimal n'est pas une recette : le parcours réel (défi, preuve, 3 votes distincts, récompense, quota) avec des testeurs réels reste à faire et conditionne le go/no-go ([CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md), 0 / 17 cases cochées à ce jour).

## 11. Option — Suppression et export de compte (`ACCOUNT_DELETION_ENABLED`), **facultatif**

Hors des 4 interrupteurs Tower, à faire **un autre jour** que la soirée d'activation, de préférence avant l'ouverture publique (constat V1-02 de l'audit). Guide complet : [SUPPRESSION_COMPTE.md](SUPPRESSION_COMPTE.md).

### 11.1 Avant (ordre impératif : la migration, puis la variable)

1. La PR est fusionnée dans `main` ; le run **« Migrations Production »** (GitHub Actions) est approuvé et vert ; le résumé du run montre `20261121100000_account_deletion_log` appliquée. Cette migration ne crée qu'**une table de journal** (`AccountDeletionLog`), sans toucher à une table existante.
2. Vercel → Production : `SESSION_MEDIA_BLOB_TOKEN` présent (médias de galerie privés supprimés avec le compte).

### 11.2 Activer

Vercel → Settings → Environment Variables (**Production** seulement) : `ACCOUNT_DELETION_ENABLED` = `true`, puis **Redeploy**.

### 11.3 Vérifier (compte de test, jamais un compte réel)

1. `/profil/parametres` affiche la carte « Mon compte et mes données » ; `/profil/compte` s'ouvre.
2. « Télécharger mes données » livre un fichier JSON : il contient le profil, la bibliothèque, les soirées créées… et **aucun** jeton ni identifiant d'un autre membre.
3. Un compte de test qui est le **seul OWNER** d'une communauté voit le refus « dernier propriétaire » et rien n'est supprimé.
4. Supprimer un compte de test (pseudo ou « SUPPRIMER ») : retour à l'accueil avec le message de suppression ; se reconnecter donne un compte neuf et vide ; un autre compte et un autre serveur sont inchangés.

### 11.4 Revenir en arrière en une minute

Retirer `ACCOUNT_DELETION_ENABLED` (ou une valeur autre que `true`) puis **Redeploy** : la page, l'export et l'action répondent 404. Les suppressions déjà faites sont **irréversibles** (voir [SUPPRESSION_COMPTE.md](SUPPRESSION_COMPTE.md) pour la restauration Neon). La migration ne se défait pas ; la table reste sans effet.
