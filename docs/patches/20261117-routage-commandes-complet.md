# Patch isolé — routage complet des commandes et interactions

**Fichier** : `docs/patches/20261117-routage-commandes-complet.patch`
**Cible** : `src/lib/discord-interactions.ts`, `src/app/api/discord/interactions/route.ts`
**Propriétaire** : #408 (fichiers réservés)
**Base vérifiée** : tête #408 `3465c39` — `patch -p1 -F0` strict, sans fuzz.

## Contenu (7 hunks, additives uniquement)

1. `interaction.type === 4` → `handleSignedAutocomplete` (autocomplétion `/tournoi`, `/soiree`).
2. `InteractionOutput` : `runSession`, `runTournament`, `runPlayers`, `runProject`
   (le `runTeam` de #408 est conservé).
3. Dispatch `/tournoi`, `/soiree`, `/joueurs`, `/projet` — insérés **avant** le
   bloc `/equipe` existant de #408, qui n'est ni touché ni dupliqué.
4. `respondToTournamentRsvp(..., tournamentRsvp.kind)` : le bouton « Je me
   désinscris » est transmis au handler.
5. `route.ts` : déstructuration + `after(...)` pour les quatre nouveaux runners.

Aucun autre comportement de #408 n'est modifié : `gamenight setup`, `tower`,
`tower-admin`, `equipe`, `welcome`, RSVP de sièges et d'instantané restent
identiques.

## Application

```bash
git apply --check docs/patches/20261117-routage-commandes-complet.patch
git apply docs/patches/20261117-routage-commandes-complet.patch
npx tsc --noEmit
npx vitest run src/lib/discord-interactions.test.ts src/lib/discord-autocomplete.test.ts
```

Dépend de la branche `agent/preflight-20261116` (modules `discord-autocomplete`,
`discord-session-autocomplete`, `discord-player-commands`,
`discord-project-commands`, `discord-session-commands`,
`discord-tournament-commands`). À appliquer **après** récupération de ces modules.

## Ajout du 17/11 — boutons d'annonce

Le patch inclut désormais le bloc `gn:listing:` (avant le traitement RSVP
générique) : validation application/horodatage/composant, ACK privé, puis
`respondToListingInteraction`. Il dépend des modules
`discord-player-listing-components` et `discord-player-listing-rsvp` de la
branche `agent/preflight-20261116`.
