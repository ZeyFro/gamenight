# Revue indépendante F — auth #309 — 20 octobre 2026

Ce changement ferme les nouvelles connexions sans appartenance ACTIVE, synchronise systématiquement les serveurs OAuth et supprime le rattachement automatique à default. Revue du diff contre `origin/main`, de ses appelants et des règles `CLAUDE.md`, au SHA `f0a4ac676ee5ad03762bb82d33e7954fb32d0bcf`. La référence distante `refs/pull/309/head` était identique lors du dernier contrôle.

**Verdict : corriger le point 1 avant fusion selon les exigences de la mission.** Le comportement est documenté dans le dépôt ; son incompatibilité avec « B-only isolation OFF sans accès implicite à A » est confirmée, pas supposée.

## 1. P1 confirmé — admission B-only et accès collectif global quand l’isolation est OFF

- **Code :** `src/auth.ts:94` accepte une appartenance ACTIVE quelconque ou un admin de la liste d’environnement. `src/lib/community-isolation.ts:40` renvoie alors une portée `null`, `communityIdFilter(null)` ne filtre rien et `src/lib/community-access.ts:63` autorise les tournois sans lecture. Le chemin réel `/tournois` (`src/app/tournois/page.tsx:55`) utilise ce filtre. `src/lib/community-stats.ts:23` attribue en outre les écritures utilisateur à default sans vérifier l’appartenance ; `getCurrentUser` peut ainsi appeler `touchStreak` pour default (`src/lib/current-user.ts:33`).
- **Scénario :** A=default ACTIVE, B ACTIVE, utilisateur uniquement membre de B ; isolation et sélecteur OFF. OAuth l’admet, mais les tournois de A sont lisibles et les écritures de progression visent A. Aucun Membership A n’est nécessaire. Un admin plateforme sans aucun Membership suit le même chemin collectif ; son droit d’administration n’est donc pas séparé de l’accès collectif dans cette configuration. Les soirées privées conservent leur garde créateur/invité ; ce constat ne prétend pas que toutes leurs données deviennent publiques.
- **Preuve pure exécutée :** `node scripts/review-auth309-pure.cjs` charge les sources réelles `auth.ts`, `community-isolation.ts`, `community-scoped-client.ts` et `community-stats.ts`, transpilées en mémoire avec TypeScript existant. Seules les frontières OAuth/Prisma sont doublées : synchronisation renvoyant `[B]`, puis `[]` pour l’admin. Assertions réussies : connexion `true`, portée `null`, arguments Tournament dépourvus de filtre communautaire, communauté d’écriture `A-default`, zéro lecture Membership. Aucune requête HTTP/base. Les tests existants `community-access.isolation.test.ts:41` et `:74` confirment aussi explicitement les accès globaux OFF.
- **Options minimales à arbitrer :** (a) refuser B-only lorsque l’isolation est OFF, puis vérifier systématiquement l’appartenance default sur les chemins collectifs, y compris pour les admins et les JWT déjà ouverts ; (b) appliquer systématiquement le contrôle communautaire aux chemins collectifs tout en gardant l’exception d’authentification admin. Le refus OAuth seul ne corrige ni l’exception admin ni les anciennes sessions. Activer un drapeau dans un environnement serait une opération distincte, non réalisée ici.
- **Si ignoré :** un compte légitimement admis par B obtient un accès collectif à A. L’avertissement de déploiement sur l’isolation OFF ne satisfait pas le scénario demandé par la mission.

## Hypothèse séparée — course entre deux premières connexions

`src/auth.ts:90` lit l’existence avant l’upsert ; `:95` choisit ensuite le rollback à partir de cette lecture. Ordonnancement à vérifier : les deux transactions lisent un User absent ; la première confirme A puis commit ; la seconde, plus récente et avec un snapshot vide, retrouve le même User à l’upsert et passe A à LEFT, mais `existed=false` déclenche le rollback. A resterait alors ACTIVE malgré le départ confirmé. Ce cas ne serait pas couvert par le test de huit replays qui utilise un User préexistant.

**Pas encore confirmé sur PostgreSQL.** Le script reproductible `scripts/review-auth309-race.cjs` est prêt (`node --check` réussi). Il charge auth et synchronisation réelles, utilise uniquement `TEST_DATABASE_URL` vers `127.0.0.1/gamenight_*`, force cet ordonnancement entre deux transactions et attend LEFT. Fixtures uniques et nettoyage ciblé, aucun TRUNCATE ni HTTP. Exécution différée jusqu’au créneau attribué par le coordinateur ; aucun accès à la base partagée en parallèle. Le contrôle d’existence est retenu après sa lecture initiale pour laisser la première transaction committer ; le synchroniseur et les écritures sont réels, la réponse Discord est simulée.

## Comportements voulus et limites vérifiées

| Sujet | Conclusion et preuve |
| --- | --- |
| Ancien JWT / reconnexion forcée | S0 ne réévalue pas l’admission d’une session existante. C’est annoncé dans `docs/COMMUNITY_ROLLOUT.md:96`. `shouldForceRelogin` invalide les cookies anciens ou sans date après un déclenchement ; la connexion fraîche pose une nouvelle date. Tests JWT et force-relogin réussis. Aucune reconnexion globale réelle déclenchée. |
| REMOVED / LEFT / communauté suspendue | Les requêtes du synchroniseur ne réactivent que ACTIVE/LEFT et sélectionnent les communautés ACTIVE (`src/lib/community-oauth.ts:19`, `:28`). REMOVED reste exclu. Tests PostgreSQL présents mais non exécutés par F : lecture du code et des cas, pas une preuve PostgreSQL annoncée. |
| Erreurs Discord / portée absente / snapshot partiel | Refus ordinaire sans mutation ; exception admin sans synchronisation. Les tests S0, signIn, parsing paginé et Auth.js réel avec HTTP simulé passent ; les journaux de ces erreurs restent neutres et sans jeton. L’ancienne session n’est volontairement pas révoquée par une erreur de l’API. |
| Isolation ON / préférence étrangère | Les tests purs de filtres, client scopé, accès et sélecteur passent, dont l’exclusion des lignes historiques default pour B-only. Pas de validation navigateur ou base de toutes les surfaces dans cette revue ciblée. |
| Rôles initiaux | Nouveaux Memberships MEMBER par défaut ; les rôles déjà présents sont conservés par les updates. La promotion OWNER/ADMIN automatique du seed est supprimée ; promotion manuelle annoncée dans `docs/COMMUNITY_ROLLOUT.md:135`. Changement voulu documenté, pas défaut nouvellement imputé. |
| Concurrence usuelle | Verrou User, unicité `(communityId,userId)` et `skipDuplicates` présents. Tests PostgreSQL de replays et snapshot ancien relus, non rejoués ; voir l’hypothèse distincte sur le premier User. |

## Validation exécutée

```powershell
.\node_modules\.bin\vitest.cmd run src/auth.signin.fail-closed.test.ts src/auth.signin.test.ts src/auth.jwt.test.ts src/lib/discord-user-guilds.test.ts src/lib/default-community.test.ts src/lib/force-relogin.test.ts src/lib/admin-rules.test.ts src/lib/community-isolation.test.ts src/lib/community-access.isolation.test.ts src/lib/community-scoped-client.test.ts src/lib/session-access.isolation.test.ts
# 11 fichiers, 190 tests réussis
.\node_modules\.bin\vitest.cmd run src/auth.oauth.test.ts src/lib/community-picker.test.ts
# 2 fichiers, 36 tests réussis
node scripts/review-auth309-pure.cjs
node --check scripts/review-auth309-race.cjs
git diff --check
git ls-remote origin refs/pull/309/head
```

**226/226 tests réussis, 13 fichiers, aucun test sauté dans ces exécutions.** Le cas pur complémentaire ci-dessus réussit ses assertions de reproduction du défaut. Dépendances existantes accessibles par jonction locale au worktree ; aucune installation ni génération Prisma. Le diff est propre. Les checks CI/Vercel verts sont le contexte fourni par le coordinateur, pas une nouvelle validation distante F.

Revue C faite séparément pendant l’attente PostgreSQL : `15938df7a70f20c5aa2831a3568e253198b68629`, garde de cohérence boutique source/destination, aucun défaut trouvé. **44/44 tests indépendants dans cinq fichiers, zéro sauté** (`gamerpower-free-games`, `free-game-discord`, `free-game-offers`, `free-game-offers.access`, `community-announce`). Aucun fichier du worktree C modifié.

Revue E faite ensuite, séparément, sur son diff non commité à la base `3e0731b` : mutations expressions/cimetière réservées ADMIN/OWNER, ancien auteur MEMBER refusé, lecture membre conservée, rôle vérifié sous verrou Membership dans la transaction et portée communautaire explicite. Aucun défaut P0–P2 trouvé. **37/37 tests indépendants dans cinq fichiers, zéro sauté** (autorisation Lore, formulaires, deux actions, guide). Vrais verrous PostgreSQL non rejoués par F ; aucun fichier du worktree E modifié.

Plugins et skills utilisés : Ponytail review, Superpowers revue et verification-before-completion, règles `CLAUDE.md`, routage GameNight, claude-mem `work_state`. Graphify lu, reconstruction omise : aucun graphe local et revue ciblée sans installation ; task-observer consulté sans modification de skills. `/security-review` n’est pas disponible dans les outils de cette session. Aucun agent enfant.

Non vérifié : PostgreSQL, navigateur, build/suite complète, configuration effective, Production/Neon, notifications Discord réelles. Aucun merge, push, commentaire distant, changement de drapeau ni activation ; le point 1 reste un risque d’accès intercommunautaire confirmé.
