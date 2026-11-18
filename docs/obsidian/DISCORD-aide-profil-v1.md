# Discord `/aide` et `/profil` — incrément 2 (lecture seule)

Branche `agent/preflight-20261116`. Aucune migration, aucune écriture Discord, aucune ressource créée.

## Ce qui est codé

- **`/aide`** : liste les commandes réellement présentes et leur état **lu sur les mêmes variables que les handlers** (`DISCORD_ROLE_COMMAND_ENABLED`, `TOWER_CHALLENGES_ENABLED`, `COMMUNITY_SETUP_COMMAND_ENABLED`, `DISCORD_PROFILE_COMMAND_ENABLED`). Aucune promesse de commande inactive ; rappelle qu'aucune commande ne donne de permission administrative. Toujours disponible (aucune donnée personnelle).
- **`/profil`** : étage, niveau, titre, rang, XP de la communauté, étages gagnés par les défis, badges, jeux et équipes. Éphémère, guild-only, éteinte par défaut (`DISCORD_PROFILE_COMMAND_ENABLED`).

## Architecture — aucune duplication

| Donnée | Source réutilisée |
|---|---|
| Étage + niveau | `getTowerProgress(xpTotal, community.towerLevelsPerFloor)` (page `/ascension`) |
| XP communautaire | `getMemberStats(userId, communityId)` |
| Étages gagnés par défis | `getTowerPersonalProgress` (uniquement si `TOWER_CHALLENGES_ENABLED`, comme la fiche pote) |
| Titre / rang | `titleForLevel`, `rankForLevel` (`xp.ts`) |
| Équipes | `CommunityTeamMember` (nom, jeu, capitaine, effectif) — **aucun XP d'équipe inventé** |

Les systèmes restent séparés : XP individuelle, étages gagnés, badges, équipes. Aucun nouveau barème.

## Confidentialité

Réponse privée, aucune donnée sensible : ni `discordId`, ni jeton, ni e-mail, ni liste de membres. Un serveur inconnu et un non-membre reçoivent la même réponse (pas de fuite d'existence).

## Tests exécutés

- `discord-community-commands.test.ts` — 9 tests : état réel des flags dans `/aide`, réponse privée, refus MP/horodatage/application, `/profil` fermée par défaut, ACK puis publication, refus invalide/serveur inconnu/non-membre, réutilisation du barème XP (niveau 5 / étage 1 pour 800 XP), étages et équipes quand Tower est actif, absence de données privées.
- `discord-community-registration.test.ts` — 4 gardes (déclaration `aide`/`profil` sans option, pas de doublon, routage signé, `after(runCommunity)`, flag documenté).
- `tsc --noEmit` : 0 erreur · ESLint ciblé : 0 · `npm run build` : OK · 76 tests Discord verts sur 7 fichiers.
- Correction de type mineure dans `discord-tower-challenges.test.ts` : l'ajout de commandes sans option au JSON rendait `options` optionnel (`?.options?.map`).

## Activation restante (non exécutée — accord requis)

1. `node scripts/register-discord-commands.mjs --execute` — simulation vérifiée : `gamenight, tower, tower-admin, role, aide, profil` (30 entrées).
2. `/aide` : rien d'autre à activer.
3. `/profil` : `DISCORD_PROFILE_COMMAND_ENABLED=true`.

## Limites

- **Aucune exécution sur le serveur Discord réel** : enregistrement des commandes soumis à accord (#400, « Accords obligatoires »).
- **Plafond de PR** : 10 PR de code ouvertes (#325, #370, #384, #385, #387, #388, #394, #396, #397, #442) → pas de nouvelle PR ; livraison sur la branche existante.
- `/defi`, `/ascension`, `/classement` restent servies par `/tower` (defi/progression/classement) : les renommer toucherait `tower-challenges.ts`, réservé par #396/#407 — coordination requise, aucun changement fait.
- `/equipe` : handler de `main` (`discord-team-command.ts`), non dupliqué ici.

## Sprint 17/11 — `/aide` à jour

`/aide` liste désormais `/equipe`, `/soiree`, `/tournoi` et `/joueurs`
avec l'état réel de leur flag, et rappelle qu'une commande « fermé » ne lit ni
n'écrit rien. La mention « en préparation » pour ces commandes a été retirée :
elle serait devenue fausse.
