# Phase 4 de #325 : intégration après #370 et #406 (préparation, rien n'est renommé)

Document de préparation du 6 novembre 2026. Il ne donne aucune autorisation : pas de renommage, de migration distante, de merge ni d'activation tant que le jalon n'est pas atteint. Complète `docs/XP-PROCEDURE-PRODUCTION.md` (fenêtre de bascule) et `docs/XP-MIGRATIONS-ROLLBACK.md` (retours arrière).

## 1. Jalon (condition de passage)

Les migrations de #325 ne sont renommées qu'après le message officiel du propriétaire : « #370 et #406 mergées et migrées, #325 peut passer en phase 4 », accompagné des preuves de fusion et d'application des migrations en Production. Règles : horodatage RÉEL du moment (jamais une date future), lot STRICTEMENT postérieur à toutes les autres migrations du dépôt, aucune migration d'une autre PR modifiée, aucun SQL du lot modifié.

État relevé le 6 novembre (tête de #325 : celle de la PR) :

| PR | Tête | Migration | Rôle pour #325 |
|---|---|---|---|
| `main` | `3c4f0be` | dernière : `20261029061000_tower_team_challenges` | base de #325 (déjà fusionnée dans la branche) |
| #370 | `6cff66b` | `20261104140000_tower_team_membership_policy` + runner `db-migrate` (option `--allow-shared-role`, garde chronologique) | jalon ; son runner remplace celui de #325 |
| #406 | `97353dc` (contient #370) | `20261105120000_tower_launch_channels_appeals_matchmaking` | jalon |
| #407 | `6ec348d` (empilée sur #370 + #406) | `20261106150000_tower_fixed_arbiter` | hors jalon, mais la plus récente : le lot doit passer derrière elle si elle est fusionnée avant #325 |
| #408, #416, #396, #417, #418 | — | aucune | pas de migration ; aucune lecture ni écriture d'XP dans leur diff |

Ordre d'application en Production : migrations de #370, #406 (puis #407 si fusionnée), puis le lot de #325. La garde chronologique du runner de #370 refuse toute migration en attente plus ancienne que la dernière appliquée : c'est pourquoi le renommage est obligatoire et vient en dernier.

## 2. Ce qui a été prouvé avant le jalon (simulation, worktrees jetables, bases `gamenight_sim_*`)

Fusion de #325 dans « future main A » (= #370 + #406) et « B » (= #407 tel que publié) :

| Contrôle | Résultat |
|---|---|
| Conflits textuels | 3 seulement, identiques en A et B : `scripts/db-migrate.mjs` et `scripts/db-migrate-lib.mjs` (add/add : adopter la version Tower, sur-ensemble ; exports identiques) et `src/lib/web-push-delivery.test.ts` (garder les deux `it`). `.env.example`, `CLAUDE.md`, `prisma/schema.prisma` fusionnent seuls |
| Refus chronologique AVANT renommage | code 2 : « Migration ancienne ajoutée hors ordre : …separate_xp_balance est en attente après la migration déjà appliquée …tower_launch_channels_appeals_matchmaking » (B : …`tower_fixed_arbiter`) ; `--execute` refuse aussi, sans écriture |
| APRÈS renommage | dry-run code 0 avec exactement 6 migrations ; `--execute` code 0 ; `xp-lot-invariants --phase=after` OK avec la même empreinte qu'avant ; `prod-precheck --state=post` conforme |
| Qualité (arbre A renommé) | `tsc` 0 erreur ; lint 0 erreur ; `prisma validate` valide ; `migrate diff` : 3 écarts dont aucun ne vient de #325 (2 de #406, 1 déjà sur `main`) ; #325 supprime même l'écart `CommunityGameEpitaph` ; `npm test` 342 fichiers / 2680 tests passés (sans base) |
| `test:postgres` complet (arbre A) | 444 fichiers sur 445 passés, 4008 tests passés, 4 ignorés. Le fichier en « échec » est `superlative-voting.integration.test.ts`, qui exige le nom de base `gamenight_test` (la simulation utilisait une autre base) ; sa copie pointant la base de simulation passe 4/4. Ne pas présenter ce run comme 445/445 |
| Retours arrière sur arbre renommé | `scripts/rehearse-xp-rollback.sh` : 9 contrôles OK en A et en B |
| Non simulé | `546f266` et suivants (statut « busy » de la boutique, outil de renommage final) en fusion ; `rehearse-xp-full.mjs`, `rehearse-xp-role-barrier.mjs`, `recette-boutique.mjs` ; rôles distincts ; `next build` ; Neon/Vercel/CI |

## 3. Correctifs de tests à faire à la fusion de `main` (références, patch non appliqué)

Fichiers de référence : `docs/xp-phase4/test-fixes-after-main-merge.patch` (contextes de l'arbre simulé : `git apply --3way` ou refaire à la main).

| # | Fichier | Correctif |
|---|---|---|
| T1 | `src/lib/db-migrate-lib.test.ts` (l.52-53), `src/lib/db-migrate-cli.integration.test.ts` (l.121), `scripts/rehearse-xp-full.mjs` (l.356) | le runner Tower dit « …même rôle que le runtime… » : remplacer l'attendu `autre rôle` |
| T2 | `src/lib/db-migrate-lib.test.ts` (l.16) | ajouter `allowSharedRole: false` à l'objet attendu de `readArgs` |
| T3 | `scripts/db-migrate-lib.test.mjs` (fichier de Tower) | sa fixture utilise le NOM ANCIEN du lot comme « migration plus ancienne » ; l'outil de renommage ne la réécrit plus (liste `FIXTURE_FILES`), aucune action requise ; si la fixture est un jour modifiée, ne pas lui donner le nouveau nom |
| T4 | `src/lib/web-push-delivery.test.ts` | garder les deux blocs `it` ; ajouter `afterEach(() => vi.unstubAllEnvs())` (le test Preview de Tower laisse `VERCEL_ENV` actif et fait échouer les `it` suivants) |
| T5 | `src/lib/notifications.web-push.test.ts` (de #406) | utiliser une vraie paire VAPID P-256 générée par `createECDH("prime256v1")` : la configuration stricte de #325 écarte les clés factices et `eligibleWebPushInputs` bloque alors tout envoi |

Point de coordination (non corrigé, fichier de #406) : `notifications.ts` appelle `webPushConfig` avant `sendUserWebPush` ; une configuration invalide est donc ignorée SANS le journal d'avertissement que #325 ajoute dans `sendUserWebPush`. Suggestion à transmettre : journaliser `webPushConfigIssue` quand le code n'est pas `disabled`.

## 4. Recette de la phase 4 (à exécuter seulement après le jalon)

```bash
# 0. Branche #325 propre, main (avec #370 et #406) à jour
git fetch origin && git status --short                 # vide
git merge --no-ff --no-commit origin/main
# 1. Conflits : ici « theirs » = main (version Tower) pour les deux fichiers du runner
git checkout --theirs scripts/db-migrate.mjs scripts/db-migrate-lib.mjs
#    web-push-delivery.test.ts : garder les deux blocs `it`
# 2. Correctifs de tests T1, T2, T4, T5 (section 3), puis :
git add -A && git commit -m "chore(merge): fusion de main (runner Tower, tests web-push)"
# 3. Renommage (arbre propre exigé) — dry-run d'abord, relire les 6 correspondances et les fichiers réécrits
node scripts/rename-xp-lot-migrations.mjs
node scripts/rename-xp-lot-migrations.mjs --apply
git add -A && git commit -m "chore(xp): renommer les 6 migrations du lot avec l'horodatage réel"
# 4. Garde et tests ciblés
node scripts/check-xp-rollout-migration-gate.mjs
npx vitest run src/lib/xp-rollout-gate.test.ts src/lib/xp-lot-rename.test.ts src/lib/xp-counter-writers.test.ts scripts/db-migrate-lib.test.mjs src/lib/db-migrate-lib.test.ts src/lib/db-migrate-shared-role.test.ts
# 5. Qualité
npx prisma generate && npx next typegen && npx tsc --noEmit && npm run lint
DATABASE_URL=<factice> npx prisma validate
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <base shadow jetable>
npm test && npm run test:postgres        # base locale RECRÉÉE (voir section 6)
# 6. Retours arrière sur l'arbre renommé
PGPORT=<port> scripts/rehearse-xp-rollback.sh <base modèle = main sans le lot>
# 7. Un seul push, CI verte sur le SHA exact, puis procédure Production : docs/XP-PROCEDURE-PRODUCTION.md
```

Si une autre migration plus récente que le lot arrive avant le merge de #325 : relancer `node scripts/rename-xp-lot-migrations.mjs --apply` (re-renommage automatique avec l'horodatage du moment, table consignée en §9 bis de `LIVRAISON-XP.md`) puis les points 4 à 6. La garde `xp-lot-rename.test.ts` échoue tant que le lot n'est pas strictement postérieur à toutes les autres migrations (drapeau `XP_LOT_RENAMED` à `true`) ; avant le renommage elle exige l'état inverse (lot encore plus ancien). Elle disparaît avec `scripts/xp-rollout-migration-gate.mjs` après le merge de #325 (des migrations plus récentes seront alors légitimes).

Bases locales ou de recette où un ancien nom a été appliqué (dont `gamenight_test` sur cette machine) : à recréer, `prisma migrate deploy` tenterait de rejouer le lot sur des objets existants. Sans accord séparé, ne jamais réécrire `_prisma_migrations`.

## 5. Risques de double attribution, perte d'XP, régression des récompenses, corruption

| Risque | Analyse (vérifiée dans le code) | Couverture |
|---|---|---|
| Écrivain de `xpTotal` sans `xpBalance` (gain ou pénalité sur un seul compteur) | 7 sites d'écriture applicatifs : `awardXp`, pénalité d'absence, paris, correction admin, reset de saison, `backfill-xp`, `backfill-badges` : tous écrivent les deux compteurs ; la boutique est la seule exception voulue (débit de `xpBalance` seul). Aucun diff de #370, #406, #407, #408, #416, #417, #418, #396 ne lit ni n'écrit l'XP | NOUVEAU `src/lib/xp-counter-writers.test.ts` : échoue si un `data: { … }` d'`src/` écrit un seul compteur (hors boutique) ou si du SQL brut applicatif écrit l'un d'eux |
| Double attribution | Le crédit et la mise à jour des deux compteurs sont dans une seule transaction sous verrou de ligne ; l'unicité `(communityId, userId, reason, sourceId)` du ledger rend le rejeu inoffensif ; les backfills passent par les mêmes clés | `xp-counters.integration.test.ts` (8), `xp-actions` / `backfill` existants |
| Achat concurrent / solde négatif | verrou Membership puis ligne de stats, CHECK `xpBalance >= 0`, unicité du cosmétique ; délai de verrou 8 s rendu en statut « busy » (rien débité) | `xp-shop.integration.test.ts`, `xp-shop-lock.integration.test.ts` |
| Perte d'XP dans la fenêtre migration → déploiement | l'ancien code n'écrit que `xpTotal` ; recalage `xp-balance-reconcile.mjs` (dry-run par défaut, idempotent, jamais d'écriture sur `xpTotal`) | `xp-balance-reconcile.integration.test.ts` (12) |
| Classements et récapitulatifs faussés par les achats | `SHOP_BALANCE_PURCHASE` (montant négatif) est exclu du classement par période, du récapitulatif mensuel et du graphique de profil | tests existants de `scoreboard`, `monthly-recap` |
| Régression des récompenses Tower | les récompenses Tower n'attribuent pas d'XP (aucun `awardXp` dans `tower-challenges.ts`) ; la capitaine « inactive » de #370 se fonde sur `streakLastActiveAt`, pas sur le ledger XP : aucune interaction avec `SHOP_BALANCE_PURCHASE` | lecture du code, `xp-counter-writers.test.ts` si un futur lot ajoute de l'XP |
| Reset de saison | remet `xpTotal` ET `xpBalance` à 0 (comportement existant, couvert par les tests des compteurs) : le solde dépensable est donc remis à zéro avec la progression. À confirmer comme voulu par le propriétaire | `xp-counters.integration.test.ts` |
| Corruption de données par la migration 1 | `UPDATE xpBalance = xpTotal` sur toutes les lignes, CHECK posé ensuite : un `xpTotal` négatif ferait échouer la migration (annulée par la transaction) ; précontrôle `--phase=before` le refuse ; 14 lignes en Production (comptage du propriétaire), ~50 ms | `xp-lot-invariants.integration.test.ts`, `xp-balance-migration.integration.test.ts` |
| Données vocales | collecte bornée à 12 h, durées réservées au créateur et aux admins invités, rétention active même drapeau éteint | `voice-presence-hardening.integration.test.ts` et suites vocales |

## 6. Prérequis restants (hors #325)

1. Message officiel du propriétaire (section 1) avec preuves de fusion et d'application de #370 et #406 en Production.
2. Accord distinct pour chaque migration du lot, snapshot Neon frais et restauration de test (D3), fenêtre de maintenance (barrière hors rôle, option B), `--allow-shared-role` accepté.
3. Production : liaison Vercel → Neon prouvée, rôles, comptage `CommunityMemberStats` (14 lignes, fourni), `xpTotal >= 0` (précontrôle).
4. Décisions produit en attente : reset de saison (solde remis à zéro ?), format des décisions vocales (confirmé), `--include-mixed` (désactivé par défaut, confirmé).
