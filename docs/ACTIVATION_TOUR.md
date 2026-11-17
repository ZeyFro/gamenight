# Activation de la Tour en une soirée

Décision du propriétaire du 17 novembre 2026. Elle remplace « un interrupteur par jour » : les 4 interrupteurs sont conservés mais activés le même soir.

## Prérequis

- Migrations Tower appliquées en Production (voir [MIGRATIONS.md](MIGRATIONS.md)).
- Commandes `/tower` et `/tower-admin` enregistrées sur le serveur The Tower. Corriger d'abord le 403 : réinviter l'application (`scope=bot applications.commands`, permissions minimales de `src/lib/discord-setup-permissions.ts`), relancer l'enregistrement et lire le champ `code` de la réponse.
- `NOTIFICATION_EXECUTOR_ENABLED=true` (sans lui, rien n'est envoyé).

## Le soir de l'activation

1. Vercel : `TOWER_CHALLENGES_ENABLED=true` et `TOWER_DISCORD_ANNOUNCE_ENABLED=true`, avec **un seul redéploiement**.
2. Base de Production, drapeau communautaire :
   ```sql
   UPDATE "Community" SET "towerChallengesEnabled" = true WHERE "discordGuildId" = '553922938101825536';
   ```
3. Sur Discord : `/tower-admin importer`, puis `/tower-admin importer-equipe`.

## Contrôle

- `/tower` répond et affiche le catalogue importé.
- Une annonce de test part dans le salon configuré via la file existante.
- Aucune erreur dans les logs Vercel ni dans l'executor.

## Retour arrière

| Élément | Action |
| --- | --- |
| Annonces | `TOWER_DISCORD_ANNOUNCE_ENABLED` retiré ou ≠ `true`, redéploiement |
| Parcours de défis | `TOWER_CHALLENGES_ENABLED` retiré ou ≠ `true`, redéploiement |
| Communauté | `UPDATE "Community" SET "towerChallengesEnabled" = false WHERE "discordGuildId" = '553922938101825536';` |
| Catalogue importé | Conservé ; aucune suppression nécessaire |
