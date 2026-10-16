# L7-12 — glossaire débutants

- Worktree Codex `.codex-worktrees/glossaire-debutants-next`, branche `feat/glossaire-debutants-next`, rebasé sur `main` après #262 (`a29413cf4e6c94db0b01becd755cec550357914a`).
- Le worktree préexistant `.codex-worktrees/glossaire-debutants` (commit local `1ccfa60`, auteur ZeyFro, 100 commits derrière `main`) a été inspecté en lecture seule et laissé intact. Sa version masquée par défaut a servi de référence; le port actuel réutilise les ajouts existants au guide et affiche le glossaire sans nouveau drapeau désactivé.
- `/guide` contient quatre définitions courtes (Aggro, Tank, GG, Carry). Le glossaire reste visible quand `GUIDE_V2_ENABLED` est désactivé; aucune configuration, dépendance ou donnée communautaire ajoutée.
- Validations locales : 7 tests `guide-sections`, ESLint ciblé et TypeScript réussis. CI/preview à vérifier après ouverture de la PR.
