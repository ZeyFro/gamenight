# Point de reprise unique — GameNight — 26 octobre 2026

Ce fichier remplace le point du 23 octobre. Reprendre dans un worktree dédié; préserver le checkout racine ancien et `.claude/worktrees/`. Ne pas déduire qu’un fichier local existe sur l’autre portable.

## Code et branches

- **#325** (`integ/xp-vocal-20261023`) : HEAD distant observé `ef22c8be14072840d85b8f05a83cf2e49206e000`, Draft ouvert, CI verte sur cette tête (run `40001112027`). `test:postgres` du run : 377 fichiers et 3 503 tests réussis; étape `npm test` : 290 fichiers passés, 98 ignorés, 2 340 tests passés, 1 248 ignorés. Build, typecheck, lint et statuts Vercel/Preview verts. **Historique** : `856a881` / run `39975590098` avait 377 fichiers/3 503 tests; ne pas attribuer ces preuves à une tête plus récente. #325 ne peut pas être fusionnée avant les préconditions DB ci-dessous.
- Travaux récupérés et conservés : test d’actions wishlist retrouvé non suivi dans `.claude/worktrees/agent-a528c0819d8080da0`; garde contre la course arrêt/démarrage du worker vocal, commit local `35f966f` dans le worktree dédié; correctifs indépendants publiés dans #326 et #327. Le travail de test wishlist et le commit worker sont dans le worktree `codex/resume-20261026`, HEAD local `35f966f` avant mise à jour documentaire.
- **#326** (`fix/cron-after-20261026`) tête publiée au dernier relevé `51b5fc42a381d45b980167dcdcaaa4ba0b959165`, PR ouverte. Le premier CI (run `40340616361`) a échoué : 3 tests dans `session-announce.integration.test.ts` et `tournament-announce.integration.test.ts` attendaient les anciens résultats synchrones ou appelaient `after()` hors contexte. Correction locale commitée `3be2582`, non encore poussée au relevé; tests ciblés Postgres vérifient maintenant le 202 et les lignes livrées. Vercel vert. `after()` borné par `maxDuration` n’est pas une file durable; l’inventaire cron externe et l’acceptation de 202 restent à établir.
- **#327** fusionnée en squash : commit main `b22f239ccd37b0c3621b79e361b2dd51d943528c`, après CI `40340642194` et Vercel verts sur la tête `cbe20ed465f6666fe590f78114e5c21a9c1f84a2`. Chrome headless temporaire, largeurs 320/390/768, self-check Windows et test service worker 10/10 réussis. Cela ne fournit hors ligne que `/offline.html`, pas les données privées.
- #291, #303, #319 et #324 ont leurs contenus dans #325, mais restent ouvertes jusqu’à intégration effective. Les branches `work/m-a`, `m-b`, `m-c`, `m-d`, `m-f`, `m-g` sont ancêtres de #325; `work/m-e` est absente des remotes. Une transcription Claude dit « jamais publiée ou seulement autre PC » : cela ne prouve pas que le travail n’a jamais existé. Les trois anciens worktrees Claude restent conservés sans modification; un contenait le test wishlist non suivi.

## Vérifications locales et limites

- Au SHA historique `856a881`, la répétition A2 a réussi 14 étapes et l’empreinte était conservée; la barrière A1 a empêché les écritures de l’ancien writer après établissement. Le test de schéma ancien vocal désactivé a réussi. Ce sont des preuves historiques, non une recette Production.
- La recette boutique n’est toujours pas expliquée : 4/4 puis 4/4 avant le changement de délai des transactions, puis 3/4 après; le passage isolé des achats historiques avait précédé le changement. Pas de nouveau run Postgres/navigateur le 26/10 : Docker Desktop est injoignable (pipe `dockerDesktopLinuxEngine`). Les tests unitaires récupérés du worker/wishlist font 26/26; ils ne remplacent pas la recette Postgres. Voir `LIVRAISON-XP.md` §6.
- Build/test ciblés et contrôle navigateur local ne consultent pas les profils personnels; Chrome headless avec profil temporaire a été utilisé. Ne pas redémarrer Docker au milieu d’autres projets.

## Production — relevé en lecture seule du 26 octobre

- Neon : projet `misty-tooth-45335023`, branche candidate `production` (`br-super-cell-b1ukvk08`), base `neondb`. Catalogue : 111 migrations terminées, aucune en échec/inachevée, aucune des six migrations de #325. Rôle applicatif observé : `neondb_owner`, propriétaire avec `BYPASSRLS`, création de rôle et login; pas de séparation runtime/migration.
- Les six migrations absentes sont `20261019190000_separate_xp_balance`, `20261020150000_session_voice_presence`, `20261022120000_voice_presence_consent_coordination`, `20261022130000_voice_presence_retention_gap_bounds`, `20261022140000_voice_presence_gap_history`, `20261022142500_shop_balance_purchase_reason`. Le code XP requiert `xpBalance`; flags OFF ne protègent pas d’un schéma absent.
- Clés Web Push : le fichier privé local `~/.gamenight-vapid.env` n’existe pas et les variables VAPID ne sont pas définies dans le processus. Les valeurs d’environnement Vercel ne sont pas accessibles (403); aucune clé distante n’a été lue, créée ou remplacée.
- GitHub Deployments montre la Production sur `c12728b172727353bf9b43057bdb594841383d61` le 22/10 à 19:13 UTC. **Le binding runtime Vercel → Neon n’est pas prouvé** : outil Vercel a répondu 403 pour l’équipe; ne pas répéter sans nouvel accès. Aucun secret lu. Pas de preuve de barrière Production, de restauration fraîche isolée ou de drainage des writers. Les crons cron-job.org ne sont pas inventoriés.
- Ne rien migrer/restaurer en Production, modifier les rôles/secrets, interrompre les writers, installer/activer le worker, activer les flags/crons, démarrer la collecte vocale ou envoyer des messages Discord réels sans autorisation distincte. Le vieux snapshot Neon du 20/10 n’est pas une sauvegarde fraîche.

## Suite autorisée

1. Pousser le correctif de tests `3be2582` sur #326 après comparaison immédiate avec la tête distante `51b5fc4`, sans force-push; attendre le CI unique sur le nouveau SHA.
2. #327 est déjà fusionnée en `b22f239`; ne pas relancer ses suites sans changement pertinent.
3. Actualiser et publier le checkpoint #325 (il précède encore la fusion #327) après vérification de sa tête distante; exécuter CI une fois sur le SHA final. Ne pas fusionner tant que les migrations et préconditions Production ne sont pas accomplies.
4. #291/#303/#319/#324 ne sont remplaçables qu’après fusion effective de #325; ne pas les fermer par avance.

## Préparation de mise en service — demande encore indéterminable côté binding

Cible candidate vérifiée dans Neon : projet `misty-tooth-45335023` / branche `br-super-cell-b1ukvk08` / base `neondb`; ce n’est pas encore une cible runtime prouvée. L’impact est l’application du lot de six migrations, dont ajout/backfill `xpBalance` et schéma vocal, avant déploiement de #325. Préconditions encore à produire : binding runtime, rôle runtime distinct et droits minimaux, inventaire/arrêt contrôlé des crons, barrière démontrée pour tous writers, sauvegarde fraîche restaurée dans une cible isolée, puis dry-run contrôlé. Repli : ne pas rouvrir si invariants échouent; isoler la copie pour diagnostic, jamais restaurer Production par-dessus des écritures réouvertes. Aucun SHA final de #325 ni fenêtre de changement n’est encore prêt; ne pas présenter une demande d’exécution vague.
