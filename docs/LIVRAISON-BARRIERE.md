# Livraison de la barrière d'écriture : rôles, précontrôle, inventaire, repli

Complète [XP-ROLE-BARRIER-REHEARSAL.md](XP-ROLE-BARRIER-REHEARSAL.md), [XP-REPETITION-COMPLETE.md](XP-REPETITION-COMPLETE.md) et [XP-MAINTENANCE-PLAN.md](XP-MAINTENANCE-PLAN.md). Tout ce qui est dit « exécuté » l'a été en local (Docker 127.0.0.1, données synthétiques). **Rien n'a été exécuté contre Production ni Neon.**

Constat Production (lecture seule du 23/10) : un seul rôle de connexion applicatif `neondb_owner` (propriétaire, CREATEROLE, BYPASSRLS) ; ni rôle runtime ni rôle de migration distincts ; 111 migrations terminées, aucune du lot de 6 ; binding Vercel vers Neon non prouvé.

## 1. Précontrôle en lecture seule : `scripts/prod-precheck.mjs`

Lancé par l'**opérateur**, sur sa machine, avec sa variable privée (jamais en argument) :

```bash
GAMENIGHT_PRECHECK_DATABASE_URL=<url privée> GAMENIGHT_EXPECTED_TARGET="<hôte>[:port]/<base>" \
  node scripts/prod-precheck.mjs --state=pre            # avant migration
  node scripts/prod-precheck.mjs --state=post           # après migration
  # options : --require-split-roles  --require-no-sessions-of=<rôle>  --lot=a,b  --allow-local (local seulement)
```

- N'envoie que les constantes de la liste blanche de `scripts/prod-precheck-lib.mjs` (SELECT sur catalogues et `_prisma_migrations`, plus `SET TRANSACTION READ ONLY` : le serveur refuserait une écriture). Toute autre instruction est refusée avant envoi (test `src/lib/prod-precheck.test.ts`). Aucun texte de requête, aucun condensat de mot de passe, agrégats seulement sur `CommunityMemberStats`.
- Refuse : URL en argument, variable absente, URL concurrente (`DIRECT_URL`, `POSTGRES_URL`…), cible différente de `GAMENIGHT_EXPECTED_TARGET`, hôte poolé, local sans `--allow-local` ou base hors `gamenight_*`, base réellement jointe différente de celle de l'URL. L'URL et le mot de passe ne sont jamais affichés (masqués).
- Affiche : migrations terminées / inachevées / annulées sans reprise, écart avec le checkout, présence des 6 du lot, rôles et attributs, appartenances, propriétaires des tables, sessions par rôle / application / état, taille et comptes de `CommunityMemberStats`, négatifs.
- `--require-no-sessions-of=neondb_owner` sert **après** la barrière : écart si une session de ce rôle subsiste (la session du précontrôle est exclue).

| Code | Sens |
|---|---|
| 0 | conforme |
| 1 | erreur inattendue (connexion impossible…) |
| 2 | refus de configuration (cible, variable, argument, instruction hors liste blanche) |
| 3 | écart constaté (la base n'est pas dans l'état demandé) |

Exécuté en local (PostgreSQL 16, base `gamenight_precheck_main`, rôle superuser local) : état main (111 migrations, seed de 2 lignes) : `--state=pre` code 0, `--state=post` code 3 (3 écarts) ; après `prisma migrate deploy` (117 migrations) : `--state=post` code 0, `--state=pre` code 3. Refus : URL en argument (2), cible inattendue (2), locale sans `--allow-local` (2). Historique `_prisma_migrations` inchangé (117 lignes).

## 2. Connexion propriétaire déjà ouverte : méthode et preuve

**Méthode qui s'applique en Production** (un seul rôle propriétaire) : rotation du mot de passe de `neondb_owner` par une session propriétaire conservée par l'opérateur, puis `pg_terminate_backend` des autres sessions de ce rôle, puis second balayage après environ 2 s. Le rôle de migration `gn_migrator` est un AUTRE rôle (membre de `neondb_owner`), le rôle runtime `gn_runtime` est `NOLOGIN` pendant la fenêtre. `NOLOGIN` sur le propriétaire n'est pas applicable par lui-même (`42501`) et `REVOKE CONNECT` seul est sans effet (`PUBLIC` garde `CONNECT`) : ne pas s'y fier.

Lu dans `scripts/rehearse-xp-role-barrier.mjs` et vérifié par exécution (`XP_ROLES_PORT=55481 XP_ROLES_CONTAINER=gn-mB-roles-pg XP_ROLES_LABEL=mission-B`, code 0) :

- Les connexions de l'ancien runtime sont ouvertes **avant** la barrière : deux occupées, deux idle réutilisées (0,7 s et 2 s), une transaction longue pilotée (`BEGIN`, `UPDATE`, `pg_sleep`, `INSERT`, `COMMIT`), une qui se reconnecte toutes les 1,2 s ; en direct et via pgbouncer. Après le terminate : 0 session sur 10 relevés (4,6 s), delta `pg_stat_database` nul (insérés 0), 0 écriture réussie de l'ancien runtime (102 refus par instance), canari avec les anciens identifiants refusé en direct et via le pooler, 0 ligne canari en base. Témoin positif : avant la barrière le canari réussit ; sans le terminate, des écritures réussissent encore (y compris la transaction longue). Ces points sont des **assertions** du script (il sort en erreur sinon).
- Second balayage : 0 session terminée (le premier avait tout pris) ; il reste prévu dans le protocole comme filet contre une session en cours d'authentification pendant le premier.
- **Trou documenté, prouvé par exécution** (phase 3c) : la barrière vise `neondb_owner`. `gn_migrator`, membre de `neondb_owner`, écrit encore directement et par `SET ROLE neondb_owner` (transactions annulées, 0 ligne). C'est la voie légitime de la migration, pas celle de l'ancien runtime ; elle impose : aucun autre usage de `gn_migrator`, et contrôle `--require-no-sessions-of=gn_migrator` avant la fenêtre.
- **Non couvert, à ne pas promettre** : un rôle superuser ou membre d'un rôle administrateur de plateforme n'est pas arrêté par `REVOKE`/`NOLOGIN` (seule la rotation du mot de passe l'arrête, comme les autres) ; le précontrôle affiche `is_superuser` et les attributs réels. Le pooler de Neon n'est pas pgbouncer : codes d'erreur et recyclage à reconfirmer. L'intégration Vercel-Neon peut propager le nouveau mot de passe dans les variables d'un NOUVEAU déploiement : aucun redéploiement pendant la fenêtre, et le nouveau mot de passe n'est jamais mis dans Vercel.

## 3. Anciens déploiements, crons, callbacks, tâches différées

Garantie côté base, quel que soit le déployé : un ancien build Vercel encore routable utilise l'ancien mot de passe de `neondb_owner` (variable figée dans le déploiement) : après la rotation et le terminate il **ne peut ni écrire ni lire** (le site est indisponible pour l'utilisateur, c'est voulu). Une tâche `after()` en cours perd sa connexion au terminate, ses nouvelles connexions échouent. **Ce que la base n'arrête pas** : les effets externes (messages Discord, appels Steam/IGDB, notifications push) qui ne passent pas par la base.

Moyens par type : voir le tableau « Leviers ». Les variables d'environnement Vercel ne sont pas réinjectées dans un déploiement existant : retirer `CRON_SECRET` ou un `*_ENABLED` n'agit que sur un nouveau déploiement. Les jobs externes (cron-job.org) se désactivent chez le planificateur. Suspendre le projet Vercel est un levier opérateur, non exécuté ni évalué ici.

Le tableau suivant est **généré** (`node scripts/inventory-write-surface.mjs --out=docs/LIVRAISON-BARRIERE.md` ; `--check=` vérifie qu'il est à jour). Analyse statique : « écriture atteignable » surestime (un import n'est pas un appel) ; les gardes ne sont cherchées que dans le point d'entrée et ses imports directs.

<!-- INVENTAIRE:DEBUT (généré par scripts/inventory-write-surface.mjs) -->

Routes HTTP (28) :

| Route | Méthodes | Type | Écriture base | Effets externes | `after()` | Garde détectée |
|---|---|---|---|---|---|---|
| `/api/admin/force-relogin` | POST | autre | via 2 fichier(s) | oui | non | CRON_SECRET (Bearer) |
| `/api/auth/[...nextauth]` | ? | authentification | via 4 fichier(s) | oui | non | session utilisateur |
| `/api/backfill/game-news` | POST | backfill | via 2 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/backfill/igdb-coop` | GET, POST | backfill | via 3 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/backfill/seed-reconcile` | GET, POST | backfill | via 29 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/backfill/steam-store` | POST | backfill | via 2 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/calendrier/export` | GET | autre | via 21 fichier(s) | oui | oui | session utilisateur |
| `/api/calendrier/feed/[token]` | GET | autre | via 4 fichier(s) | non | non | jeton dans l'URL |
| `/api/cron/close-sessions` | GET | cron | via 29 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/cron/community-guild-sync` | GET | cron | via 4 fichier(s) | oui | non | CRON_SECRET (Bearer) |
| `/api/cron/discord-thread-cleanup` | GET | cron | via 18 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/cron/free-game-discord` | GET | cron | via 18 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/cron/monthly-tasks` | GET | cron | via 20 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/cron/notification-executor` | GET | cron | via 18 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/cron/refresh-discord-profiles` | GET | cron | via 3 fichier(s) | oui | non | CRON_SECRET (Bearer) ; jeton dans l'URL |
| `/api/cron/reminders` | GET | cron | directe | oui | oui | CRON_SECRET (Bearer) |
| `/api/cron/retention-cleanup` | GET | cron | via 22 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/cron/steam-library-full-sync` | GET, POST | cron | directe | oui | oui | CRON_SECRET (Bearer) |
| `/api/cron/steam-library-sync` | GET | cron | via 23 fichier(s) | oui | oui | CRON_SECRET (Bearer) |
| `/api/csp-report` | POST | autre | non | non | non | aucune détectée |
| `/api/discord/interactions` | POST | webhook-discord | via 28 fichier(s) | oui | oui | signature Ed25519 Discord |
| `/api/discord/webhook-events` | POST | webhook-discord | via 1 fichier(s) | non | non | signature Ed25519 Discord |
| `/api/health` | GET | autre | via 1 fichier(s) | non | non | CRON_SECRET (Bearer) |
| `/api/igdb/search` | GET | autre | via 5 fichier(s) | oui | non | session utilisateur |
| `/api/push/subscription` | POST, DELETE | autre | directe | oui | non | session utilisateur |
| `/api/sessions/[sessionId]/media/[mediaId]` | GET | autre | via 21 fichier(s) | oui | oui | session utilisateur |
| `/api/steam/callback` | GET | authentification | directe | oui | oui | session utilisateur |
| `/api/steam/link` | GET | authentification | via 23 fichier(s) | oui | oui | session utilisateur |

Leviers par type (la barrière base s'applique à tous) :

| Type | Levier pendant la fenêtre |
|---|---|
| autre | Rien à retirer : les écritures échouent avec la barrière ; les lectures échouent aussi pour l'ancien rôle. |
| authentification | Connexion Discord/Steam : lectures et écritures de session échouent pendant la barrière (site indisponible). Rien à retirer. |
| backfill | Même levier que les crons (déclenchés à la main ou par job externe) : ne pas les lancer pendant la fenêtre ; la barrière suffit pour la base. |
| cron | Désactiver le job chez le planificateur externe (cron-job.org) ; retirer `CRON_SECRET` ne vaut que pour un NOUVEAU déploiement (les variables Vercel ne sont pas réinjectées dans un déploiement existant). Sinon : la barrière suffit, les écritures échouent. |
| webhook-discord | Appelé par Discord : ne pas le désactiver côté Discord sans nécessité ; la barrière fait échouer les écritures (Discord peut retenter). Les réponses sans base restent possibles. |

Server actions (58 fichiers `"use server"`) : exécutées par l'application déployée, donc par le rôle de CE déploiement ; ancien déploiement = ancien rôle = bloqué par la barrière. Aucun levier hors barrière ou pause du projet.

| Fichier | Actions async | Écriture base | Effets externes |
|---|---|---|---|
| `src/app/actions.ts` | 6 | directe | oui |
| `src/app/admin/badges/actions.ts` | 4 | directe | oui |
| `src/app/admin/communautes/actions.ts` | 9 | via 24 fichier(s) | oui |
| `src/app/admin/jeux-gratuits/actions.ts` | 2 | directe | oui |
| `src/app/admin/jeux-stats/actions.ts` | 6 | directe | oui |
| `src/app/admin/joueurs/actions.ts` | 1 | via 22 fichier(s) | oui |
| `src/app/admin/messages/actions.ts` | 4 | directe | oui |
| `src/app/admin/nettoyage/actions.ts` | 2 | via 22 fichier(s) | oui |
| `src/app/admin/reglages/actions.ts` | 1 | via 21 fichier(s) | oui |
| `src/app/admin/superlatifs/actions.ts` | 4 | directe | oui |
| `src/app/bibliotheque/actions.ts` | 4 | directe | oui |
| `src/app/calendrier/actions.ts` | 3 | directe | oui |
| `src/app/calendrier/feed-actions.ts` | 1 | via 22 fichier(s) | oui |
| `src/app/charte/actions.ts` | 1 | directe | oui |
| `src/app/chat/actions.ts` | 3 | directe | oui |
| `src/app/dettes/actions.ts` | 2 | directe | oui |
| `src/app/disponibilites/actions.ts` | 5 | directe | oui |
| `src/app/jeux/actions.ts` | 1 | via 22 fichier(s) | oui |
| `src/app/jeux/preparation-actions.ts` | 1 | directe | oui |
| `src/app/jeux/warning-actions.ts` | 1 | directe | oui |
| `src/app/jouer-maintenant/actions.ts` | 6 | via 25 fichier(s) | oui |
| `src/app/joueurs/actions.ts` | 2 | directe | oui |
| `src/app/notifications-actions.ts` | 1 | directe | oui |
| `src/app/onboarding-actions.ts` | 2 | directe | oui |
| `src/app/profil/actions.ts` | 6 | directe | oui |
| `src/app/profil/boutique/actions.ts` | 2 | via 22 fichier(s) | oui |
| `src/app/profil/family-import-actions.ts` | 2 | directe | oui |
| `src/app/profil/game-preference-actions.ts` | 2 | directe | oui |
| `src/app/profil/game-style-actions.ts` | 1 | directe | oui |
| `src/app/profil/gaming-identifiers-actions.ts` | 1 | directe | oui |
| `src/app/profil/lore/cimetiere/actions.ts` | 2 | via 22 fichier(s) | oui |
| `src/app/profil/lore/expressions/actions.ts` | 2 | via 22 fichier(s) | oui |
| `src/app/profil/lore/musee/actions.ts` | 2 | via 23 fichier(s) | oui |
| `src/app/profil/lore/sondages/actions.ts` | 2 | via 23 fichier(s) | oui |
| `src/app/profil/player-equipment-actions.ts` | 1 | directe | oui |
| `src/app/roulette/actions.ts` | 5 | directe | oui |
| `src/app/serveurs/actions.ts` | 2 | via 21 fichier(s) | oui |
| `src/app/sessions/actions/availability-polls.ts` | 4 | via 24 fichier(s) | oui |
| `src/app/sessions/actions/chronicles.ts` | 1 | via 22 fichier(s) | oui |
| `src/app/sessions/actions/draw.ts` | 1 | via 29 fichier(s) | oui |
| `src/app/sessions/actions/gallery.ts` | 2 | directe | oui |
| `src/app/sessions/actions/invites.ts` | 5 | via 23 fichier(s) | oui |
| `src/app/sessions/actions/predictions.ts` | 2 | via 30 fichier(s) | oui |
| `src/app/sessions/actions/preparation.ts` | 1 | via 23 fichier(s) | oui |
| `src/app/sessions/actions/proposals-votes.ts` | 3 | directe | oui |
| `src/app/sessions/actions/ratings.ts` | 1 | directe | oui |
| `src/app/sessions/actions/results.ts` | 1 | directe | oui |
| `src/app/sessions/actions/seats.ts` | 1 | via 23 fichier(s) | oui |
| `src/app/sessions/actions/session-lifecycle.ts` | 8 | directe | oui |
| `src/app/sessions/actions/suggest-slots.ts` | 1 | via 21 fichier(s) | oui |
| `src/app/sessions/actions/superlatives.ts` | 2 | directe | oui |
| `src/app/sessions/actions/veto.ts` | 2 | directe | oui |
| `src/app/sessions/actions/voice-presence.ts` | 2 | via 24 fichier(s) | oui |
| `src/app/tags-actions.ts` | 2 | directe | oui |
| `src/app/tierlist/actions.ts` | 1 | directe | oui |
| `src/app/tournois/actions.ts` | 8 | directe | oui |
| `src/app/tournois/prediction-actions.ts` | 1 | via 22 fichier(s) | oui |
| `src/app/wishlist/actions.ts` | 3 | directe | oui |

Fichiers utilisant `after()` (tâches différées qui survivent à la réponse, donc aux crons et actions qui les lancent) : `src/app/api/backfill/game-news/route.ts`, `src/app/api/backfill/igdb-coop/route.ts`, `src/app/api/backfill/seed-reconcile/route.ts`, `src/app/api/backfill/steam-store/route.ts`, `src/app/api/cron/steam-library-full-sync/route.ts`, `src/app/api/discord/interactions/route.ts`, `src/app/layout.tsx`, `src/lib/discord-interactions.ts`, `src/lib/notification-executor-kick.ts`.

<!-- INVENTAIRE:FIN -->

## 4. `db-migrate.mjs` : dry-run, refus, codes de sortie

Sans `--execute` : aucune écriture et aucun DDL (lecture de `_prisma_migrations` seulement) ; preuve exécutée : `src/lib/db-migrate-cli.integration.test.ts` (base neuve : aucune table `_prisma_migrations` créée après dry-run ; base migrée : somme de contrôle de l'historique et nombre de tables identiques avant et après un refus « rien à faire »).

| Code | Sens | Exemples vérifiés par test |
|---|---|---|
| 0 | OK ou dry-run | dry-run avec la liste exacte ; migrations appliquées |
| 1 | erreur inattendue | |
| 2 | refus avant toute écriture | cible inattendue, locale sans `--allow-local`, hôte poolé, base locale hors `gamenight_*`, `MIGRATION_DATABASE_URL` absente, URL concurrente ou `DATABASE_URL` en désaccord avec `GAMENIGHT_RUNTIME_ROLE`, rôle de migration = rôle runtime, `--expect` manquante / en trop / **inversée** / doublon, migration inachevée, `--execute` sans `--confirm-database`, `--execute` hors local sans contrôle du rôle runtime, **rien à faire** |
| 3 | `prisma migrate deploy` en échec | état laissé : migrations précédentes appliquées, la fautive inachevée ; relance refusée (2) |
| 4 | contrôle après migration en échec ou impossible | migration probablement appliquée : vérifier l'état |

« Rien à faire » garde le code 2 (compatibilité) mais le message dit : « Rien à faire : aucune migration en attente, les N migration(s) de --expect sont déjà appliquées et terminées. Aucune écriture. » Nouveauté de cette livraison : l'ordre de `--expect` doit être l'ordre d'application (l'ancien code triait silencieusement), un doublon est refusé, une migration manquante est qualifiée « déjà appliquée » ou « absente du dossier ».

## 5. Repli par stade

| Stade | Situation | Repli | Perte | Vérifié |
|---|---|---|---|---|
| (a) avant migration | barrière posée, rien migré | lever la barrière : remettre l'ancien mot de passe de `neondb_owner` (une instruction), l'ancien runtime reprend en moins d'une seconde | aucune écriture n'a été acceptée pendant la barrière | exécuté (phase 7i : reprise après 25 à 65 ms) |
| (b) migration en échec en cours de lot | `db-migrate` code 3 : lot partiel appliqué, une migration inachevée | ne PAS relancer ni `migrate resolve` sans revue ; **restaurer le dump dans une AUTRE cible** (nouvelle base), contrôler l'empreinte, rebasculer la configuration vers cette cible ; la base en échec est conservée pour analyse | aucune (barrière toujours posée depuis le dump) | exécuté en local : `rehearse-xp-full` étapes `fail-migration`, `fail-bascule-resume`, `fallback-restore` (empreinte identique) |
| (c) après migration, avant réouverture | lot appliqué, `gn_runtime` toujours `NOLOGIN` | restaurer le dump dans une autre cible : aucune écriture n'a été acceptée depuis le snapshot grâce à la barrière | aucune | exécuté : phase 7ii, empreinte identique à la source |
| (d) APRÈS reprise des écritures | le nouveau runtime a écrit | **pas de restauration sans perte** (les écritures depuis la réouverture seraient perdues) : correction applicative uniquement (correctif, ou migration additive corrective) | restauration = perte de toutes les écritures depuis la réouverture | non rejoué : décision, pas procédure testée |

Limites : la restauration locale est `pg_dump -Fc` / `pg_restore --single-transaction` ; le temps et la fidélité d'une sauvegarde Neon (branche, snapshot, point dans le temps) ne sont pas prouvés. Le dump doit être pris **après** la barrière et son empreinte comparée à celle d'avant migration.

## 6. Reproduire

```bash
git fetch origin main && npm ci
XP_ROLES_PORT=55481 XP_ROLES_CONTAINER=gn-mB-roles-pg XP_ROLES_LABEL=mission-B node scripts/rehearse-xp-role-barrier.mjs
# 2 conteneurs postgres:16-alpine (cf. XP-REPETITION-COMPLETE.md), puis :
XP_FULL_CONTAINER_A=gn-mB-full-a XP_FULL_PORT_A=55483 XP_FULL_CONTAINER_B=gn-mB-full-b XP_FULL_PORT_B=55484 node scripts/rehearse-xp-full.mjs
```

À lancer seules, une à la fois, sans build en parallèle (sensibles à la charge). Le pooler et le réseau de la première dérivent désormais du nom du conteneur (`<conteneur>-bouncer`, `<conteneur>-net`) : deux répétitions avec des conteneurs différents ne se suppriment plus mutuellement.
