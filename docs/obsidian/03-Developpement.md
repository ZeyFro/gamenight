# Développement de l'application

- Environnement local, PostgreSQL jetable, tests : [[DEVELOPPEMENT_LOCAL]]
- Instructions agents : `AGENTS.md` et `CLAUDE.md` à la racine du dépôt.
- Relecture : [[guide-relecture]]
- Reprise et état : [[REPRISE_AUTONOME]], [[ETAT]]

## Commandes usuelles (ciblées)
`npm run lint -- <fichiers>` · `npx tsc --noEmit` · `npx vitest run <test>` · `git diff --check` · `npm run test:postgres` (base locale jetable uniquement).

## Flux de travail
1. Lire `AGENTS.md`, `CLAUDE.md`, l'issue #400 et les réservations.
2. Brancher depuis `origin/main` (branche ou worktree dédié).
3. Tests ciblés suffisants, pas la suite complète sans raison.
4. Ouvrir une PR en brouillon ; ne pas fusionner.
5. Mettre à jour la note concernée du coffre et consigner le compte-rendu.
