# L6-02 — Annonces Discord par match de tournoi

- Worktree `.codex-worktrees/tournament-match-announcements`, branche `feat/tournament-match-announcements`, base actuelle `main` `6b26425ca82abed5ecc992a47d8188e3c4528fed`.
- Agents lecture seule : Boole a cartographié le cycle `declareWinner` et les résolveurs; Boyle a audité idempotence, mentions et plan CI. Conclusions intégrées : outbox par match dans la transaction de claim, slot stable, résultat dans le fil tournoi, `allowed_mentions: { parse: [] }`, aucun appel Discord en test.
- Implémentation locale : `TOURNAMENT_MATCH_RESULT` occurrence `matchId`, livraison BOT/SEND par slot dédié; résolveur vérifie l'état du tournoi, le match terminé et le thread; affiche vainqueur/adversaire/score sans mention. Aucun changement de schéma ni migration.
- Tests ajoutés dans `src/lib/tournament-announce.integration.test.ts` : publication par match, contenu/score, nom `@everyone` sans ping, retry sans doublon, rollback si enqueue échoue, aucun enqueue sans annonce bot.
- Validations locales : ESLint ciblé, `tsc --noEmit`, `git diff --check` réussis. Vitest ciblé : 16 passés; 64 tests d'intégration skipped car `TEST_DATABASE_URL` absent. Aucune intégration Postgres validée localement.
- À faire : faire relire le diff, commit/push et ouvrir PR; CI `test:postgres` doit valider les cas ajoutés. Aucun message Discord réel envoyé.
