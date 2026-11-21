# Vérifications en lecture seule — endpoint de santé, saison 1, horaire des défis (21/11/2026)

Relevé fait **dans le code et les documents de `main`** (commit `62fc4612`). Rien n'a été exécuté contre Vercel, Neon ou Discord, rien n'a été codé. Ce document liste les faits et les **écarts** ; il ne corrige rien.

## 1. Endpoint de santé

| Question | Réponse | Preuve |
| --- | --- | --- |
| Existe-t-il ? | **Oui** : `GET /api/health` | `src/app/api/health/route.ts` |
| Est-il public ? | **Non.** Il exige `Authorization: Bearer <CRON_SECRET>` (`verifyCronRequest`) : **503** si `CRON_SECRET` est absent côté serveur, **401** si le jeton est faux | même fichier |
| Que contrôle-t-il ? | Un `SELECT 1` sur la base. Succès : `200 {"ok":true,"db":"ok"}` ; base injoignable : `503 {"ok":false,"db":"error"}` | même fichier |
| Ce qu'il ne contrôle pas | Discord (bot, executor de notifications), Steam, IGDB, Blob. Un `200` ne dit donc **pas** que les MP ou les annonces partent | — |

### Écarts et conséquences

1. **Un moniteur d'uptime « classique » (sans en-tête) reçoit 401 ou 503**, donc une alerte permanente ou aucun signal utile. Il faut un service qui sache envoyer l'en-tête `Authorization: Bearer …` (cron-job.org le sait ; c'est l'usage prévu par `docs/backlog-auto.md`, ligne 21). **Ne jamais coller `CRON_SECRET` dans un service qui l'affiche en clair ou le journalise.**
2. **La route n'est pas listée dans `docs/CRONS.md`** (elle n'apparaît que dans `docs/LIVRAISON-BARRIERE.md`, `docs/guide-relecture.md`, `docs/backlog-auto.md` et l'audit). Écart de documentation, sans effet sur le code.
3. **Aucune alerte de disponibilité n'est configurée par le dépôt** : `vercel.json` ne définit aucun déclencheur cron (`docs/CRONS.md`, lignes 5-7) et rien dans le code ne prouve qu'un moniteur existe. Vérifié seulement par Maxime (voir `docs/CHECKLIST_LANCEMENT.md`, ligne « alertes de disponibilité »).
4. Pour un contrôle **sans secret** (à la main, navigateur) : la page de connexion `/` répond `200` quand l'application tourne ; elle ne teste pas la base.

## 2. Saison 1

Source de vérité du code : `getTowerSchoolSeason` dans `src/lib/tower-challenge-seasons.ts`. Source de la décision : `docs/DECISIONS_TOWER.md` (17/11/2026).

| Saison | Début (inclus, minuit Europe/Paris) | Fin (exclue) |
| --- | --- | --- |
| **S1 · 2026-2027** | **1er décembre 2026** | **1er avril 2027** (dernier jour : 31 mars 2027) |
| S2 | 1er avril | 1er juillet |
| Été | 1er juillet | 1er septembre |
| S3 | 1er septembre | 1er décembre |

Pas d'intersaison : une saison est toujours active. **Code et décision concordent.**

### Seuils de grade (`src/lib/tower-ranks.ts`)

| Grade | Condition dans le code | Décision (`DECISIONS_TOWER.md`) |
| --- | --- | --- |
| Régulars | dès l'inscription | idem |
| Ranker | **≥ 30 étages** gagnés | idem |
| High Ranker | **≥ 100 étages** ET **≥ 5 défis validés** dans la saison courante | idem |
| Irregular | attribution manuelle par le staff (prestige, aucun droit) | idem |

**Concordent.** Barème des défis : facile +1, moyen +2, difficile +3 étages (permanents).

### Écarts de documentation (historiques, sans effet sur le code)

| Document | Ce qu'il dit encore | Pourquoi ce n'est pas la règle |
| --- | --- | --- |
| `docs/TOWER_DECISIONS_26_20261104.md`, ligne 17 | S1 du 4 janvier au 28 mars 2027 ; ouverture le 4 janvier | Remplacé le 17/11/2026 (bandeau du fichier) |
| `docs/PLAN_SERVEUR_DISCORD.md`, ligne 100 | Ancien et nouveau calendrier côte à côte | Le tableau donne bien « 1er décembre → 31 mars » en nouvelle valeur |
| `docs/ROADMAP.md`, ligne 287 ; `docs/TOWER_ACTIVATION_PROGRESSIVE_T18.md`, ligne 3 ; `docs/backlog-auto.md`, ligne 1 | Ouverture publique le 4 janvier 2027 (repli 1er février) | Le lancement est désormais la **semaine du 1er décembre 2026** (`docs/PLAN_SERVEUR_DISCORD.md`) |

À retenir : **si quelqu'un lit « 4 janvier », c'est un document d'octobre/novembre périmé.** Les archiver ou y ajouter un bandeau est un travail documentaire à part.

> **Ne pas confondre** avec `src/lib/seasons.ts` : ce sont les saisons **mensuelles d'XP** de GameNight, un autre système que les saisons de The Tower.

## 3. Horaire des défis

Constantes relevées dans `src/lib/tower-challenge-rules.ts`, `tower-challenge-voting.ts` et `tower-challenge-appeal-rules.ts` :

| Règle | Valeur dans le code | Décision | Concorde ? |
| --- | --- | --- | --- |
| Défi d'équipe quotidien attribué à partir de | **18:00 Europe/Paris** (`TOWER_TEAM_DAILY_HOUR = 18`) | 18:00 (décision du 17/11) | Oui |
| Délai pour déposer une preuve | **48 h** | 48 h | Oui |
| Attribution d'un défi solo | **1 par 12 h** au plus | idem | Oui |
| Récompenses validées par jour (Paris) | **2** (solo + équipe) | idem | Oui |
| Durée du vote | **24 h** | 24 h | Oui |
| Quorum | **3** votants distincts (`TOWER_CHALLENGE_VOTE_QUORUM`) | 3 | Oui |
| Quorum non atteint | **une** prolongation de 24 h, puis rejet **sans pénalité** | idem | Oui |
| Fenêtre de contestation | **48 h** | 48 h | Oui |

### Comment l'horaire de 18:00 est appliqué (à connaître avant l'annonce)

- Le workflow `.github/workflows/tower-team-daily.yml` a deux déclencheurs UTC (`0 16,17 * * *`) ; il n'appelle `GET /api/cron/tower-team-daily` **que** quand il est 18 h à Paris (16 h UTC l'été, 17 h UTC l'hiver). **Le 1er décembre : 17:00 UTC.**
- Il ne fait rien si `TOWER_TEAM_DAILY_ENABLED` n'est pas exactement `true` (**OFF par défaut**, et absent des variables posées lors de la phase 1 ; à revérifier dans Vercel) : **aucun défi d'équipe quotidien n'est donc attribué tant que cet interrupteur et les prérequis de `docs/TOWER_TEAM_DAILY_CRON.md` ne sont pas activés.**
- Les workflows planifiés de GitHub ne tournent qu'à partir de la branche par défaut et peuvent prendre du retard de plusieurs minutes ; le « 18:00 » est donc « autour de 18:00 ».
- Le cron `notification-executor` appelle aussi l'attribution quotidienne, mais **sans jamais devancer 18:00** (`docs/TOWER_TEAM_DAILY_CRON.md`, ligne 45). La cadence de ce cron est **externe** (cron-job.org) : elle n'est pas vérifiable depuis le code.

## 4. Autres constats utiles au lancement (lecture seule)

| # | Constat | Source | Action de Maxime |
| --- | --- | --- | --- |
| 1 | `LEGAL_PAGES_ENABLED` et les cinq `LEGAL_*` ne sont pas posés en Production : les pages légales sont **éteintes** (404) | relevé Vercel de la phase 1 (20-21/11) | Fournir les valeurs, puis suivre `docs/SOIREE_ACTIVATION.md` § 9 bis |
| 2 | `SESSION_MEDIA_BLOB_TOKEN` absent : la galerie des soirées et les médias privés ne sont pas disponibles | relevé Vercel | Décider avant l'annonce (voir `docs/CHECKLIST_LANCEMENT.md`) |
| 3 | `DISCORD_COMMAND_REGISTRATION_*` non posés : les 13 commandes ne sont pas enregistrées tant que `docs/SOIREE_ACTIVATION.md` § 9 sexies n'est pas faite | relevé Vercel | Attendre le « prêt » de Maxime |
| 4 | Les journaux d'exécution Vercel (plan Hobby) ne remontent qu'à **1 h** : une erreur de la veille n'est plus visible | doc Vercel + relevé | Surveiller pendant le lancement ; voir `docs/RUNBOOK.md` |
| 5 | Le message du guide publié dans `#guide-de-la-tour` dit encore « Tes étages actuels restent en place » : à corriger à la main | décision du 18/11 | Voir `docs/MESSAGES_LANCEMENT.md` |
| 6 | Le bot a le droit **Administrateur** via les rôles Workshop/AppBot : à retirer après correction du salon privé | `docs/PHASE_TEST.md` | Voir la section « Droits minimaux » |
| 7 | Les confusions « Neon Test » : le projet `misty-tooth-45335023` est la **Production** ; seule la branche `tower-migration-test-*` et le projet `winter-scene-14323342` sont des tests | `docs/COUVERTURE_CAHIER.md`, `docs/SOIREE_ACTIVATION.md` § 2 | Aucune ; vigilance à chaque connexion Neon |
| 8 | Chaque fusion dans `main` redéploie la Production, **même pour une PR de documentation** ; la CI ne tourne que sur les PR | `.github/workflows/` | Grouper les fusions pendant la semaine 1 |

## 5. Ce qui n'a pas pu être vérifié depuis le code

- La cadence réelle des crons externes (cron-job.org) et leur état (actifs/en échec).
- La valeur de `NOTIFICATION_EXECUTOR_ENABLED` en Production (le nom existe, la valeur n'est pas lisible).
- L'existence d'un moniteur d'uptime et d'une alerte e-mail Vercel/Neon.
- Les sauvegardes Neon (période de restauration réellement active selon le plan).
- Les limites réelles des plans Vercel Hobby, Neon et Discord (à relire sur les consoles le jour J).
