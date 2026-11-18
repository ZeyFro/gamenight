# Conditions de réussite du lancement — état réel au 17/11/2026

> Checklist des 17 conditions de livraison finale du cahier (`docs/TOWER_CAHIER_DES_CHARGES_GLOBAL.md`, §25 ; les §31, §32 et §34 cités dans la demande n'existent pas dans les cahiers du dépôt, la liste est donc celle du §25). **Règle : une case n'est cochée que si la condition est livrée ET activée, avec preuve.** Au 17/11/2026, **aucune case n'est cochée** : rien de ce qui concerne l'Ascension n'est activé, et aucune preuve de parcours réel n'existe encore.
> Sources : `origin/main` (`23f58a8d`), état des PR via l'API GitHub, fichiers cités. L'état des variables Vercel et de Discord n'est pas lisible depuis le dépôt : tout ce qui en dépend reste « non vérifié ».

Légende : `[x]` livré et activé, prouvé · `[ ]` non rempli. Colonne État : **Livré non activé** · **Partiel** · **Non livré** · **Non vérifié**.

| N° | Condition (§25) | Case | État | Preuve / motif |
| ---: | --- | :---: | --- | --- |
| 1 | Identité visuelle et navigation cohérentes | [ ] | Partiel | Maquette de salons et forums dans `src/lib/tower-discord-layout.json`, forums dans `src/lib/tower-forums.ts`, pages `/tower` et `/ascension`. Rien n'est appliqué sur le serveur Discord. |
| 2 | Accueil et accès d'un vrai nouveau membre | [ ] | Livré non activé | Panneau à 3 boutons : code présent, `TOWER_ONBOARDING_PANEL_ENABLED` éteint, jamais publié (`docs/TOWER_ONBOARDING_PANEL_SETUP.md`). Aucun test avec un compte neuf (`docs/TOWER_PHASE1_RECETTE_PUBLIQUE.md`, tous « À tester »). |
| 3 | Tickets, rôles et modération réutilisés ou remplacés | [ ] | Non vérifié | Deux panneaux Ticket Tool non départagés (`docs/TOWER_TICKET_TOOL_AUDIT.md`) ; YAGPDB et Appy conservés, aucune vérification en conditions réelles. |
| 4 | Grades et permissions cohérents | [ ] | Partiel | Rangs affichés dans l'application seulement (`src/lib/tower-ranks.ts`, aucun rôle Discord). Écarts avec §26 : High Ranker, Irregular, couleurs (voir [LANCEMENT_DISCORD.md](LANCEMENT_DISCORD.md), section 6). |
| 5 | Ascension sans double progression | [ ] | Non vérifié | Atlas non prouvé éteint (`docs/TOWER_ATLAS_ARRET.md`, `docs/TOWER_PHASE1_RECETTE_PUBLIQUE.md`). |
| 6 | Anciens rôles Étage retirés après migration | [ ] | Non livré | Reporté après le 1er décembre (`docs/PLAN-J14-20261201.md`) : 134 rôles, aucune suppression sans inventaire. |
| 7 | Défis solo et collectifs fonctionnent | [ ] | Livré non activé | Code et tests sur `main` (`src/lib/tower-challenges.ts`, commandes `/tower` et `/tower-admin` dans `scripts/discord-commands.json`). `TOWER_CHALLENGES_ENABLED` absent, commandes non enregistrées (`docs/TOWER_COMMANDES_GUILD.md`), catalogue non importé. |
| 8 | Preuves, votes et contestations conformes | [ ] | Partiel | Votes 24 h, 3 votants distincts, majorité stricte, pas d'auto-vote : sur `main`, non activés. Prolongation de 24 h puis rejet : non livré (`src/lib/tower-challenge-voting.ts`). Contestation : PR #407 brouillon, non fusionnée. |
| 9 | Quotas et anti-abus testés | [ ] | Livré non activé | 12 h, 48 h, 2 réussites/jour : `src/lib/tower-challenge-rules.ts` et tests unitaires ; pas de test de bout en bout, pas d'activation. |
| 10 | Équipes et forums opérationnels | [ ] | Partiel | Équipes sur `main` avec 2 à 20 membres et sans équipe unique (`src/lib/community-teams-rules.ts`) ; règles décidées (2–8, équipe unique, 7 jours) dans la PR #370, brouillon. Forums : code `src/lib/tower-forums.ts`, non créés sur Discord. Défi d'équipe quotidien : code et workflow présents (09:00), interrupteur éteint, heure décidée 18:00. |
| 11 | Soirées et événements GameNight intégrés | [ ] | Livré, activation Discord non vérifiable | Soirées, tournois, calendrier : code et usage anciens, annonces dépendant d'interrupteurs et de salons non lisibles depuis le dépôt. À cocher après vérification d'une annonce réelle. |
| 12 | Classements, saisons et récompenses | [ ] | Partiel | Classement et départage conformes à §26 (`src/lib/tower-standings.ts`), podium en lecture seule (`/tower/palmares`, `docs/TOWER_SEASON_PODIUM.md`), rien d'activé. Titres, badges, cadres et Hall of Fame : non livrés. Calendrier de saison différent de §26. |
| 13 | Première saison : catalogue et calendrier | [ ] | Partiel | Catalogue de 36 défis dans `src/lib/tower-challenge-starter-catalogue.ts` et `tower-team-challenge-starter-catalogue.ts`, non importé, à valider (`docs/TOWER_SAISON1_CATALOGUE_30.md`). Calendrier S1 du code : 4/01 → 28/03 ; décidé : 1/12/2026 → 31/03/2027. |
| 14 | Données et permissions protégées | [ ] | Partiel | Garde d'accès Membership et isolation (CLAUDE.md, `docs/SECURITE_CLAUDE.md`) ; revue de permissions Discord non faite, anti-raid non audité. |
| 15 | Déploiements validés et vérifiés sur Discord | [ ] | Non livré | Aucune commande enregistrée, aucun parcours Discord vérifié, bêta interne non tenue (`docs/TOWER_KIT_BETA_T19.md`). |
| 16 | Fonctions facultatives non développées identifiées | [ ] | Partiel | Hors v1 décidé : IA d'orientation, salons vocaux temporaires, Discord Activities. Identifiés dans [LANCEMENT_DISCORD.md](LANCEMENT_DISCORD.md) et [PRESENTATION_RECRUTEMENT.md](PRESENTATION_RECRUTEMENT.md), à confirmer à la relecture. |
| 17 | Aucun faux état d'avancement présenté comme livré | [ ] | En cours | Les textes de lancement sont étiquetés ; vérifié à la relecture finale avant publication. |

## État des PR de la pile (API GitHub, 17/11/2026)

| PR | Sujet | État |
| --- | --- | --- |
| #370 | Équipes 2–8, équipe unique, délai 7 jours, passation | Brouillon, non fusionnée |
| #406 | Préférences de notification, kit bêta | Brouillon, non fusionnée |
| #407 | Codes de preuve, modération, contestations | Brouillon, non fusionnée |
| #408 | Matchmaking et `/equipe` | Brouillon, non fusionnée |
| #416 | Manifeste de `/equipe` | Brouillon, non fusionnée |
| #325 | XP boutique et présence vocale | Brouillon, gelée |
| #396 | Cron quotidien des défis d'équipe | Fusionnée (interrupteur éteint) |
| #450 | Décisions §26 du 17/11 | Brouillon |

## Décompte

- Cochées : **0 / 17**.
- Livré non activé : 3 (2, 7, 9) ; livré, activation non vérifiable : 1 (11) ; partiel : 8 (1, 4, 8, 10, 12, 13, 14, 16) ; non livré : 2 (6, 15) ; non vérifié : 2 (3, 5) ; en cours : 1 (17).
- Bloquants du lancement : pile de PR, commandes enregistrées, interrupteurs, arbitre, parcours compte neuf, écarts §26 / code.

## Comment cocher

Une case passe à `[x]` seulement avec : (a) la PR fusionnée, (b) l'interrupteur activé en Production, (c) une preuve datée sans secret (parcours d'un vrai compte non modérateur), (d) la ligne mise à jour dans cette page par PR. Un test « skipped » ou « non exécuté » n'est jamais une preuve.
