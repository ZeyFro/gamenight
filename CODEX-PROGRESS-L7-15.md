# L7-15 — DM lors d'une promotion de liste d'attente

- Worktree isolé `.codex-worktrees/promotion-waitlist-discord`, empilé sur le SHA `f982d896856dc4f60733e068027f4d2ba67bc12e` de la PR #264. Aucun changement du checkout principal.
- Lors d'une transition réelle `WAITLIST → CONFIRMED`, l'application conserve sa notification interne et met aussi en file un DM Discord dans la même transaction, uniquement si l'annonce bot de la soirée et la catégorie DM appropriée (SESSION ou ROULETTE) sont activées.
- Le rôle DM d'une promotion a une occurrence unique par transition; le résolveur relit ensuite l'état et n'envoie que si la session reste ouverte et le destinataire confirmé, actif et autorisé par ses préférences. Un échec Discord ne peut pas annuler la place déjà confirmée.
- Validations locales : 7 tests unitaires réussis; ESLint, `tsc --noEmit` et `git diff --check` réussis. 105 tests Postgres intégration ignorés car `TEST_DATABASE_URL` est absent.
- Pas encore poussé : la PR L7-15 attend la fusion de sa base #264; CI/Postgres et preview devront vérifier le SHA final avant fusion.
