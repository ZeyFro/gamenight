# Recette boutique XP sur le schéma intégré (23 octobre 2026)

Base : branche `integ/xp-vocal-20261023` @ 00bb9d1 (main + XP/boutique #291 + vocal #303 + #324 + #319). Aucune opération Production, aucun Discord réel, aucun `.env`.

## Mode opératoire

Environnement : Node 24.19.0, Next 16.3.8, Prisma 6.19.3, Docker 29.8.2, Chrome 155.0.8059.86 (headless, profil temporaire par scénario, supprimé à la fin), `playwright-core` 1.49.1 installé hors dépôt (aucune dépendance ajoutée).

1. Base jetable : `docker run -d --name gn-a4-pg-20261023 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gamenight_test -p 127.0.0.1:55474:5432 postgres:16-alpine -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c checkpoint_timeout=1h -c max_wal_size=8GB`
2. `npm ci`, puis `DATABASE_URL=postgresql://postgres:test@127.0.0.1:55474/gamenight_test npx prisma migrate deploy` : 117 migrations appliquées, `migrate status` = « Database schema is up to date ».
3. Recette (le script démarre `next dev` sur 127.0.0.1:3474, variables passées au processus enfant seulement) :
   `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55474/gamenight_test RECETTE_PG_PORT=55474 RECETTE_APP_PORT=3474 PLAYWRIGHT_MODULE_PATH=<dossier playwright-core> RECETTE_CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe" RECETTE_BUNDLER=turbopack node scripts/recette-boutique.mjs`
   (`RECETTE_ONLY=<texte>` ne lance que les scénarios dont le nom contient ce texte.)
4. Tests ciblés, un fichier à la fois, avec `TEST_DATABASE_URL` sur la base ci-dessus.

## Résultats

| Scénario | Résultat |
|---|---|
| Schéma après `migrate deploy` vs `schema.prisma` | Tables XP/boutique identiques. `migrate diff` signale 3 écarts hors boutique, voir « Défauts hors périmètre » |
| Achat de 2 articles (250 + 300) | OK : solde 1000 -> 750 -> 450, `xpTotal` reste 2000, badge de grade inchangé, 2 `XpEvent` `SHOP_BALANCE_PURCHASE` |
| Équipement / retrait | OK : aucun débit, `equippedTitleId`/`equippedFrameId` posés puis `null` |
| Solde insuffisant (solde 100, article 350, `xpTotal` 2000) | OK : message « Ton solde XP est insuffisant. », aucun débit, aucun événement ni objet créé |
| Objet déjà possédé | OK : plus de bouton « Acheter » sur l'objet, libellé « Possédé » ; rejeu concurrent -> « Tu possèdes déjà cet objet. » |
| Double clic + 3 onglets sur le même article | OK : 1 seul achat (solde 700, 1 événement -300, 1 objet) ; messages par onglet : possédé / possédé / achat effectué |
| 2 onglets, 2 articles différents, solde pour un seul (300 ; 200 et 250) | OK : un seul acheté (Glace), solde 50, jamais négatif, 1 événement |
| Progression vs solde | OK : `xpTotal` inchangé dans tous les achats ; seul `xpBalance` diminue |
| Achats historiques (db656e7) | OK : classement de la semaine 400 XP (500 gagnés, ancien `SHOP_PURCHASE` -100 compté) avant et après un achat récent ; l'achat récent (`SHOP_BALANCE_PURCHASE`) est exclu ; ancien événement intact |
| Mobile 390x844 | OK : `scrollWidth <= innerWidth` |
| Erreurs JS de page (`pageerror`) | Aucune |

Tests ciblés (tous passés, 0 ignoré) : `src/lib/xp-shop.test.ts` 3 ; `src/lib/xp-shop.integration.test.ts` 11 ; `src/lib/xp-balance-migration.integration.test.ts` 3 ; `src/app/profil/page.integration.test.ts` 3.

## Défauts hors périmètre de cette tâche (non corrigés)

- `next dev --webpack` échoue : `src/instrumentation.ts` (vocal, 8938fbc) entraîne `web-push` dans le bundle Edge (`Can't resolve 'http'`), `/api/auth/session` répond 500. La recette utilise donc Turbopack (`RECETTE_BUNDLER=turbopack`).
- `npx tsc --noEmit` (donc `next build`) échoue : 14 erreurs dans `src/lib/db-migrate-lib.test.ts` (paramètres de `scripts/db-migrate*` requis dans les types). Le build de la branche intégrée est bloqué tant que ce n'est pas corrigé.
- `prisma migrate diff` base migrée -> `schema.prisma` non vide : index `CommunityGameEpitaph_communityId_createdAt_idx` absent du schéma, défaut `updatedAt` de `SessionVoicePresenceControl`, nom d'index `SessionVoicePresenceInterval_..._sta_key` à renommer.

## Non prouvé

- `scripts/recette-parcours.mjs` (parcours complet) et `check-recette-local-docker.mjs` non exécutés.
- Build de production (`next build` + `gamenight-server.mjs`) non testé : bloqué par le point tsc ci-dessus ; la recette tourne en mode dev Turbopack.
- Concurrence testée via le navigateur (onglets) seulement ; la limite de débit (10 achats/minute/utilisateur) est en mémoire par instance. Un seul processus serveur testé.
- Aucune migration Production ni bascule des writers vérifiée ici.
