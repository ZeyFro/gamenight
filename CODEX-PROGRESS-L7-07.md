# L7-07 — sorties de jeux attendus

- Worktree : `.codex-worktrees/sorties-jeux-attendus`, branche `feat/sorties-jeux-attendus`, basée sur `origin/main` `916c53a7a395fbb8f25e2f307c3641e02744a9d7`.
- Sous-agents lecture seule terminés : Ptolemy a repéré `first_release_date` converti et mis en cache via `src/lib/igdb.ts` / `src/lib/game-details.ts`; Confucius a vérifié l’isolation calendrier, le jour UTC et l’unicité existante `GameWishlist(communityId,gameId)`. Aucun fichier modifié par eux.
- Implémentation locale : les dates IGDB en cache des jeux non achetés de la wishlist apparaissent automatiquement sur le calendrier de la communauté courante, avec lien vers la fiche. Aucun appel IGDB n’est déclenché par le calendrier et aucune table n’est ajoutée. Dates sans heure interprétées en jour UTC.
- Validations locales au code courant : tests ciblés calendrier/date (8 passent) ; test Postgres d’isolation du calendrier ignoré sans `TEST_DATABASE_URL`; ESLint ciblé, TypeScript, Next typegen et diff-check passent.
- Limite connue : la sortie n’apparaît que si la fiche IGDB est déjà en cache et qu’elle contient une date ; IGDB donne une première date globale, qui peut être indicative ou différente selon région/plateforme.
- PR brouillon à ouvrir après revalidation locale ; aucun merge sans CI et preview Vercel vertes sur la tête exacte.
