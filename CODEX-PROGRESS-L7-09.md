# L7-09 — thèmes saisonniers

- Worktree `.codex-worktrees/themes-saisonniers`, branche `feat/themes-saisonniers`, PR #261 ciblant `main` après fusion #260 (`61fd838ef082c268e6bf52090c9ef6c651a50b83`).
- Sous-agents lecture seule terminés : Mendel a repéré les variables d’accent CSS et l’obligation de préserver mode sombre/contraste ; Socrates a vérifié le calendrier et les risques de dates UTC. Aucun fichier modifié par les agents.
- Implémentation locale : changement d’accent décoratif automatique pendant Halloween (25 oct.–1 nov.), Noël (20–26 déc.) et le Marathon d’été (1–7 juil.). Les couleurs de fond/texte, le mode sombre et les animations ne changent pas ; aucun réglage ou stockage ajouté.
- Dates calculées en UTC sur le serveur. Test unitaire couvre les débuts/fins de périodes et les jours immédiatement adjacents.
- Validations locales après rebase : `npx vitest run src/lib/seasonal-theme.test.ts` (8/8), ESLint ciblé, `npx tsc --noEmit` et Next typegen déjà validés avant rebase ; le code fonctionnel est inchangé.
- Tête actuelle au retarget : `b950499a0916f750eb2ca6fe036fca06545e68d8`. Le changement de base seul n’a pas déclenché Actions ; un commit de journal déclenchera `synchronize`. CI et Vercel requis avant fusion.
