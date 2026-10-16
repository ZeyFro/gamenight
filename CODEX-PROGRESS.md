# Suivi Codex — roulette pondérée

- Date UTC : 2026-10-16
- Base : `origin/main` au SHA `2224835d0e8cce8cb7617eadb636ebfb70b25d9a` (merge PR #253).
- Objectif : favoriser les tierlists des participants et éviter les jeux terminés dans la communauté durant les sept derniers jours; appliquer aux tirages asynchrones et aux relances après veto.
- PR : en préparation sur `feat/roulette-ponderee`.
- Changements : sélection pondérée par moyenne S=5, A=4, B=3, C=2, D=1 (non classé neutre B); exclusion récente si un autre candidat subsiste; repli sur les récents si nécessaire. Pas de migration.
- Vérifications : `npx vitest run src/lib/roulette-draw.test.ts src/lib/roulette-veto.test.ts` — 27/27 réussis; lint ESLint ciblé — réussi; `git diff --check` — réussi. Test Postgres roulette ajouté, non exécuté localement (`TEST_DATABASE_URL` absent), sera exécuté par la CI.
- CI / preview / fusion : en attente de création de PR et des contrôles sur le SHA final.
- Agents lecture seule : Gauss (chemins de code) et Jason (risques CI/tests), tous deux terminés puis fermés.
- Prochain lot : heures par jeu et heures cumulées (L7-03), après clôture de la PR.
