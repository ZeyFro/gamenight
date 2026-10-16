# L7-09 — thèmes saisonniers

- Worktree `.codex-worktrees/themes-saisonniers`, branche `feat/themes-saisonniers`, empilé sur la PR L7-08 en cours (`origin/feat/soldes-evenements`). Rebaser après fusion #260.
- Sous-agents lecture seule terminés : Mendel a repéré les variables d’accent CSS et l’obligation de préserver mode sombre/contraste ; Socrates a vérifié le calendrier et les risques de dates UTC. Aucun fichier modifié par les agents.
- Implémentation locale : changement d’accent décoratif automatique pendant Halloween (25 oct.–1 nov.), Noël (20–26 déc.) et le Marathon d’été (1–7 juil.). Les couleurs de fond/texte, le mode sombre et les animations ne changent pas ; aucun réglage ou stockage ajouté.
- Dates calculées en UTC sur le serveur. Test unitaire couvre les débuts/fins de périodes et les jours immédiatement adjacents.
- Validations à lancer après la modification : test `seasonal-theme`, ESLint, TypeScript, Next typegen et diff-check ; CI/Vercel requis pour la PR.
