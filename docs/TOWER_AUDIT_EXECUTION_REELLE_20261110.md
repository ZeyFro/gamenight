# Exécution indépendante GameNight — checkout réel main

**10 novembre 2026.** Tests exécutés dans un **Vercel Sandbox éphémère isolé**, sans identifiants Neon/Production, sur le checkout Git `6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7`. Environnement créé à la demande du propriétaire ; source récupérée depuis GitHub. État des tests sur SHA identique, distinct des CI anciennes des PR.

## 1. Matrice des exécutions effectives

| Contrôle | Environnement et résultat | Interprétation |
| --- | --- | --- |
| Git clone | `git rev-parse HEAD` = `6d6e30e`, `git status --short` vide | Checkout propre et réel ; l'échec DNS du conteneur initial a été contourné par **Sandbox**, pas en modifiant Production |
| Node / npm | Node `v24.22.1`, npm `11.19.1` | **Différent de la CI** (Node 22) ; prévoir validation de conformité |
| Installation | `npm ci --no-audit --no-fund` : exit 0 | Réussie |
| Prisma | `npx prisma generate` : exit 0 | Réussie |
| Next types | `npx next typegen` : exit 0 | Réussie |
| TypeScript | `npx tsc --noEmit` : exit 0 | Réussi |
| ESLint | `npm run lint` : exit 0, **0 erreur et 11 avertissements** | Réussi sans sévérité « zéro warning » |
| Tests sans DB | `npm test` : **314 fichiers pass, 93 skip ; 2 488 tests pass, 1 214 skip** sur 3 705 | Réussi ; les intégrations ne sont pas prouvées par cette commande |
| PostgreSQL isolé | PostgreSQL local **18.6**, base `gamenight_test` sur 127.0.0.1, 118 migrations du SHA | **118/118 migrations appliquées dans la base jetable** ; aucun accès Neon |
| Tests Postgres passe initiale | `npm run test:postgres` avec port 5432 : 404 fichiers pass / 3 fail ; 3 698 tests pass / 3 fail / 4 skipped | **ÉCHEC initial** : 1 suite exige explicitement le port 55439 ; 2 autres tests échoués |
| Retest ciblé, port 55439 | 2 fichiers pass / 1 fail ; **15 tests pass / 1 fail** | Deux échecs initiaux disparaissent après alignement du port ; reste test `community-teams.integration.test.ts` |
| Build | `npm run build` : exit 0 | **Réussi** |
| Dépendances de production | `npm audit --omit=dev --json` : **5 packages marqués high**, 0 critical | **Écarts à corriger** et CVE/advisories à qualifier ; ne pas exécuter auto-fix |
| Tests Postgres deuxième passe | **405 fichiers pass, 2 fail (407) ; 3 702 tests pass, 3 fail (3 705)** ; PostgreSQL 18, port exact 55439 ; durée 272,87 s | **NON VERT** : 1 assertion d'erreur Prisma et 2 scénarios de tournoi intermittents |

## 2. Échec isolé : PostgreSQL 18 vs CI PostgreSQL 16

`src/lib/community-teams.integration.test.ts` : test « prevents deleting a game from cascading into its community teams » attend l'erreur Prisma `P2003` en cas de suppression d'un jeu référencé par une équipe. PostgreSQL 18 renvoie **SQLSTATE 23001 (RESTRICT setting)**, que Prisma 6.19.3 expose en `PrismaClientUnknownRequestError`. Le test attend `P2003`, typiquement obtenu avec le code d'erreur 23503 sur PostgreSQL 16. **La règle de protection du jeu contre la suppression s'est bien déclenchée** ; ce résultat prouve la non-portabilité de l'assertion dans l'environnement PG18 mais **ne valide pas PG16 sur main**. Ne pas modifier silencieusement le code métier ni les migrations pour faire passer ce test sous PG18 ; reproduire sur la version PostgreSQL CI (16).

## 3. Audit dépendances — détails exacts

`npm audit --omit=dev` sur les dépendances réellement installées a signalé 5 noeuds de dépendances avec sévérité élevée :

| Package installé | Version installée | Source / recommandation |
| --- | --- | --- |
| `zod` direct | `4.5.4` | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), corriger via version patchée appropriée |
| `zod` transitif dans @vercel/cli-config | `4.1.11` | Même avis, remonter via chaîne @vercel/blob → @vercel/oidc → @vercel/cli-config |
| `undici` sous @vercel/blob | `6.29.0` | [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c), [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx), [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) ; tester version ≥ 6.29.1 selon avis |
| `@vercel/cli-config` | `0.2.4` | Propagation de `zod` |
| `@vercel/oidc` | `3.8.5` | Propagation de `@vercel/cli-config` |
| `@vercel/blob` | `2.8.0` | Dépendances transverses. L'audit propose une descente à `2.4.0` sous forme de correctif potentiellement cassant : **pas d'application sans revue de compatibilité** |

Les **5 alertes sont des noeuds de dépendances**, pas cinq vulnérabilités distinctes. La présence d'un avis dans la chaîne **ne prouve pas l'exploitabilité dans GameNight**. Risque P1 à qualifier en tenant compte des paths réellement exécutés et des patches compatibles. Aucun `npm audit fix` lancé.

## 4. Vérification HTTP anonyme du site public

URL de l'alias public `https://gamenight-zeyfro.vercel.app`, le 10/11 :

| Ressource GET | HTTP anonyme | Limite de la preuve |
| --- | ---: | --- |
| `/`, `/joueurs`, `/equipes`, `/tower`, `/sessions` | 200 | Pages servies ; pas de preuve de contenu/sens des permissions après connexion |
| `/api/igdb/search?q=minecraft` | 401 | L'API refuse l'anonyme |
| `/api/health` | 401 | Endpoint protégé |
| `/api/admin/tower-layout`, `/api/admin/tower-preflight` | 403 | Endpoints staff protégés |

**Ne pas confondre** avec les URLs Vercel de déploiement par SHA : celles-ci sont protégées par SSO et renvoient `302` vers Vercel ; `curl -L` renverrait faussement `200` sur la page de connexion. Aucun test mutateur HTTP.

## 5. Discord réel : limitation d'accès vérifiée

- Le jeton `DISCORD_BOT_TOKEN` est stocké en variable **sensitive** sur Vercel ; le connecteur Vercel ne donne pas sa valeur au contexte de cette session et le Vercel Sandbox jetable **n'hérite pas des secrets Production**. Aucun contournement ou impression du jeton n'a été effectué.
- Le script `scripts/audit-discord-readonly.mjs` sur branche documentaire a été récupéré dans le sandbox et **validé avec `node --check`**. Il ne réalise que des requêtes Discord `GET` et n'affiche ni noms privés ni membres.
- **Son exécution sur le vrai serveur n'a pas eu lieu**. Il faut un environnement *déjà autorisé* disposant du bot, ou une intégration Discord consentie, pour inventorier réellement rôles, overwrites, catégories et salons. L'audit effectif des permissions d'un membre nécessite en outre des **comptes tests distincts** ; le bot en lecture seule ne peut pas simuler un utilisateur Discord authentifié.
- Le guide d'exécution reste [TOWER_AUDIT_RECETTE_EXECUTION.md](TOWER_AUDIT_RECETTE_EXECUTION.md).

## 6. Ce qui ne peut PAS être clôturé sur ces seules preuves

- Audit manuel intégral de toutes les branches et chacune des 1 317 sources ;
- contrôle de sécurité exhaustif (incluant toutes les données personnelles, dépendances, points d'entrée) ;
- recette Discord sous comptes joueur/modérateur et tests vocaux privés ;
- 17 critères officiellement approuvés, cahier fusionné dans `main` ;
- lancement Production et migrations.

**Aucun code applicatif, secret Production, migration Neon ou rôle Discord n'a été modifié.** Les fichiers de compilation et tables de test ont été créés **uniquement dans le sandbox jetable**, pas dans le dépôt ou en Production.


## 7. Exécution PostgreSQL : bilan consolidé des deux passages et retests

- **Première suite complète** avec PostgreSQL 18 sur le port 5432 : 404 fichiers réussis, 3 échecs ; 3 698 tests réussis, 3 échoués, 4 ignorés, un fichier entier en erreur de préparation car il impose précisément `127.0.0.1:55439/gamenight_test`. Ne pas comparer le total du premier passage à celui du second sans compter la suite non exécutée.
- **Après alignement du port à 55439**, retest ciblé des trois fichiers `superlative-voting.integration.test.ts`, `community-teams.integration.test.ts` et `force-relogin.surfaces.integration.test.ts` : **15 réussis / 1 échoué** (2 fichiers réussis, 1 échoué).
- **Deuxième suite complète** au port correct : **405 fichiers réussis / 2 échoués (407)** ; **3 702 réussis / 3 échoués (3 705)**, durée **272,87 secondes**. Les échecs sont :
  - `community-teams.integration.test.ts` (« prevents deleting a game from cascading into its community teams ») : violation de contrainte réellement rejetée, mais **SQLSTATE 23001** PostgreSQL 18 devient `PrismaClientUnknownRequestError` et ne satisfait pas l'assertion `P2003`.
  - `tournament-team-bracket.integration.test.ts` : 2 scénarios « fige les duos » et « résout le bye », résultats intermittents dans la suite.
- **Retest isolé** de `tournament-team-bracket.integration.test.ts` immédiatement après : **2/2 tests réussis**, en **839 ms**. Cela prouve que les échecs ne sont pas systématiques, pas leur cause. Investiguer dépendance à l'ordre des tests, dates, transactions, état global et PostgreSQL 18 ; ne pas qualifier une correction sans reproduction fiable.
- **Aucun échec de TypeScript/ESLint/build** ; ESLint produit **11 warnings**.
- **Comparaison CI de référence** : GitHub Actions du candidat #419 sur PostgreSQL **16** avec Node **22** : 3 771/3 771 tests réussis, mais c'est **un autre SHA**. Le présent checkout `main` sur Node **24** / PostgreSQL **18** n'a pas obtenu 100 %.

## 8. Patches disponibles au registre au moment de la vérification

- npm registry : `zod` dernière `4.6.7` (avis pour les versions antérieures à `4.6.6`) ; `undici` ligne 6 dernière `6.29.1` (avis jusqu'à `6.29.0`).
- `@vercel/blob` dernière `2.9.0`, mais sa dépendance déclarée `@vercel/oidc: ^3.6.1` **ne garantit pas à elle seule** un passage à une lignée corrigée ; `@vercel/oidc` dernière `4.0.8`, `@vercel/cli-config` dernière `0.3.8`.
- Évaluer une combinaison compatible **sur une branche séparée**, avec `npm audit --omit=dev`, tests et build, après revue du verrou npm ; ne pas lancer `npm audit fix` ou modifier `package-lock.json` sur `main` sans autorisation.

## 9. Preuve du script d'inventaire Discord

- `git fetch` de `docs/audit-cdc-tower-20261110` dans le Sandbox, `git show FETCH_HEAD:scripts/audit-discord-readonly.mjs` vers un fichier **temporaire hors checkout**, `node --check` : **SUCCÈS**.
- Aucun jeton Discord n'a été récupéré : variable Vercel sensitive masquée, Sandbox sans secrets Production. **Aucune interrogation directe des rôles ou des salons du vrai serveur**.


## 10. Recette navigateur ANONYME réelle (Playwright / Chromium), desktop et mobile

Exécutée dans le Sandbox contre l'alias public `https://gamenight-zeyfro.vercel.app`, **sans session utilisateur et sans identifiants Discord** :

- **10 navigations** : `/`, `/joueurs`, `/equipes`, `/tower`, `/sessions` à **360 × 800** et **1 366 × 800**.
- La page d'accueil se charge en HTTP 200, aucun débordement horizontal détecté et **0 erreur JavaScript de page** pendant ces navigations.
- Les quatre chemins privés (`/joueurs`, `/equipes`, `/tower`, `/sessions`) renvoient initialement HTTP 200, **mais le navigateur redirige ensuite le visiteur non authentifié vers `/`**. Les 200 HTTP seuls ne prouvent donc **pas** que ces pages sont consultables sans compte GameNight. Cela n'est pas nécessairement un défaut puisque l'accueil public Discord doit rester accessible sans connexion GameNight, mais les parcours GameNight restent authentifiés.
- Sur la page d'accueil, le bouton **« Se connecter avec Discord »** a été cliqué **sans saisir de compte ni mot de passe** : navigation observée vers **`https://discord.com/oauth2/authorize`**. Cela vérifie le début du parcours OAuth, **pas le callback, la création du profil ni les permissions après connexion**.
- Les liens visibles sur la page invitée sont limités, ce qui correspond à un affichage de connexion, pas à la navigation de la communauté Discord.

**Statut UX :** contrôle invité réel sur mobile/desktop **réalisé**, mais **recette d'utilisateurs authentifiés, équipes, modérateurs, preuves et votes non réalisée**. Aucun test sur la véritable interface Discord ; aucun envoi de message, création de salon ou défi.
