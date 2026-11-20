# /role : création automatique de rôle de jeu

Flag : `DISCORD_ROLE_AUTOCREATE_ENABLED` (OFF par défaut). Migration `20261118130500_discord_role_requests` (table `DiscordRoleRequest`, additive).

## Fonctionnement

1. `/role creer jeu:X` (ou `/role attribuer jeu:X` quand X n'existe pas) : recherche par nom normalisé (sans accent, sans ponctuation, sans préfixe « jeu », insensible à la casse et, en recherche, à l'ordre des mots). Un rôle existant est attribué directement (comportement #460).
2. Rôle absent, flag ON : **aucune écriture Discord** dans la commande. Une `DiscordRoleRequest` (PENDING) et un `NotificationEvent` ADMIN `ROLE_AUTOCREATE` + une `NotificationDelivery` BOT sont écrits. L'executor (`create_game_role`) crée le rôle **sans aucune permission** (non mentionnable, non affiché à part) puis l'attribue au demandeur et synchronise son centre d'intérêt.
3. Idempotence : le nom normalisé est unique par serveur ; un rejeu retrouve le rôle (jamais de doublon) ; le `roleId` est persisté avant l'attribution.

## Règles

- 1 création par joueur et par semaine (fenêtre glissante de 7 jours, verrou `CronLock` par joueur). Les demandes en échec ou abandonnées (PENDING depuis plus de 2 h) ne comptent pas.
- Plafond configurable `DISCORD_ROLE_MAX_GUILD_ROLES` (défaut 200, jamais plus que la limite Discord de 250) : refus au-delà.
- Alerte staff dès 80 % de 250 rôles (200) : événement ADMIN `ROLE_CAPACITY_ALERT` (un par jour et par serveur), journal `error`, visible dans le tableau de bord /admin (sujet O). Aucun message Discord n'est envoyé automatiquement.
- Un rôle sensible (nom réservé, permission élevée, géré par une intégration) n'est jamais attribué.
- Exige `DISCORD_ROLE_COMMAND_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`, le jeton du bot.

## Activation (à indiquer à Maxime)

Avant d'activer : **supprimer d'abord les 134 rôles « Étage »** (suppression manuelle par le propriétaire, jamais par le code) pour repartir sous le plafond de 200 rôles.
