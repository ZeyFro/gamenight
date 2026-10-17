# État de reprise — 17 octobre 2026

## Point de contrôle à reprendre en premier

- Travailler dans `C:\Users\mpmax\gamenight\.codex-worktrees\feature-wave`, branche `feat/roadmap-product-basics`; le checkout racine est un autre worktree. Base locale `origin/main` : `e376459d8d37756282af773aa99552c83ff18f0e`. Vérifier le SHA distant avec `git ls-remote origin refs/heads/main` avant toute publication/intégration; aucun force-push.
- La branche `feat/roadmap-product-basics` regroupe les commits `430947b` (Web Push), `2df96df` (offres gratuites), `74de892` (alertes Steam), `e1362ff` (plans indicatifs), `8a48888` (présence/XP), `e3a6a97` (petites annonces), `69fd189` (quiz), `08bf6c4` (worker PWA/Push unifié), `3b9a0c6` (galerie) et `51004b8` (accès galerie scopé). Elle est publiée dans la PR #276; vérifier son SHA distant avant toute nouvelle mise à jour et ne jamais force-push.
- Postgres de test dédié : conteneur `gamenight-reprise-268-pg`, base `gamenight_test`, port `55439`. Il est isolé des conteneurs des autres projets. Les sept migrations du lot ont été appliquées. `prisma validate`, 157 tests ciblés (24 suites), ESLint ciblé, `next build` et `git diff --check` passent sur la tête locale; le build comprend le typecheck. Aucun test d'intégration PostgreSQL n'a été lancé pour ce lot. Ne pas lancer des suites DB en parallèle.
- #273 reste seule PR ouverte : `verify` vert sur `58ea42e`, Vercel échoue avec `build-rate-limit`/quota 24 h et la PR est `DIRTY`. Une résolution locale existe dans `.codex-worktrees/session-chronicles`, branche `feat/session-chronicles-next`, merge commit `5259d42`; tests ciblés, TSC, lint, Prisma et build passent. Ne pas pousser/fusionner avant expiration du quota et nouveaux contrôles; aucun redéploiement manuel ni contournement.
- PR #276 : contrôles GitHub/Vercel à consulter sur le SHA courant. Ne pas fusionner si un contrôle requis est en attente ou en échec; ne pas relancer manuellement un déploiement.
- Pas de paire VAPID trouvée dans les noms de secrets locaux/GitHub consultables; la lecture des variables Vercel a répondu 403 (`mpmaximeparisot-6230s-projects`). Aucune clé créée/affichée. Web Push doit rester désactivé jusqu'à vérification privée de la paire et configuration admin. Plugins réellement utilisés : `gh`/GitHub pour PR/checks, Vercel pour constater le quota et l'accès env refusé; Context7 pour les docs Web Push. Pas d'appel de démonstration.
- Audit des éléments marqués terminés : musée/Hall of Shame, quiz « Devine le jeu », bibliothèque/wishlist et tournois ont de vrais parcours et tests ciblés. L7-05 a maintenant un quiz de quatre questions et garde l'édition manuelle. La PWA ne cache que `/offline.html`; l'app et les données privées ne sont pas disponibles hors ligne. Garder ce statut explicite.
- L5-02 est un MVP photos privées (4 Mo, 8/soirée, consentement, accès invités/organisateur réauthentifié); clips et purge distincte restent différés. Le Blob public de bannière n'est pas réutilisé. Le token privé `SESSION_MEDIA_BLOB_TOKEN` n'est pas configuré/vérifiable à cause du 403 Vercel, donc uploads et lectures restent fermés sans lui.
- Le commit local historique `de7f37524323aecc3e2f2f277995b66ba2b8e5bc` sur `fix/reprise-268` est conservé; son bilan #268 figure dans l'historique ci-dessous. Le commit `05c88bc` est déjà intégré à `origin/main` via #275.

## Historique de reprise

## L6-12 — état local du 17 octobre

- Branche `feat/free-games-l6-12` créée sur `origin/main` `e376459d8d37756282af773aa99552c83ff18f0e`. Sources vérifiées : [page Epic Games Store FR des jeux gratuits](https://store.epicgames.com/fr/free-games) et [documentation officielle Steam Web API](https://partner.steamgames.com/doc/webapi_overview), [IStoreService](https://partner.steamgames.com/doc/webapi/IStoreService). Epic expose une page de boutique, sans flux de données public documenté trouvé; IStoreService exige une clé et ne documente pas un flux giveaway public. La [recherche Steam gratuite](https://store.steampowered.com/search/?maxprice=free) est une page de boutique, pas une API giveaway prise en charge. Aucun scraping ni endpoint non documenté ajouté.
- Périmètre sûr : curation manuelle d'offres réellement gratuites, lien officiel français, dates de début/fin, affichage in-app aux membres actifs de la communauté. Désactivé par défaut et configurable par admin. Pas de Discord, cron, collecte automatique ni service payant. Le rythme quotidien n'est donc pas automatisé/configurable par tâche; il nécessite une source officielle stable avant une suite.
- Migration additive `20261017110000_free_game_offers`. Validations locales : `prisma validate`, génération Prisma, 64 tests unitaires/scoping ciblés, ESLint ciblé, `tsc --noEmit`, `git diff --check` passés. Aucun test d'intégration/Postgres exécuté et migration non appliquée, pour laisser le run unique du parent sur le port 55439 intact. Commit local seulement jusqu'à intégration/publication coordonnée; relire le SHA de `origin/main` avant toute publication.

## Reprise du 17 octobre — L7-11

- Branche locale `feat/player-classifieds-l7-11`, issue de `origin/main` `e376459d8d37756282af773aa99552c83ff18f0e`. MVP des petites annonces : jeu + message de 240 caractères, membres actifs de la communauté, expiration logique après 24 h, suppression auteur/admin. Désactivé par défaut par communauté et configurable dans `/admin?tab=communautes` (garde existante `COMMUNITY_ADMIN_ENABLED`). Aucun message externe ni purge automatique.
- Migration additive `20261017102000_player_classifieds`. 64 tests unitaires/statique ciblés, ESLint des fichiers touchés, `prisma validate`, génération Prisma et `tsc --noEmit` réussissent. Intégration/Postgres et application de migration non lancées : le run unique sur le Postgres dédié 55439 est utilisé par un autre worker. Les lignes expirées sont masquées mais non purgées automatiquement. Branche et commit restent locaux jusqu'à publication dans une PR utile ; reprendre avec `git worktree list`, vérifier `origin/main` et le SHA distant avant tout push.

## Mission globale — reprise continue sur le deuxième portable

- État après la validation de #267 : fusionnée au commit `a53a0bc` le 16 octobre à 20:30:02 UTC, CI [38961360176](https://github.com/ZeyFro/gamenight/actions/runs/38961360176) et Vercel verts. L6-03 publié en Draft [#269](https://github.com/ZeyFro/gamenight/pull/269), SHA `ba94678` ; contrôles du SHA final requis avant fusion.
- #233 réconciliée avec ce main, puis vérifiée par 33 tests de porte et 18 self-checks PowerShell simulés, sans vrai appel réseau ni fusion. Verrouillage des contrôles verify/Vercel, comparaison SHA tête/base, nouvelle lecture finale des checks, protection du travail local, rejet des nouvelles migrations hors revue explicite, rejet d'un SHA de fusion absent avant contrôle du déploiement. Ces validations ne valent pas la CI du prochain SHA poussé. PowerShell 5.1 n'a pas été exécuté (politique locale), sans contournement.

- Autorisation actuelle : poursuivre tous les lots exécutables, publier les PR et fusionner après contrôles verts, sans s'arrêter après une PR. Aucun arrêt de la session du premier portable supposé. Relire les SHA distants avant chaque push et fusion ; push normal uniquement, fusion avec `--match-head-commit`.
- #267 fusionnée le 16 octobre à 20:30:02 UTC, commit `a53a0bc3a3af0dcb2350c1735edd13a173659d91`, après CI [38961360176](https://github.com/ZeyFro/gamenight/actions/runs/38961360176) et Vercel verts au SHA `a7456b1`. Migration additive du guide appliquée au Postgres dédié ; 54 tests ciblés, typegen, TypeScript, lint complet et diff --check locaux réussis. Ancien quota résolu via le déploiement automatique du push utile, sans relance ni contournement.
- #233 : ancienne PR d'automatisation en conflit avec main ; revue et correction des gardes de contrôles/SHA/préservation en cours dans `.codex-worktrees/reprise-233`. Les anciens checks verts ne valident pas cette nouvelle intégration. Ne jamais lancer le script réel pour le tester.
- Inventaire : les statuts de L5-05, L6-01/02/08 et L7 déjà livrés sont réconciliés avec leurs PR fusionnées. L6-04 reste partiel : #251 affiche les trophées, sans Hall of Shame ni médias/descriptions éditables.
- L6-03 pris en charge dans `.codex-worktrees/reprise-268`, branche `feat/tournament-predictions-next` : pronostics de tournoi et de match, gardes communautaires, aucun nouveau montant d'XP. Ne pas lancer une seconde implémentation de ce lot.
- L6-03 : commit d'implémentation `ca01453`, puis intégration de main après #267. Six intégrations Postgres réussies (droits/isolation/immutabilité et courses lancement/résultat), 79 tests ciblés puis 62 gardes réussis, TypeScript et lint ciblé réussis. Modèle additif, flag `TOURNAMENT_PREDICTIONS_ENABLED` OFF ; pas de mise ni gain XP. CI et Vercel du SHA publié restent requis avant fusion.
- L6-04 musée en cours dans `.codex-worktrees/reprise-267` (`feat/community-highlights-next`) ; L6-05 expressions dans `.codex-worktrees/community-expressions` ; L6-06 chroniques dans `.codex-worktrees/session-chronicles`. Chaque lot a son propre worktree et ses dépendances ; sérialiser les intégrations Postgres.
- Postgres dédié commun aux worktrees : `gamenight-reprise-268-pg`, `127.0.0.1:55439`. Tests d'intégration strictement en série ; aucun changement aux conteneurs des autres projets. Les validations de #267 ont priorité sur les migrations/tests de L6-03.
- Blocages humains existants conservés : limites des uploads (L5-02), économie XP de présence (L5-04), règles d'achat groupé (L6-11), clés VAPID (L6-13), format de recherche de joueurs (L7-11), validation des messages Discord réels (L7-17). Aucun secret fabriqué, aucune notification réelle pour les tests.

## Deuxième portable — reprise de #268 (16 octobre 2026)

- Autorisation explicite : branches/PR et fusion après validation des contrôles requis. La session du premier portable peut toujours être active ; aucun arrêt déduit de ce diagnostic.
- Checkout principal `C:/Users/mpmax/gamenight` laissé sur main `6b26425`. Travail isolé dans `.codex-worktrees/reprise-268`, branche locale `fix/reprise-268`, créée au SHA distant de #268 `7d6e0311d174c43f5f1a6326bc573e6c9c0b1507`. Répertoire exclu localement via `.git/info/exclude`.
- Avant chaque push, comparer `git ls-remote origin refs/heads/feat/tournament-match-announcements` au dernier SHA observé. En cas de changement, récupérer et réconcilier les commits avant de recommencer les contrôles ; jamais de force-push.
- `npm ci` réussi avec Node 24.20.0 / npm 11.19.0, génération Prisma réussie. L'installation signale neuf vulnérabilités élevées dans les dépendances existantes ; aucun correctif automatique ni changement de dépendance effectué.
- Docker 29.8.2 / Compose 5.6.0 disponibles. Nouveau conteneur dédié `gamenight-reprise-268-pg` (`postgres:16-alpine`), port `127.0.0.1:55439`, base `gamenight_test`, identifiants de test `postgres` / `test`. Les autres conteneurs, dont l'ancien `gamenight-test-pg` arrêté, restent intacts. Les 93 migrations existantes sont appliquées sur cette base locale uniquement.
- Tests : fournir `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test` dans le processus PowerShell, puis `npm.cmd run test:postgres` (série obligatoire). Pour migrer ce conteneur uniquement, fournir la même URL sous `DATABASE_URL` et lancer `npx.cmd --no-install prisma migrate deploy`. Aucun fichier `.env` créé ou lu.
- CI initiale [38938641094](https://github.com/ZeyFro/gamenight/actions/runs/38938641094) : quatre échecs, 2 748 réussites. Reproduction locale avant correction : exactement quatre échecs et 67 réussites sur `community-scope.test.ts` et `tournament-announce.integration.test.ts`.
- Causes démontrées : nouvel accès direct `prisma.tournamentMatch` refusé par la garde ; deux anciennes simulations de clôture ignorent les trois nouvelles annonces de match ; fixture de deux joueurs dans un bracket de quatre ciblant un bye déjà terminé.
- Correction : réutiliser les matchs du tournoi chargé avec les noms des joueurs, sans étendre les exceptions d'isolation ; fixture à quatre joueurs et scores adaptés au tirage ; vérifier cinq livraisons après clôture et huit au total, sans imposer leur ordre. Relecture indépendante statique : aucun blocage identifié, aucun test exécuté par le relecteur.
- **Blocage Vercel : quota `api-deployments-free-per-day` dépassé** sur #267 et #268. Le commentaire Vercel demande d'attendre 24 heures. Aucune relance manuelle, aucun contournement et aucune fusion tant que le contrôle Vercel du SHA final n'est pas vert ; la CI GitHub doit également être verte. Une ancienne Preview verte ne valide pas le SHA final.
- Outils réellement testés ici : Git, gh authentifié, Node/npm, Docker et MCP GitHub (lecture du dépôt). Le skill `gamenight-tool-routing` du premier portable est absent ici ; Playwright et claude-mem ne sont pas exposés dans cette session. `.claude/commands/next-item.md` référence `docs/ROADMAP-claude-code.md`, absent : ne pas supposer ces instructions accessibles.
- Validation après correction : 71/71 tests ciblés réussis, aucun ignoré ; `next typegen`, TypeScript `--noEmit`, lint complet, `git diff --check` et `npx next build` réussis. Suite complète `npm run test:postgres` lancée sur le conteneur dédié ; résultat encore en attente au checkpoint de publication, ne pas le présenter comme réussi. La CI du nouveau SHA reste également à vérifier.

### Résultat final de #268 — 19:36 UTC

- Seul push de correction : `dcf74ad16532ed1cd51b3d0a4bba17a26302d887`, après comparaison du SHA distant avec `7d6e031`. Aucun changement concurrent observé, aucun force-push.
- [CI 38954746757](https://github.com/ZeyFro/gamenight/actions/runs/38954746757) réussie au SHA `dcf74ad` : 2 752 tests avec Postgres, aucun ignoré ; passe sans base : 1 751 réussis et 998 ignorés. Typage, lint et build réussis.
- Le contrôle Vercel du même SHA est devenu vert via le déploiement automatique de ce push. Blocage initial de quota résolu sans relance manuelle ni contournement. `Vercel Preview Comments` également vert.
- [#268 fusionnée](https://github.com/ZeyFro/gamenight/pull/268) le 16 octobre 2026 à 19:36:03 UTC, commit `27b6c2ac3d12f9bd7864641b2c7c57c99fe3b37d`, après nouvelle vérification des contrôles et du SHA (`--match-head-commit`). Bilan final publié dans la description de PR, sans déclencher de déploiement supplémentaire.
- Suite complète locale interrompue volontairement après réussite de la suite complète CI ; elle ne compte pas comme passée. Les 71 tests ciblés locaux et le build local restent validés. Aucun parcours Discord réel ni contrôle de production authentifié effectué.
- Worktree et conteneur local conservés pour la reprise ; checkout principal toujours inchangé. Ce complément final reste local pour rejoindre la prochaine publication utile, plutôt que déclencher un déploiement documentaire supplémentaire ; les résultats distants font foi dans la description de #268 et la CI liée.

## Bibliothèque et inventaire

- #234 fusionnée le 16 octobre à 08:56:06 UTC ; commit de fusion `5724728501d5ebdcf680702aa7a5056d14c37cf6`.
- HEAD validé : `2486f6d2d79410f5534473c61eeb3b203e79b0e6`. `gh pr checks 234 --repo ZeyFro/gamenight` : verify et Vercel réussis ; run [38782045315](https://github.com/ZeyFro/gamenight/actions/runs/38782045315), toutes étapes réussies, dont migrations et intégrations sur Postgres jetable.
- Relecture indépendante statique : aucun blocage concret identifié ; aucun test exécuté par le relecteur. Exécution locale : 4 tests réussis (page bibliothèque et filtres), `git diff --check` réussi.
- MCP Vercel : déploiement `FaDNGbFvmwABsdSBPFYFkpN6bSWp` READY au même HEAD. Accès protégé via MCP refusé 403 ; recours CLI réussi : `npx --yes vercel@latest curl https://gamenight-mk3efazk4-mpmaximeparisot-6230s-projects.vercel.app/bibliotheque/groupe --scope mpmaximeparisot-6230s-projects -- --head` : HTTP 200. Cela ne valide pas une session Discord ou le rendu mobile.
- Production après fusion : MCP Vercel confirme BXyhmxYg8bVDDTejBRLLhsmkYeje READY, target production, SHA de fusion 5724728, alias gamenight-sigma.vercel.app.
- Checkout principal Claude préservé, notamment `.gitignore`, fichiers `.claude/` et documents non suivis. Travail dans `.codex-worktrees/resume-234`.

## Carnet et préparation

Inventaire indépendant : #235 identifiants, #236 matériel, #237 préférences/refus, #238 avertissements/langues et #239 prix/téléchargement couvrent L3-01 à L3-05. Contrôles individuels verts constatés le 16 octobre ; leurs assemblages ne sont pas encore validés. Réconcilier chaque branche avec main avant intégration, particulièrement profil, schéma Prisma et roadmap.

#235 : intégration locale de `origin/main` après #234 sans conflit. Prisma generate, 23 tests ciblés (identifiants et gardes), Next typegen et TypeScript réussis. Lint et git diff --check réussis ; CI du nouveau SHA requise avant fusion. Tests et migrations Postgres seront exécutés en CI sur service jetable, sans accès Neon.

Prochain développement indépendant : L3-06 checklist de préparation, puis L3-07 temps de préparation. Sous-agent affecté à L3-06 dans un worktree distinct, sans mutation distante.

## Skill et outils

Skill installé dans `C:/Users/mparisot/.codex/skills/gamenight-tool-routing`. Validateur officiel via environnement temporaire `uv run --python 3.13 --with pyyaml python C:/Users/mparisot/.codex/skills/.system/skill-creator/scripts/quick_validate.py C:/Users/mparisot/.codex/skills/gamenight-tool-routing` : réussi. Python 3.15/PyYAML échouait faute de compilateur C++ ; recours Python 3.13 avec roue binaire réussi, sans dépendance du projet ajoutée.

Outils employés : Git/gh, skill-creator, Ponytail, skills Vercel deployments-cicd et accès protégé ; MCP Vercel pour lecture de déploiement, CLI pour accès HTTP ; sous-agents de revue/inventaire et implémentation isolée. Pas d'hypothèse sur la disponibilité des outils Claude.

## Résultats à 09:10 UTC

- #235 fusionnée à 09:08:04 UTC, commit `bce0c833524496982b11fc03eeafa59fca0307d6`.
- Son HEAD `db93b1073260538f5ac0cc4769e857eb598105dd` a réussi tous les contrôles, notamment [CI 38877363484](https://github.com/ZeyFro/gamenight/actions/runs/38877363484). Suite locale complète : 1 569 réussis, 946 ignorés faute de Postgres ; intégrations validées en CI ensuite. Preview `8hBjrBnFnNnLSbH9nvyiiihgVbb7` READY et HTTP 200 sur les paramètres. Contrôle Vercel de production réussi au commit de fusion ; parcours Discord authentifié/mobile non vérifié.
- #236 : conflits des paramètres et de la fiche pote résolus en conservant identifiants ET matériel ; fixture de rendu complétée avec les nouveaux champs facultatifs. Main fusionné, guide complété. 39 tests ciblés réussis, lint et diff --check réussis. CI du nouveau SHA à attendre avant fusion ; pas de Postgres local ni de build local sur cette intégration.
- [#240](https://github.com/ZeyFro/gamenight/pull/240) publiée en Draft pour L3-06 : 95 tests unitaires/gardes au développement, puis après intégration de main 24 tests ciblés réussis / 10 Postgres ignorés. CI et preview en cours, aucun résultat anticipé. Dépendances isolées, sans jonction vers le checkout Claude.
- L7-12 glossaire débutants en préparation dans un worktree séparé. Les autres lots restent à développer ; aucune affirmation d'achèvement global.

## Reprise préférences #237 — 16 octobre 2026

Worktree dédié `.codex-worktrees/preferences-237`, branche `feat/reprise-preferences-237`, départ `290bdf6`. Fusion de `feat/reprise-materiel-236` au SHA `04150c1` (inclut main après #235). Conflits résolus dans roadmap, schéma User et paramètres en conservant identifiants, matériel et préférences/refus. Guide enrichi ; #234/#235 faits, #236–240 ouverts au contrôle GitHub. Aucune intervention sur #238.

`npm ci` et génération Prisma dans les dépendances propres au worktree réussis. Validation ciblée : 182/182 tests dans 21 fichiers, aucun ignoré (UI, actions, suggestions, régressions et gardes isolation/exports serveur). Next typegen, TypeScript `--noEmit`, lint complet et `git diff --check` réussis. Relecture React : composants serveur et trois formulaires/actions indépendants conservés. Aucun test Postgres, build ou parcours navigateur exécuté ; CI sur le prochain SHA publié requise. Aucun push ni mutation distante.

## Reprise de la boucle #233 — 16 octobre 2026

Intégration de `origin/main` (`27b6c2a`) dans le worktree dédié `reprise-233` ; conflit de feuille de route résolu en gardant les statuts courants de main. La boucle exige désormais `verify` ET `Vercel` explicitement réussis ; absence ou contrôle ignoré ne vaut pas succès. Vercel rouge est consigné sans `/fix-ci`, nouvelle PR de statut ou relance automatique. Fusion liée au SHA par `--match-head-commit`, réévaluation de la porte si tête/base changent pendant sa lecture, refus d'une liste de fichiers incomplète. Les commandes vérifient le SHA distant avant push ; aucune suppression automatique du travail local. Le contrôle de production ne réutilise plus un ancien statut vert derrière un statut plus récent en attente.

Porte migration : renommage hors du dossier migrations refusé, ainsi que `CREATE TABLE IF NOT EXISTS` (pouvait faire passer des contraintes sur une table déjà existante) et `CREATE TABLE AS`. Cette liste blanche syntaxique n'est pas une analyse sémantique PostgreSQL : toute nouvelle migration est donc exclue de l'auto-fusion et exige une revue explicite. Le filtre SQL reste un diagnostic, jamais une autorisation de déployer.

Vérifications : 33 tests ciblés de porte réussis ; `scripts/roadmap-selfcheck.ps1` : 10 contrôles mockés réussis, aucun réseau, aucune fusion réelle. Script parsé sous Windows PowerShell. Aucun lancement de la boucle, aucune notification Discord, aucun Postgres ni déploiement déclenché pour cette reprise. Dépendances de test réutilisées depuis le worktree #268, sans installation.

## Reprise globale — 17 octobre 2026

- #267, #268, #233, #270, #271 et #272 sont fusionnées. #269 a passé `verify`, Vercel et Preview Comments sur le head corrigé `9829ec2`, puis a été fusionnée au commit `f95b027`.
- #274 Sondages est fusionnée au commit `a58a491` après résolution du conflit avec #269. Son head `483f223` a passé `verify`, Vercel et Preview Comments; validation locale de la combinaison : 46 tests PostgreSQL ciblés, Prisma, TypeScript, ESLint et diff check.
- #273 Chroniques : `verify` passe sur `58ea42e`, Vercel échoue avec `Deployment rate limited — retry in 24 hours`. Aucun retry ni déploiement manuel; les tâches indépendantes continuent.
- L7-15 / #275 : notification de promotion conservée in-app, sans MP; tête `b1c1a7d` contient aussi la tolérance d'un événement Prisma tardif (cause CI prouvée sur 32 contre 31). Vérifications locales ciblées 12/12 et 23/23 PostgreSQL, TypeScript, ESLint ciblé et diff check réussis; `verify`, Vercel et Preview Comments sont verts sur cette tête. La branche réintègre maintenant `main` `a58a491`; ses anciens checks ne couvrent pas ce merge.
- `de7f37524323aecc3e2f2f277995b66ba2b8e5bc` reste conservé sur `fix/reprise-268`; son bilan historique #268 figure déjà dans ce fichier.
- L6-10 alertes de prix et L6-12 jeux gratuits attendent des choix produit (seuil, audience, région, cadence et source/éligibilité). L6-11 achat groupé, L6-13 Web Push (clés VAPID à fournir) et L5-02/L5-04 demandent aussi décisions ou secrets.
- Le Postgres `gamenight-reprise-268-pg` (`gamenight_test`, port 55439) est dédié à cette reprise; aucun conteneur d'un autre projet n'a été touché. Les contrôles Vercel restent requis; aucun déploiement manuel répété ni contournement.

### L6-11 — plan d'achat collectif indicatif

Worktree `.codex-worktrees/group-buying-plan`, branche `feat/group-buying-plan`, basé sur `origin/main` `e376459`. MVP: activation admin par communauté (off par défaut), date cible obligatoire et note facultative limitée à 300 caractères, modifiables par le proposant d'une entrée wishlist. Les votes « intéressé » restent le seul signal des membres; aucun engagement financier, paiement, achat automatique ni service externe. Migration additive `20261017130000_group_purchase_plans`. Contrôles locaux: 101 tests ciblés (incluant les gardes d'isolation), Prisma validate/generate, TypeScript, ESLint ciblé et diff check réussis. Aucun test PostgreSQL, push ou merge.
