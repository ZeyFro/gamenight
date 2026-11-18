# Commandes Discord The Tower : diagnostic du 403 et procédure

Aucun appel Discord n'a été fait pour écrire ce guide (lecture du code et de `docs/REPRISE_AUTONOME.md` seulement).

## Diagnostic

`scripts/register-tower-guild-commands.mjs --execute` s'est arrêté sur HTTP 403 (voir `docs/REPRISE_AUTONOME.md`). Le script fait un GET puis des POST sur `/applications/{DISCORD_CLIENT_ID}/guilds/{TOWER_DISCORD_GUILD_ID}/commands` avec `Authorization: Bot <DISCORD_BOT_TOKEN>`. Un 403 sur ces routes a trois causes plausibles, à départager par le champ `code` :

| HTTP / code | Cause | Action |
|---|---|---|
| 403 / `50001` (Missing Access) | Application non autorisée sur le serveur avec le scope `applications.commands` (cause la plus probable) | Réinviter avec le lien ci-dessous |
| 401 | Jeton absent, régénéré, ou d'une autre application | Vérifier `DISCORD_BOT_TOKEN` côté serveur |
| 403 sans `50001`, 404 | `DISCORD_CLIENT_ID` d'une autre application que celle du jeton, ou serveur incorrect | Vérifier que l'ID d'application et le jeton viennent du même portail développeur |
| 50013 | Permission manquante | Contrôler les permissions du bot |

Le script affiche le statut HTTP, le code numérique et une indication ; jamais le jeton. Si le corps n'est pas du JSON, le code affiché est `indisponible`.

## Lien d'invitation

Remplacer les deux valeurs par celles de l'environnement serveur autorisé (`DISCORD_CLIENT_ID`, `TOWER_DISCORD_GUILD_ID`) ; ne jamais les copier dans un fichier du dépôt ni dans `.env.example`.

```
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=395137076240&guild_id=<TOWER_DISCORD_GUILD_ID>&disable_guild_select=true
```

`permissions=395137076240` est le masque de `SETUP_PERMISSIONS` dans `src/lib/discord-setup-permissions.ts` : Gérer les salons, Voir les salons, Envoyer des messages, Intégrer des liens, Voir l'historique, Gérer les fils, Créer des fils publics, Créer des fils privés, Envoyer des messages dans les fils. L'invitation doit être validée par un compte qui a « Gérer le serveur » sur The Tower. Réinviter une application déjà présente ne retire rien ; cela ajoute le scope manquant.

## Procédure

Dans un environnement autorisé qui possède déjà `DISCORD_CLIENT_ID`, `DISCORD_BOT_TOKEN` et `TOWER_DISCORD_GUILD_ID` :

1. `node scripts/register-tower-guild-commands.mjs` : simulation par défaut, aucun appel réseau.
2. `node scripts/register-tower-guild-commands.mjs --check` : un GET en lecture seule ; affiche `/tower` et `/tower-admin` présente ou absente. Un 403 `50001` ici confirme le diagnostic : réinviter, puis relancer `--check`.
3. Après accord du propriétaire : `node scripts/register-tower-guild-commands.mjs --execute` (GET, puis au plus deux POST d'upsert, aucun PUT global, aucune autre commande touchée).
4. Relancer `--check`, puis tester avec un compte membre et un compte modérateur. Ne pas activer `TOWER_CHALLENGES_ENABLED` avant un test complet.

En cas d'échec : noter uniquement le statut et le code, ne pas réessayer en boucle (429 possible). `--check` et `--execute` sont exclusifs. Le script refuse de tourner si `TOWER_DISCORD_GUILD_ID` n'est pas le serveur The Tower attendu.

## Commandes

Définies dans `scripts/discord-commands.json` (état de `main`) :

| Commande | Sous-commandes | Permission par défaut |
|---|---|---|
| `/tower` | defi, progression, classement, vote, equipe | aucune restriction (tous les membres) |
| `/tower-admin` | ajouter, defis, desactiver, importer, importer-equipe | « Gérer le serveur » (`default_member_permissions` = 32) |
| `/gamenight` | setup | « Gérer le serveur » (32) ; non gérée par ce script |

Le script ne gère que `/tower` et `/tower-admin`.

Écart à signaler : `/equipe`, `/role`, `/joueurs`, `/soiree` et `/tournoi` ne figurent pas dans `scripts/discord-commands.json` sur `main` et ne sont donc enregistrées par aucun script. `/equipe` est prévue par P2-03 (PR #408, réponses privées) ; `/joueurs` existe comme page du site (annonces de 24 h), pas comme commande Discord. Leurs permissions Discord restent à définir avec leurs handlers (hors périmètre ici, réservé à #444).
