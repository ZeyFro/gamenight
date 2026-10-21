# Point de reprise unique — GameNight

Cette note est l’unique point de reprise courant. Les journaux et reprises datés sous `docs/archive/` sont historiques. Ce lot est publié dans [la PR #314](https://github.com/ZeyFro/gamenight/pull/314) ; son SHA et ses contrôles GitHub font foi pour l’état de publication et de fusion.

## Lot documentation et sécurité

Worktree isolé : `C:/Users/mparisot/AppData/Local/GameNight-Autopilot/.codex-worktrees/docs-security-reconciliation`, branche `codex/docs-security-reconciliation-20261021`. Base de départ : `origin/main` au SHA `15a9fcbafed5ab7b943b324ab99cdf0e5eed1d46` (#309).

Le lot met à jour le README, rassemble les guides sous `docs/INDEX.md`, documente le développement local et les routes sans supposer leur cadence, archive les journaux racine sans perdre leur contenu et réconcilie les constats de sécurité Claude dans `docs/SECURITE_CLAUDE.md`. Il ne change pas le comportement applicatif.

## Reprendre le travail

1. Vérifier `git status --short` dans ce worktree ; ne pas réutiliser le checkout principal ou `runtime/sondages`.
2. `git fetch origin main`, puis vérifier que la branche contient le `origin/main` courant avant toute publication ou intégration.
3. Relire le diff et contrôler les liens, références déplacées, commandes documentées, exemples sans secrets et `git diff --check`.
4. Demander une revue indépendante ; ne fusionner qu’après succès des contrôles requis sur le SHA exact de la PR.

## Limites

Aucune migration, restauration Neon, activation distante, configuration de Production, suppression de branche ou notification Discord. Ne pas relancer la suite PostgreSQL pour un déplacement documentaire. Toute vulnérabilité applicative confirmée se traite dans un lot séparé.
