# Patch isolé — routage des interactions d'autocomplétion

**Fichier de patch** : `docs/patches/20261117-autocomplete-routage.patch`
**Fichier cible** : `src/lib/discord-interactions.ts` (réservé par #408)
**Dépendance** : branche `agent/preflight-20261116`, commit `110e970` ou plus récent
(module `src/lib/discord-tournament-autocomplete.ts`).

## Pourquoi un patch

`/tournoi inscription|desinscription` déclare `tournoi` avec `autocomplete: true`.
Les interactions de type 4 doivent être routées avant tout traitement de
commande ; ce routeur appartient à #408, donc il n'est pas modifié ici.

## Contenu (6 lignes, après le `PONG`)

```ts
if (interaction.type === 4) {
  const { buildAutocompleteResponse } = await import("@/lib/discord-tournament-autocomplete");
  return buildAutocompleteResponse(json, input.timestamp);
}
```

`buildAutocompleteResponse` vérifie lui-même l'application, l'horodatage, le
serveur et l'appartenance ; il ne lit que des tournois `REGISTRATION` de la
communauté et ne fait aucune écriture.

## Application

```bash
git apply --check docs/patches/20261117-autocomplete-routage.patch
git apply docs/patches/20261117-autocomplete-routage.patch
npx vitest run src/lib/discord-tournament-autocomplete.test.ts
npx tsc --noEmit
```

Dry-run vérifié sans tolérance de contexte sur la tête #408 `3465c39`.

## État au 17/11/2026 (sprint)

Le même bloc est **déjà appliqué** sur `agent/preflight-20261116`, où il aiguille
vers `src/lib/discord-autocomplete.ts` (dispatch `/tournoi` + `/soiree`). Le patch
reste fourni pour #408 : la fusion des deux branches donnera un seul et même bloc.
Le test `src/lib/discord-autocomplete.test.ts` couvre le dispatch, les adaptateurs
sont testés séparément.
