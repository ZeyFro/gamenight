# Discord `/role` — incrément 1 (libre-service, sans migration)

Branche `agent/preflight-20261116`. Aucune migration Prisma, aucune modification du serveur Discord réel.

## Ce qui est codé

Quatre sous-commandes : `chercher`, `attribuer`, `creer`, `retirer`.

- **Doublons et variantes** : comparaison sur clé normalisée (casse, accents, ponctuation, préfixe « jeu »/« game »). Si un rôle de même clé existe, il est utilisé ; une variante proche n'est jamais attribuée automatiquement, elle est proposée comme candidat.
- **Idempotence** : `PUT /guilds/{g}/members/{u}/roles/{r}` et `DELETE` sont idempotents ; la création est précédée d'une relecture de la liste des rôles, donc rejouer l'interaction ne crée pas de doublon. Un rôle déjà porté renvoie « Tu as déjà le rôle » sans appel d'écriture.
- **Rôles sensibles refusés** : noms réservés (admin, modo, staff, bot, gérant…), permissions élevées (Administrateur, Gérer les rôles, Gérer le serveur, Bannir/Expulser, webhooks, exclusion temporaire), rôles gérés par une intégration, `@everyone`.
- **Hiérarchie** : un rôle n'est attribué que s'il est strictement sous le rôle le plus haut du bot.
- **Création** : autorisée avec « Gérer les rôles », ou pour tous si `DISCORD_ROLE_SELF_CREATION_ENABLED=true` ; rôle créé sans aucune permission, non mentionnable, non affiché à part ; plafond `DISCORD_ROLE_MAX_GUILD_ROLES` (défaut 200).
- **Synchronisation GameNight** : le jeu obtenu devient un centre d'intérêt (`Tag` + `UserTag`, modèles existants) — `UserTag` a une clé composite, donc aucun doublon. Compte non relié : message invitant à connecter Discord, jamais de profil fantôme.
- **Erreurs Discord traduites** : permission manquante du bot, limite de débit, réseau incertain (jamais présenté comme un succès).

Fichiers : `src/lib/discord-guild-roles.ts` (décisions pures), `src/lib/discord-role-command.ts` (commande), `src/lib/discord-role-sync.ts` (profil), `src/lib/discord-rest.ts` (5 helpers rôles), `src/lib/discord-interactions.ts` + `src/app/api/discord/interactions/route.ts` (branchement), `scripts/discord-commands.json` (déclaration), `.env.example`.

## Tests exécutés

- `discord-guild-roles.test.ts` — 18 tests (normalisation, secrets, hiérarchie, plans).
- `discord-role-command.test.ts` — 13 tests d'intégration simulée (fetch Discord stubbé, Prisma mocké) : attribution, rejeu sans doublon, refus sensible, refus sans droit, 403 traduit, compte non relié, création unique, plafond, retrait, ACK < 3 s.
- `discord-role-registration.test.ts` — 4 gardes (déclaration envoyée à Discord, fusion des commandes, branchement signé, flags documentés).
- `tsc --noEmit`, ESLint ciblé, `npm run build` : verts. 112 tests ciblés Discord verts au total.

## Activation restante (non exécutée)

1. Mettre `DISCORD_CLIENT_ID` / `DISCORD_BOT_TOKEN` dans l'environnement d'exécution.
2. `node scripts/register-discord-commands.mjs --execute` (le script conserve les autres commandes globales ; simulation vérifiée : `gamenight, tower, tower-admin, role`).
3. Passer `DISCORD_ROLE_COMMAND_ENABLED=true` (et éventuellement `DISCORD_ROLE_SELF_CREATION_ENABLED=true`).
4. Vérifier sur le serveur : rôle du bot au-dessus des rôles de jeu, permission « Gérer les rôles ».
5. Recette réelle : `/role chercher`, `/role attribuer` deux fois de suite (aucun doublon), `/role retirer`.

## Limites assumées

- **Aucune vérification sur le serveur Discord réel** : la commande n'est pas active, donc pas de preuve d'exécution réelle (conforme à la règle « ne jamais promettre une fonctionnalité active dans Discord »).
- **Quota de création persistant absent** : limite par exécution + plafond de rôles, mais pas de compteur journalier par joueur — cela demande une table dédiée, donc une migration (opération bloquante à autoriser).
- Les étages de la Tour ne créent toujours aucun rôle Discord.
