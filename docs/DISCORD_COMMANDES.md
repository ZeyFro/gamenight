# Commandes Discord The Tower : enregistrement complet et diagnostic

Le script `scripts/register-tower-guild-commands.mjs` enregistre **toutes** les commandes déclarées dans `scripts/discord-commands.json` dans le serveur The Tower (`553922938101825536`), par la route de serveur `/applications/{DISCORD_CLIENT_ID}/guilds/{TOWER_DISCORD_GUILD_ID}/commands`, jamais par la route globale. Aucun appel Discord n'a été fait pour écrire ce guide.

## Trois modes exclusifs

| Mode | Réseau | Effet |
|---|---|---|
| (défaut) simulation | aucun, aucune variable requise | liste le plan : un POST d'upsert par commande, dans l'ordre du manifeste, avec sous-commandes et permission |
| `--check` | un GET en lecture seule | pour chaque commande du manifeste : `présente`, `absente` ou `différente` (nom, description, permission par défaut, options comparés) ; compte les commandes du serveur hors manifeste |
| `--execute` | un GET puis un POST d'upsert par commande du manifeste | crée ou met à jour ; jamais de PUT global, jamais de suppression, aucune commande hors manifeste touchée |

`--check` et `--execute` sont exclusifs ; tout autre argument est refusé. L'état « à créer / à mettre à jour / inchangé » n'est connu que par `--check` (la simulation n'a pas de réseau). Avant tout appel, chaque entrée du manifeste est validée (nom en minuscules de 1 à 32 caractères, description de 1 à 100, `default_member_permissions` nul ou numérique, options, pas de doublon de nom) : une entrée invalide arrête le script sans appel réseau. Le script refuse de tourner si `TOWER_DISCORD_GUILD_ID` n'est pas le serveur The Tower attendu. Il n'affiche jamais de secret, seulement le statut HTTP et le code Discord numérique.

## `/gamenight setup`

Incluse : le manifeste la déclare (`/gamenight` avec la seule sous-commande `setup`, permission « Gérer le serveur » = 32) et le script l'envoie telle que déclarée, sans modifier son comportement ni son handler (`COMMUNITY_SETUP_COMMAND_ENABLED` reste le seul interrupteur côté application ; éteint, la commande répond comme avant). Point d'attention : `scripts/register-discord-commands.mjs` enregistre cette même commande par la route globale. Si elle est déjà globale, la copie de serveur apparaît en double dans The Tower. Lire `--check` (qui ne regarde que le serveur) avec cela en tête et ne pas supprimer la commande globale sans décision du propriétaire.

## Lien d'invitation

Remplacer les deux valeurs par celles de l'environnement serveur autorisé (`DISCORD_CLIENT_ID`, `TOWER_DISCORD_GUILD_ID`) ; ne jamais les copier dans un fichier du dépôt ni dans `.env.example`.

```
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=395137076240&guild_id=<TOWER_DISCORD_GUILD_ID>&disable_guild_select=true
```

`permissions=395137076240` est le masque de `SETUP_PERMISSIONS` dans `src/lib/discord-setup-permissions.ts` : Gérer les salons, Voir les salons, Envoyer des messages, Intégrer des liens, Voir l'historique, Gérer les fils, Créer des fils publics, Créer des fils privés, Envoyer des messages dans les fils. L'invitation doit être validée par un compte qui a « Gérer le serveur » sur The Tower. Réinviter une application déjà présente ne retire rien ; cela ajoute le scope manquant.

## Procédure

Dans un environnement autorisé qui possède déjà `DISCORD_CLIENT_ID`, `DISCORD_BOT_TOKEN` et `TOWER_DISCORD_GUILD_ID` :

1. Inviter l'application avec le lien ci-dessus (scope `applications.commands`).
2. `node scripts/register-tower-guild-commands.mjs` : simulation, aucun appel réseau ; relire le plan.
3. `node scripts/register-tower-guild-commands.mjs --check` : lecture seule, état de chaque commande. Un 403 `50001` signifie : réinviter, puis relancer `--check`.
4. Après accord du propriétaire : `node scripts/register-tower-guild-commands.mjs --execute`.
5. `node scripts/register-tower-guild-commands.mjs --check` : toutes les commandes doivent être `présente`. Tester ensuite avec un compte membre et un compte modérateur. Ne pas activer `TOWER_CHALLENGES_ENABLED` avant un test complet.

En cas d'échec : noter uniquement le statut et le code, ne pas réessayer en boucle (429 possible). Si aucun environnement autorisé n'est disponible, l'enregistrement reste à faire : ne pas prétendre que les commandes sont visibles.

## Diagnostic des refus

| HTTP / code | Cause | Action |
|---|---|---|
| 403 / `50001` (Missing Access) | Application non autorisée sur le serveur avec le scope `applications.commands` (cause la plus probable) | Réinviter avec le lien ci-dessus |
| 401 | Jeton absent, régénéré, ou d'une autre application | Vérifier `DISCORD_BOT_TOKEN` côté serveur |
| 403 sans `50001` | `DISCORD_CLIENT_ID` d'une autre application que celle du jeton, ou application non installée | Vérifier que l'ID d'application et le jeton viennent du même portail développeur |
| 404 | Identifiant d'application ou de serveur incorrect | Vérifier `DISCORD_CLIENT_ID` et `TOWER_DISCORD_GUILD_ID` |
| 429 | Limite de débit | Attendre, ne pas boucler |
| 50013 | Permission manquante | Contrôler les permissions du bot |

Si le corps de la réponse n'est pas du JSON, le code affiché est `indisponible`.

## Commandes

Définies dans `scripts/discord-commands.json` (état de `main`), toutes enregistrées par le script, dans cet ordre :

| Commande | Sous-commandes | Permission par défaut |
|---|---|---|
| `/gamenight` | setup | « Gérer le serveur » (`default_member_permissions` = 32) |
| `/tower` | defi, progression, classement, vote, equipe | aucune restriction (tous les membres) |
| `/tower-admin` | ajouter, defis, desactiver, importer, importer-equipe | « Gérer le serveur » (32) |
| `/equipe` | liste, moi, rejoindre | aucune restriction |
| `/role` | chercher, attribuer, creer, retirer | aucune restriction |
| `/aide` | aucune | aucune restriction |
| `/profil` | aucune | aucune restriction |
| `/boost` | aucune | aucune restriction |
| `/joueurs` | annonces, chercher, mes-annonces, publier, retirer | aucune restriction |
| `/soiree` | liste, voir, creer, rejoindre, quitter | aucune restriction |
| `/tournoi` | liste, voir, inscription, desinscription, mes-inscriptions | aucune restriction |

`/projet` n'est pas dans le manifeste de `main` : elle sera enregistrée dès qu'elle y sera déclarée, sans changement du script. Le test `src/lib/discord-commands-manifest.test.ts` garde l'alignement manifeste ↔ routage (`src/lib/discord-interactions.ts`) : une commande déclarée sans handler, ou routée sans déclaration, fait échouer la CI. Les droits réels des commandes sans restriction de permission sont vérifiés par leurs handlers (membre actif, flags), pas par Discord.
