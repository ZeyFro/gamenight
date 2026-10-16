# L7-05 — profils de style et équipes équilibrées

- Worktree isolé : `.codex-worktrees/quiz-profils`, branche `feat/quiz-profils-equipes`.
- Base actuelle : `40ebcad5add63188de1242725f9031d2b8e50141` (commit de la PR dépendante #256, à rebaser sur `main` après fusion).
- Sous-agents lecture seule terminés : Goodall a vérifié le parcours roulette/profil ; Pauli a vérifié le schéma et le tirage d’équipes. Ils recommandent un profil à quatre axes par communauté, sans conserver de réponses individuelles.
- Implémentation locale : scores Tryharder/Ambianceur/Stratège/Chaos de 0 à 5 sur `/profil/parametres`, sauvegardés pour l’utilisateur authentifié et sa communauté active ; seuls les scores de la communauté courante sont chargés dans la roulette. `splitIntoTeams` conserve le tirage actuel sans profil et teste 128 répartitions aléatoires pour minimiser l’écart des quatre scores avec profils.
- Validations locales au contenu courant : `prisma validate`, `prisma generate`, `vitest run src/lib/team-draw.test.ts` (3/3), ESLint ciblé, `tsc --noEmit`, `next typegen` et `git diff --check` réussis.
- Aucun test Postgres local lancé ; la nouvelle migration sera exercée par CI.
- PR #256 est toujours en cours : le seul suivi actif est `gh run watch 38915136942 --repo ZeyFro/gamenight --interval 300 --compact --exit-status`. Attendre sa fin, vérifier une fois résultat + SHA de #256 + Vercel, puis fusionner seulement son SHA validé. Ensuite rebaser cette branche sur `origin/main`, refaire les validations affectées, pousser et ouvrir une PR brouillon L7-05.
- Ne pas fusionner L7-05 sans CI et Vercel verts sur son SHA de tête exact. Accès Vercel de déploiement de production indisponible dans la session précédente (MCP 403, CLI absente) ; preview PR à vérifier via les checks GitHub.
