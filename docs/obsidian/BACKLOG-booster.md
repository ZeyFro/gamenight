# Booster Discord — décisions et lot v1 (16 nov. 2026)

Trois décisions confirmées consignées dans `docs/DECISIONS_BOOSTER_20261116.md` (versionné) :
1. `/role` — attribution directe, création encadrée, zéro doublon, zéro permission sensible.
2. `/equipe` + `/projet` — espaces Discord automatiques, avec quotas, noms contrôlés, cycle de vie (périmètre réservé : #408, #416, #370).
3. XP d'équipe — progression collective indépendante ; XP individuelle et étages permanents conservés en cas de changement d'équipe.

## Ce qui est livré
- `src/lib/boost-perks.ts` : avantages Booster (bannière, distinction, présentation, personnalisation d'équipe encadrée 300 caractères, salons réservés) et **liste d'interdits testée** (aucun droit admin/modération, aucun poids de vote, aucun multiplicateur d'étages/XP, aucun avantage de classement, aucun rôle sensible, aucune création illimitée).
- `src/lib/discord-boost.ts` + `getGuildMemberProfile` : statut lu à la source Discord (`premium_since`), sans table parallèle.
- `/boost` : réponse privée, guild-only, éteinte par défaut (`DISCORD_BOOSTER_ENABLED`), n'affirme jamais « tu ne boosts pas » si Discord est injoignable.
- `/aide` reflète l'état réel de `/boost`.

## Tests
`boost-perks.test.ts` (9 tests) + `discord-community-commands.test.ts` (`/boost` × 4) + garde d'enregistrement — tsc/ESLint/build verts.

## Bloqué / réservé
- Historique Booster persistant (badge permanent, périodes) : migration → accord explicite requis.
- Application des avantages dans l'UI web et les espaces d'équipe Discord : #370/#408 + lot UI dédié.
- Enregistrement des commandes : accord #400.
- Aucune modification du Discord réel ni de la Production.
