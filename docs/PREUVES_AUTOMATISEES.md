# Preuves automatisées multi-utilisateurs

> **Décision de Maxime du 27 novembre 2026** : pour les lignes du cahier qui exigent trois comptes ou plus, ou un état de temps, de cron ou d'API impossible à réunir en réel, un scénario automatisé en CI sur PostgreSQL avec Discord simulé est accepté comme preuve, à condition qu'il couvre l'exigence de bout en bout avec plusieurs utilisateurs simulés. Les éléments Discord (messages, salons, permissions, arrivée) restent testés en réel.
>
> **Aucune ligne du cahier n'est passée au vert par ce document.** Les statuts de [`CAHIER_FINAL.md`](CAHIER_FINAL.md) sont inchangés : une preuve automatisée ne remplace ni le test réel d'un compte non-admin, ni un envoi Discord réel, ni un cron réellement déclenché.

## Périmètre

Lignes traitées : **C008, C017, C021, C029, C050, C078, C079**. C081 et D6 (tournoi, poule à 5 équipes) sont volontairement absents : ils attendent la fusion de #641 sur `main`.

Méthode commune :

- PostgreSQL 16 jetable en local (`127.0.0.1:55439`, même image que la CI `postgres:16-alpine`), migrations Prisma appliquées par `prisma migrate deploy` ;
- plusieurs `User` et `Membership` distincts, avec des rôles différents (OWNER, ADMIN, MEMBER) et des dates d'arrivée différentes ;
- les fonctions de service de l'application sont appelées directement (`voteTowerChallenge`, `settleTowerChallenge`, `getTowerPersonalProgress`, `getTeamDailyTowerChallenge`, `proposeTowerChallenge`, `awardTowerSeasonTitles`, `runTowerSteamAutovalidation`, etc.) ; la logique testée n'est jamais mockée ;
- seuls les bords sont simulés : HTTP Discord (`fetch`), API Steam (`getGamePlaytimeMinutes`) et horloge (`Date.now`) ;
- chaque fichier est ignoré sans `TEST_DATABASE_URL` (`describe.skipIf`) : pas de faux vert en local sans base.

Commande type (un fichier à la fois, base locale) :

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/gamenight_test' \
  npx vitest run src/lib/tower-ranks.integration.test.ts --maxWorkers=1
```

En CI, les fichiers sont répartis par `npm run test:postgres -- --shard=N/4` avec une base PostgreSQL par tranche : les nouveaux tests sont inclus automatiquement par le motif `src/**/*.test.ts`.

## Synthèse

| Ligne | Verdict | Preuve principale | Ce qui reste hors preuve automatisée |
| --- | --- | --- | --- |
| C008 | Couvert de bout en bout | `tower-ranks.integration.test.ts` (nouveau, 2 tests, 5 utilisateurs) | Attribution et affichage réels des grades dans Discord |
| C017 | Couvert de bout en bout | `tower-challenges.integration.test.ts`, `tower-team-daily.regression.integration.test.ts`, `tower-team-daily.test.ts` | Déclenchement réel du cron (cron-job.org / GitHub Actions), messages Discord réels |
| C021 | Couvert de bout en bout | `tower-challenge-proposals.integration.test.ts` (8 tests, 6 utilisateurs) | Commande et formulaire Discord réels ; interrupteur éteint en Production |
| C029 | Couvert de bout en bout, par plusieurs scénarios | `community-highlights.integration.test.ts`, `tower-weekly-recap.integration.test.ts`, `superlative-voting.integration.test.ts`, `tournament-announce.integration.test.ts`, `notification-kinds.test.ts` | Envois Discord réels ; aucune donnée de Production ; aucune preuve unique couvrant les sept sous-exigences ensemble |
| C050 | Couvert en partie | `tower-season-awards.integration.test.ts`, `profile-customization.integration.test.ts`, `community-progression.integration.test.ts`, `superlative-voting.integration.test.ts` | Hall of Fame manuel, « choisir certains événements » absent du code, badge de podium attribué manuellement |
| C078 | Couvert de bout en bout | `tower-discord-votes.integration.test.ts` (2 tests C078 ajoutés), `tower-challenges.integration.test.ts` | Clics réels sur les boutons ✅/❌, fils Discord réels |
| C079 | Couvert de bout en bout | `tower-steam-measure.integration.test.ts` (5 tests, 3 utilisateurs, API simulée) | API Steam réelle, cron réel, profil Steam réellement privé ; interrupteur éteint en Production |

---

## C008 — Grades Régulars / Irregular / Ranker / High Ranker

**Exigence** (cahier §6.1) : conserver et clarifier les quatre grades, avec des conditions d'obtention et un prestige cohérents.

**Verdict : couvert de bout en bout** par `src/lib/tower-ranks.integration.test.ts` (nouveau) :

- `C008 — quatre membres distincts obtiennent Régulars, Irregular, Ranker et High Ranker depuis leur progression réelle` : cinq membres (lecteur OWNER, Régulars à 5 étages, Irregular à 0 étage attribué par le service, Ranker à 30 étages, High Ranker à 100 étages et 5 défis validés dans la saison). Aucun grade n'est écrit à la main : les étages viennent de `TowerChallengeProgress`, les défis validés de tentatives `APPROVED` réellement créditées, et l'Irregular de `grantTowerIrregular`.
- `C008 — un grade gagné prime sur l'Irregular, et la révocation rend le grade calculé` : un Irregular à 30 étages est Ranker ; après révocation, il reste Ranker à 30 étages puis redevient Régulars à 5 étages.

**Compléments** : `src/lib/tower-ranks.test.ts` (seuils 30/100/5, couleurs, comparaison, refus des valeurs invalides) et `src/lib/tower-irregular.integration.test.ts` (attribution/révocation par OWNER/ADMIN, journal, isolation, lecture dans la progression).

**Ce que la preuve établit** : les quatre grades sont calculés depuis des données réelles et plusieurs comptes distincts, l'Irregular reste manuel, et un grade gagné l'emporte.

**Limites** : aucun rôle Discord n'est créé, attribué ou affiché dans ces tests ; le rendu Discord (couleur, rôle de prestige) reste à contrôler en réel. Les dates sont figées à une saison connue (S3 · 2026).

**Commande** :

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/gamenight_test' \
  npx vitest run src/lib/tower-ranks.integration.test.ts src/lib/tower-irregular.integration.test.ts --maxWorkers=1
```

---

## C017 — Défi d'équipe quotidien automatique, éligibilité et anti-abus

**Exigence** (cahier §8.3, §8.4) : chaque équipe reçoit automatiquement un défi quotidien ; les participants éligibles sont définis et un même accomplissement ne doit pas rémunérer abusivement plusieurs comptes.

**Verdict : couvert de bout en bout** par :

- `src/lib/tower-challenges.integration.test.ts` :
  - `l'executor n'attribue le défi d'équipe qu'à partir de 18:00 Paris, une seule fois par jour de Paris` (heure d'été/hiver, rejeu tardif sans second défi) ;
  - `attribue un seul défi quotidien par équipe et crédite ses participants sous le quota solo/équipe partagé` (deux membres voient le même défi, votes d'équipe, confirmation du capitaine, participants non confirmés non rémunérés) ;
  - `défi d'équipe : participants confirmés par le capitaine` et `le 4ᵉ gain d'équipe du jour n'est pas versé, sans erreur bloquante pour l'équipe` (plafonds).
- `src/lib/tower-team-daily.regression.integration.test.ts` : la route `GET /api/cron/tower-team-daily` réelle sur PostgreSQL — lot interrompu par le budget (HTTP 503, une seule équipe attribuée), 101 équipes atteintes en trois reprises sans doublon, budget absolu sous verrou, seconde attente tardive bornée.
- `src/lib/tower-team-daily.test.ts` : rien avant 18:00 Europe/Paris (CET et CEST), budget expiré, échec d'une équipe isolé, page suivante au-delà de 100 équipes, absence de défi non comptée comme réussite.
- `src/app/api/cron/tower-team-daily/route.test.ts` : refus sans `CRON_SECRET`, refus en Preview, interrupteur OFF par défaut.

**Ce que la preuve établit** : une attribution par équipe et par jour de Paris, idempotente sous reprises et verrous, avec budget, confirmation des participants et plafonds de récompense ; la route cron elle-même est exercée avec des dizaines d'équipes.

**Limites** : le cron réel (cron-job.org ou workflow GitHub) n'est pas déclenché depuis la CI ; `TOWER_TEAM_DAILY_ENABLED` est éteint en Production ; aucun message Discord réel n'est envoyé (la file est vérifiée en base).

**Commande** :

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/gamenight_test' \
  npx vitest run src/lib/tower-challenges.integration.test.ts src/lib/tower-team-daily.regression.integration.test.ts --maxWorkers=1
```

---

## C021 — Propositions de défis par les grades élevés (≥ Ranker)

**Exigence** (cahier §8.7) : les membres de grades élevés peuvent proposer de nouveaux défis ; l'accès à partir de Ranker a été proposé, sans seuil définitivement validé.

**Verdict : couvert de bout en bout** par `src/lib/tower-challenge-proposals.integration.test.ts` (9 tests, six utilisateurs distincts : Ranker, High Ranker, Régulars, ADMIN, OWNER, admin d'une autre communauté) :

- refus sans interrupteur, refus pour un Régulars, un membre du staff non Ranker et un membre d'une autre communauté ;
- proposition acceptée pour Ranker et High Ranker, sans ajout au catalogue avant la décision du staff ;
- barème hors 1–3, titre trop long et doublon refusés ;
- deux propositions par 24 h et par joueur, sans course entre demandes simultanées (quatre demandes en parallèle) ;
- plafond de propositions en attente ;
- file réservée au staff, décision unique, approbation créant un défi solo actif, rejet sans création, deux approbations simultanées donnant un seul défi ;
- aperçu du joueur limité à ses propres propositions.

**Complément** : `src/app/tower/propositions/actions.test.ts` et `src/app/tower/propositions/page.tsx` pour le parcours web (seuil de 30 étages, affichage du formulaire).

**Ce que la preuve établit** : le parcours complet — proposition par un Ranker/High Ranker, validation par le staff, création d'un défi unique — avec les refus d'autorisation et l'anti-abus.

**Limites** : la commande Discord et le formulaire réel ne sont pas cliqués ; `TOWER_CHALLENGE_PROPOSALS_ENABLED` est éteint en Production ; la pertinence éditoriale d'une proposition n'est pas évaluée par un test.

**Commande** :

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/gamenight_test' \
  npx vitest run src/lib/tower-challenge-proposals.integration.test.ts --maxWorkers=1
```

---

## C029 — Animation : réussites, exploits insolites, distinctions, récapitulatifs

**Exigence** (cahier §10.3) : réussites marquantes, exploits insolites, défis amusants, distinctions humoristiques, récapitulatifs hebdomadaires, résultats de compétitions, mise en avant des joueurs actifs ; les annonces ne saturent pas le général et aucune fausse réussite n'est produite.

**Verdict : couvert de bout en bout, par plusieurs scénarios** (aucun test unique ne couvre les sept sous-exigences) :

- **Exploits insolites** : `src/lib/community-highlights.integration.test.ts` — musée FAME/SHAME multi-utilisateurs (création par ADMIN, lecture par membre, édition/suppression réservées, double soumission idempotente, isolation de communauté, membre retiré/communauté suspendue, URL `javascript:` refusée).
- **Récapitulatif hebdomadaire et joueurs actifs** : `src/lib/tower-weekly-recap.integration.test.ts` — sept derniers jours, membres actifs, défis validés seulement, classement par réussites puis étages, plafond de 5 joueurs, lecteur d'une autre communauté refusé, flag éteint sans lecture.
- **Distinctions humoristiques** : `src/lib/superlative-voting.integration.test.ts` — quatre participants, deux catégories, clôture forcée ou à l'échéance, un award et un crédit XP par catégorie, ex æquo départagé, clôture concurrente unique, aucune fuite vers la communauté par défaut.
- **Résultats de compétitions** : `src/lib/tournament-announce.integration.test.ts` — annonce, fil, lancement, clôture avec champion/finaliste et résultat d'équipes, HTTP Discord simulé, contrôle de destination, reprise sans doublon.
- **Réussites marquantes et saturation** : `src/lib/notification-kinds.test.ts`, `src/lib/notification-policy.test.ts` et `src/lib/tower-challenge-announcements.test.ts` — listes fermées d'événements publics, tout le reste refusé, aucune mention `@everyone`, annonces de réussite Tower.
- **Page publique** : `src/app/tower/palmares/page.test.tsx` pour la carte « La semaine à The Tower ».

**Ce que la preuve établit** : chaque sous-exigence a un scénario automatisé avec de vrais utilisateurs et de vraies écritures ; les annonces publiques sont limitées à une liste fermée.

**Limites** : aucun message Discord réel n'est reçu (HTTP simulé), aucune donnée de Production n'est utilisée, et la cohérence d'ensemble (un même joueur mis en avant par plusieurs canaux) n'est pas testée dans un scénario unique.

**Commande** :

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/gamenight_test' \
  npx vitest run src/lib/community-highlights.integration.test.ts src/lib/tower-weekly-recap.integration.test.ts \
  src/lib/superlative-voting.integration.test.ts src/lib/tournament-announce.integration.test.ts --maxWorkers=1
```

---

## C050 — Récompenses : badges, titres, grades cosmétiques, distinctions, Hall of Fame, proposer, choisir des événements

**Exigence** (cahier §15.1) : badges GameNight, titres honorifiques, grades cosmétiques, distinctions de saison, mise en avant dans le Hall of Fame, possibilité de proposer des défis, de choisir certains événements, distinctions humoristiques, reconnaissance des exploits collectifs.

**Verdict : couvert en partie.**

Preuves existantes :

- **Titres et distinctions de saison** : `src/lib/tower-season-awards.integration.test.ts` — podium de la dernière saison terminée pour trois joueurs distincts, titre et cadre, ex æquo stricts, idempotence, deux exécutions simultanées, retard tant qu'une contestation est ouverte, expiration à la fin de la saison suivante, visibilité par un autre membre et jamais depuis une autre communauté.
- **Grades cosmétiques et personnalisation** : `src/lib/profile-customization.integration.test.ts` — achat avec le solde seul, éléments gagnés non achetables, équipement et affichage pour un autre membre, vitrine de badges par identifiant, attribution unique d'un élément gagné même en concurrence, exclusifs boosters, aucun paiement (`PREMIUM` refusé), profil masqué ou autre communauté sans fuite.
- **Badges GameNight** : `src/lib/community-progression.integration.test.ts` — déblocage, crédit XP, réparation, isolation par communauté, réessais simultanés.
- **Distinctions humoristiques** : `src/lib/superlative-voting.integration.test.ts` (voir C029).
- **Proposer des défis** : voir C021.
- **Exploits collectifs** : `src/lib/community-highlights.integration.test.ts` et les annonces de défis d'équipe (`tower-challenges.integration.test.ts`).

**Ce qui manque, et qui n'est pas corrigé ici** :

1. **Hall of Fame** : aucune interface ni workflow automatisé. `docs/TOWER_S1_REWARDS_MANUAL.md` décrit une remise **manuelle** du titre, du badge et de l'entrée Hall of Fame, et indique explicitement qu'aucune preuve de formulaire complet ni d'idempotence n'existe. La ligne reste donc à traiter en réel (ou par une PR métier dédiée).
2. **« Choisir certains événements »** : aucune implémentation trouvée dans `src/` (le besoin n'apparaît que dans le cahier). Aucun test ne peut le prouver.
3. **Badge de podium** : `awardTowerSeasonTitles` attribue un titre et un cadre, pas un badge ; le badge du top 3 relève de la procédure manuelle ci-dessus.

**Limites** : pas de test réel d'un badge affiché dans Discord, pas de preuve d'un achat ou d'un équipement cosmétique réel en Production.

---

## C078 — Votes de preuves dans Discord : boutons ✅/❌, fil par preuve, votants ≥ 3 jours

**Exigence** (cahier §27 B, ligne C078) : message public à boutons ✅/❌ mis à jour, un fil par preuve, votants actifs depuis au moins trois jours, ni auto-vote ni double vote, vote modifiable jusqu'à l'échéance, quorum de trois votants distincts, majorité stricte, égalité = refus.

**Verdict : couvert de bout en bout** par :

- `src/lib/tower-discord-votes.integration.test.ts`, deux tests ajoutés :
  - `C078 — trois votants distincts majoritaires valident la preuve et ne créditent l'étage qu'une fois` : quatre votants distincts (3 ✅, 1 ❌), clôture à 24 h, `settleTowerChallenge` → `APPROVED`, un seul étage crédité, second règlement en rejeu sans double crédit.
  - `C078 — quatre votants à égalité : preuve refusée, aucun étage crédité` : 2 ✅ / 2 ❌, quorum atteint, `REJECTED`, aucun étage.
  - Tests existants du même fichier : votant de moins de 3 jours refusé (même interrupteur éteint), auto-vote refusé, vote modifiable jusqu'à l'échéance, vote fermé après 24 h, un seul fil par preuve à la soumission (rejeu sans doublon).
- `src/lib/tower-challenges.integration.test.ts` : quorum de trois votes, majorité, égalité après quorum (4 votants, 2/2 → refus), prolongation unique de 24 h sans quorum, resoumission, votes tardifs et doublons.
- `src/lib/tower-challenge-vote-messages.test.ts` : message public avec boutons `✅ Valider` / `❌ Refuser`, nombre de votants sans détail du sens, ni auteur ni participants d'équipe dans le compteur, `allowedMentions: { parse: [] }`.
- `src/lib/tower-vote-eligibility.test.ts` : seuil exact de trois jours, compte inactif refusé, interrupteur strictement `true`.

**Ce que la preuve établit** : le parcours complet dépôt → fil → votes de plusieurs comptes → clôture → crédit (ou refus) est exécuté sur PostgreSQL avec des utilisateurs distincts ; les boutons et le compteur sont vérifiés sur le message produit.

**Limites** : aucun clic réel sur les boutons Discord, aucun fil Discord réel ; le vote et le message sont simulés côté transport. `TOWER_DISCORD_VOTES_ENABLED` est allumé en Production depuis le 25/11, mais l'essai réel reste à consigner.

**Écart de documentation constaté (non corrigé)** : le cahier §27.1 B demande des votants « présents depuis 7 jours au moins », alors que la ligne C078 de `CAHIER_FINAL.md` et le code appliquent **3 jours** (audit du 23/11/2026, constat 1.3). Le test fige les 3 jours du code et de la ligne C078. Gravité : faible (contradiction documentaire), mais elle doit être tranchée avant de déclarer C078 vérifiée en réel.

**Commande** :

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/gamenight_test' \
  npx vitest run src/lib/tower-discord-votes.integration.test.ts src/lib/tower-challenges.integration.test.ts --maxWorkers=1
```

---

## C079 — Validation automatique Steam, repli sur le vote, « Signaler un doute »

**Exigence** (cahier §27 C, ligne C079) : défis mesurables Steam validés automatiquement par un cron protégé ; profil privé = repli sur le vote ; bouton « Signaler un doute » pour les membres éligibles ; MP au joueur à la validation ; aucune IA.

**Verdict : couvert de bout en bout** par `src/lib/tower-steam-measure.integration.test.ts` (cinq tests, trois utilisateurs distincts, API Steam simulée par `getGamePlaytimeMinutes`) :

- pas de validation sans objectif atteint, puis objectif atteint → fenêtre de doute, message public mis en file ;
- plafond de 2 h de temps de jeu compté par jour : un jeu laissé ouvert n'atteint pas un objectif de 5 h ;
- profil Steam privé → `PRIVATE`, repli sur le vote, plus aucune lecture Steam ensuite ;
- crédit des étages et MP en file seulement après la fenêtre de doute ; aucun crédit avant ;
- « Signaler un doute » : auto-signalement refusé, votant de moins de 3 jours refusé, message inconnu refusé, signalement unique, bascule en vote sans crédit, aucun crédit après la bascule.

**Compléments** : `src/lib/tower-steam-measure-rules.test.ts` (plafond, jours civils Europe/Paris, objectif > 240 min jamais validé automatiquement) et `src/app/api/cron/tower-steam-autovalidate/route.test.ts` (503 sans secret, 401 avec un mauvais secret, blocage Preview, OFF par défaut, 202 avec échéance bornée).

**Ce que la preuve établit** : le parcours complet mesure → doute → crédit ou repli vote, avec plusieurs comptes et un cron protégé, sans IA.

**Limites** : l'API Steam est simulée (aucun appel réseau réel), le cron n'est pas déclenché réellement, un vrai profil Steam privé n'est pas testé, et `TOWER_STEAM_AUTOVALIDATE_ENABLED` est éteint en Production.

**Commande** :

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55439/gamenight_test' \
  npx vitest run src/lib/tower-steam-measure.integration.test.ts src/app/api/cron/tower-steam-autovalidate/route.test.ts --maxWorkers=1
```

---

## Écarts et limites signalés (aucun correctif produit dans cette PR)

1. **C078 — 3 jours contre 7 jours** : contradiction entre `CAHIER_DES_CHARGES.md` §27.1 B (« 7 jours ») et `CAHIER_FINAL.md` / le code (« 3 jours »). Gravité **faible** (documentation), à trancher par Maxime.
2. **C050 — « choisir certains événements »** : exigence du cahier §15.1 sans implémentation ni test dans `src/`. Gravité **moyenne** pour la ligne C050, qui reste « couvert en partie ».
3. **C050 — Hall of Fame et badge de podium** : remise manuelle, sans interface admin prouvée ni idempotence (`docs/TOWER_S1_REWARDS_MANUAL.md`). Gravité **moyenne** : la ligne ne peut pas être déclarée vérifiée sur la seule base du code.
4. **C008 — prestige Discord** : les grades sont calculés et lus, mais aucun test ne prouve l'attribution ou l'affichage réel des rôles de prestige dans Discord. Relève du test réel.

## Hors périmètre

- **C081 et D6** : non traités, conformément à la consigne, tant que #641 n'est pas fusionnée sur `main`.
- Aucune ligne du cahier n'est passée au vert, aucun interrupteur n'est modifié, aucune migration n'est ajoutée, aucune donnée de Production n'est utilisée.
