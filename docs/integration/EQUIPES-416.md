# Intégration `/equipe` — #408/#416 + branche Freebuff

## Constat réel
- #408 et #416 routent `/equipe` vers `src/lib/discord-team-command.ts`
  (`liste`, `moi`, `rejoindre` avec `equipe_id`).
- Notre branche fournit `src/lib/discord-team-commands.ts` : même commande,
  sur-ensemble de 13 sous-commandes, services d'espaces et capitainerie.
- Les deux ne doivent **jamais** être fusionnés côte à côte : ce serait deux
  handlers pour une seule commande. Le routeur de #416 importe le singulier.

## Procédure proposée (à faire par le propriétaire de #416)
1. Remplacer l'import du routeur :
   `@/lib/discord-team-command` → `@/lib/discord-team-commands`,
   `handleSignedTeamCommand(json)` → `handleSignedTeamInteraction(json, timestamp)`.
2. Apporter les fichiers de notre branche : `discord-team-commands.ts`,
   `discord-team-space.ts`, `discord-team-space-service.ts`,
   `discord-team-space-api.ts`, `community-team-captain.ts`,
   `community-team-captain-service.ts`, `community-team-captain-store.ts`.
3. Remplacer le bloc `equipe` de `scripts/discord-commands.json` par
   `docs/patches/20261117-equipe-declaration.json` (13 sous-commandes).
4. Mettre à jour `discord-team-command-manifest.test.ts` : 13 options, et
   `rejoindre` accepte `equipe` (notre nom) ou `equipe_id` (alias conservé).
5. Supprimer `discord-team-command.ts` et son test uniquement après bascule du
   routeur, pour ne laisser aucun handler orphelin.

## Compatibilité transitoire déjà en place
`textOption("equipe") ?? textOption("equipe_id")` : la déclaration actuelle de
#416 fonctionne avec notre handler, et notre déclaration future fonctionne avec
l'alias. Test : `discord-team-commands.test.ts` (« accepte l'option equipe_id »).

## Dépendances
- #370/#408 : migration `20261104140000_tower_team_membership_policy`
  (`captainId` + backfill) et `community-team-handover.ts` (capitaine inactif).
- #416 : déclarations et test de manifeste.
- Aucun merge sans autorisation ; aucun force-push.
