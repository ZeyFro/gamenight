# Décisions produit — 16 novembre 2026 (Booster Discord et autonomie communautaire)

Document de référence versionné, complément au cahier des charges. Il consigne trois
décisions confirmées par le propriétaire et la spécification de la fonctionnalité Booster.
Aucune de ces décisions ne crée de barème, de permission ou de ressource Discord
supplémentaire : chacune réutilise les services et modèles existants.

## Décisions confirmées

### D1 — `/role`

Un joueur peut demander un rôle de jeu. Le bot attribue le rôle s'il existe, sinon il le crée
dans les limites autorisées : aucune permission sensible, aucun doublon.

Implémentation livrée (`feat(discord): commande /role libre-service avec garde-fous`) :
normalisation des noms (casse, accents, ponctuation, préfixe « jeu »), rôles techniques ou
gérés par une intégration refusés, rôles au-dessus du rôle le plus haut du bot refusés,
création sans aucune permission Discord, relecture avant création (rejeu sans doublon),
plafond `DISCORD_ROLE_MAX_GUILD_ROLES`, synchro du profil via `Tag`/`UserTag`.
Reste bloqué : quota journalier persistant (table dédiée = migration, accord requis).

### D2 — `/equipe` et `/projet`

Le système peut créer automatiquement les espaces Discord nécessaires, avec quotas, noms
contrôlés et cycle de vie.

Non implémenté ici : le périmètre est réservé (#408, #416, #370 — règles d'équipe et
manifeste `/equipe`). Règles à respecter à la reprise : un espace par entité (jamais un
salon par étage ni par tentative d'adhésion), nom dérivé de l'entité et assaini, quota par
communauté, archivage plutôt que suppression, idempotence par identifiant d'entité en base
(une création rejouée retrouve l'espace existant au lieu d'en créer un second).

### D3 — XP d'équipe

Chaque équipe possède une progression collective indépendante ; les joueurs conservent leur
XP individuelle et leurs étages personnels permanents, y compris en changeant d'équipe.

Déjà en vigueur côté données : `CommunityMemberStats` (XP communautaire individuelle),
`TowerChallengeProgress.floorsClimbed` (étages gagnés), `CommunityTeamMember` (appartenance).
Un départ d'équipe ne supprime ni XP individuelle, ni étages, ni résultats historiques.
Aucun XP collectif d'équipe n'est encore stocké : l'ajouter demande un modèle dédié
(migration, accord requis) et ne doit jamais être confondu avec l'XP individuelle.

## Fonctionnalité Booster Discord

### Source de vérité

Le statut provient **exclusivement de Discord** : `premium_since` sur le membre de serveur
(`GET /guilds/{guild}/members/{user}`). Aucune table « booster », aucun rôle maison, aucun
cache persistant : le statut ne peut pas diverger de Discord.

### Avantages (livrés en v1 logique)

| Avantage | Nature |
|---|---|
| Bannière de profil étendue | esthétique |
| Distinction « Booster The Tower » | esthétique, visible sur le profil |
| Section de présentation supplémentaire | esthétique, plafonnée |
| Personnalisation de l'espace d'équipe (description 300 caractères + emoji) | esthétique, encadrée |
| Accès aux salons communautaires réservés aux boosters | accès, jamais une permission |

### Interdits (constants et testés)

- Aucun droit d'administration ou de modération.
- Aucun poids supplémentaire dans les votes de validation des preuves.
- Aucun multiplicateur d'étages ou d'XP.
- Aucun avantage de classement ni quota de défis supplémentaire.
- Aucune attribution automatique de rôle sensible.
- Aucune création illimitée de rôles ou de salons.

Ces interdits sont codés dans `BOOSTER_FORBIDDEN` (`src/lib/boost-perks.ts`) et vérifiés par
test : ajouter un avantage compétitif exigerait de modifier explicitement cette liste.

### Révocation et historique

Les avantages exclusifs dépendent du statut lu en direct : dès que le boost s'arrête, ils
s'éteignent sans action manuelle. Rien n'est supprimé : profil, équipes, XP, étages, badges
et historique restent. Les récompenses déjà obtenues restent permanentes.

### Commande `/boost`

Réponse privée, guild-only, éteinte par défaut (`DISCORD_BOOSTER_ENABLED`). Affiche le statut
réel, la liste des avantages et celle des interdits. Si Discord est injoignable, la commande
dit qu'elle ne peut pas vérifier — elle n'affirme jamais qu'un membre ne booste pas.

### Disponibilité côté GameNight

Les mêmes règles (`boosterPerks`) sont réutilisables par les pages web : bannière, distinction
et personnalisation d'équipe passent par les champs et modèles existants. Aucun système
parallèle n'est créé.

## Reste à faire (bloqué ou réservé)

1. Persistance de l'historique Booster (badge permanent, périodes) : **migration, accord requis**.
2. Application effective des avantages dans l'UI web et les espaces d'équipe Discord : dépend de
   #370/#408 (équipes) et d'un lot UI dédié.
3. Enregistrement des commandes Discord : accord explicite requis (#400).
4. Aucune modification du serveur Discord réel ni de Production effectuée par ce document.
