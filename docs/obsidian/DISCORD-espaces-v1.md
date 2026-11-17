# Espaces Discord des équipes et projets (planificateur)

Code : `src/lib/discord-team-spaces.ts` · flag `DISCORD_TEAM_SPACES_ENABLED`
(fermé par défaut) · **aucune ressource réelle créée sur The Tower**.

## Ce qui est décidé

Le module ne fait pas d'appel Discord dans les commandes : il produit un **plan**
(`planTeamSpace`) puis l'exécute seulement si le flag est ouvert, avec un client
injecté (`applyTeamSpacePlan`). Les tests utilisent un faux client : zéro appel
réseau.

## Règles tenues

- **Nom** : salon normalisé (minuscules, sans accent, `-`), 100 caractères max,
  refusé s'il devient vide ; rôle `GN · <nom>` borné à 100.
- **Clé déterministe** : `gn-team-<id>` → rejouer la planification **réutilise**
  le rôle et le salon existants au lieu d'en créer d'autres (idempotence).
- **Permissions** : rôle toujours `permissions: "0"`, `mentionable: false`,
  `hoist: false` — aucun droit administratif possible. Salon privé :
  `@everyone` refuse `Voir les salons` (1024), le rôle d'équipe l'autorise.
- **Quota** : 5 espaces gérés par communauté par défaut ; un espace déjà existant
  ne consomme pas de place supplémentaire.
- **Membres** : identifiants Discord validés (neige), dédupliqués, 50 max.
- **Départ / équipe vide** : plan d'**archivage** (renommage `archive-…`), jamais
  une suppression ; une équipe désactivée est refusée (`team_disabled`).
- **Échec partiel** : si le rôle échoue, le salon n'est pas créé (pas de salon
  orphelin) et le résultat est `partial` avec le détail par étape.

## Ce qui reste à faire (bloqué volontairement)

1. Brancher le plan sur une vraie création après accord explicite (le flag reste
   `false`, aucun salon/role créé sur le serveur réel).
2. Persister les identifiants créés (`channelId`, `roleId`) → **migration Prisma
   requise**, donc accord explicite.
3. Retirer la permission d'un membre parti : dépend du point 2 (sans stockage,
   le plan ne connaît pas le salon à modifier).
4. Archivage automatique sur dissolution d'équipe : même dépendance.

Aucun de ces points n'est simulé : le code s'arrête proprement au plan.
