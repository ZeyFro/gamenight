# Patch isolé — actions web des annonces sur le service partagé

**Fichier** : `docs/patches/20261117-joueurs-service-partage.patch`
**Cible** : `src/app/joueurs/actions.ts` (réservé #408)
**Base vérifiée** : tête #408 `3465c39` — `patch -p1 -F0` strict, sans fuzz.

## Problème corrigé

Le web et Discord écrivaient les annonces avec deux logiques distinctes. Le patch
remplace les deux actions par des appels à `src/lib/player-listings.ts`, déjà
utilisé par `/joueurs publier` et `/joueurs retirer`.

Une seule implémentation porte désormais :

| Règle | Où |
| --- | --- |
| validation (`playerClassifiedSchema`) | service |
| expiration 24 h (`playerClassifiedExpiresAt`) | service |
| limite de débit (`createPlayerClassified`/`deletePlayerClassified`) | service |
| anti-doublon (même auteur + jeu + message actif) | service |
| contrôle d'auteur / modération | service |
| porte communautaire (`getPlayerClassifiedCommunityId`) | action + handlers |

## Ordre d'application

1. Récupérer `src/lib/player-listings.ts` depuis `agent/preflight-20261116`.
2. Appliquer ce patch sur la branche #408.
3. `npx tsc --noEmit` puis `npx vitest run src/lib/player-listings.test.ts`.

## Ce que ce patch ne fait pas

- Aucune migration : les champs étendus de #408 (`platform`,
  `microphoneRequirement`, `partyType`, `startsAt`, `durationMinutes`) sont validés
  par le schéma de #408 et transmis tels quels par le service ; ils restent absents
  de la branche actuelle, où ils ne sont jamais fournis.
- Aucun nouveau code d'erreur de page : `?error=duplicate` est ajouté au
  comportement existant (`unavailable`, `invalid`, `rate_limited`, `forbidden`).
