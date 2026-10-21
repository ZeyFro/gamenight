# L7-10 — charte de fair-play par communauté

- Worktree `.codex-worktrees/charte-fair-play`, branche `feat/charte-fair-play`, rebasée sur `main` après fusion #261 (`8d1993b7715119a1d4e326b8cb7b96f8b00c7d08`).
- Deux sous-agents lecture seule : Aquinas a vérifié les chemins UI et les rôles communautaires ; Nietzsche a vérifié l’isolation, la migration et les tests. Aucun fichier touché par les agents.
- Champ nullable `Community.fairPlayCharter`, migration additive, page `/charte` lisible par les membres actifs et éditable par OWNER/ADMIN. L’identifiant de communauté vient toujours du contexte serveur ; `updateMany` revalide membership, rôle et statut dans l’écriture atomique.
- Validations vérifiées : 5 tests charte (parseur + action), test Postgres d’isolation ajouté, 3 tests `migrations-additive`, ESLint ciblé, TypeScript, Next typegen, `prisma validate` avec URL locale factice et `git diff --check`.
- Non exécuté localement : le test Postgres d’isolation est ignoré faute de `TEST_DATABASE_URL`; il sera exécuté par la CI. CI GitHub et preview seront vérifiées après l’ouverture de la PR.
