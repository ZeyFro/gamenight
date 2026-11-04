# Commandes Tower — enregistrement limité au serveur

**Serveur cible :** The Tower (`553922938101825536`). Les commandes ne doivent **pas** être créées globalement. Une définition dans `scripts/discord-commands.json` ne signifie pas qu'une commande est installée dans Discord.

Le script `scripts/register-discord-commands.mjs` existant utilise l'URL **globale** `/applications/{app}/commands`. **Ne pas l'utiliser** pour enregistrer les commandes Tower sur le serveur seulement.

Le nouveau `scripts/register-tower-guild-commands.mjs` utilise uniquement `/applications/{app}/guilds/{guild}/commands` et vérifie que le serveur configuré est The Tower. Il ne gère que `tower` et `tower-admin`, sans supprimer les autres commandes.

## Séquence

1. Vérifier que l'application/bot est bien installée sur le serveur avec le droit `applications.commands` et que l'identifiant application correspond à celui de GameNight.
2. Dans **un environnement d'exécution autorisé qui possède déjà les variables serveur** `DISCORD_CLIENT_ID`, `DISCORD_BOT_TOKEN` et `TOWER_DISCORD_GUILD_ID`, exécuter `node scripts/register-tower-guild-commands.mjs --check`. Cette commande est uniquement une lecture HTTP GET.
3. S'il faut enregistrer après validation du propriétaire, exécuter la même commande avec `--execute`. Deux POST d'upsert au plus ; aucune écriture globale et aucun effacement de commandes tierces.
4. Relancer `--check`, puis vérifier les commandes dans le serveur avec un compte membre et un compte modérateur. Ne pas activer `TOWER_CHALLENGES_ENABLED` avant un test complet.
5. En cas de HTTP 403, conserver uniquement le code d'erreur numérique retourné. Ne pas réessayer en boucle ; diagnostiquer l'installation, les droits `applications.commands` et l'identité de l'application.

Sans option, le script est une **simulation**, sans requête réseau ni besoin d'identifiant. Aucun jeton ne doit être imprimé, copié dans un ticket ou demandé à un utilisateur. Si aucun environnement autorisé ne permet son exécution, l'enregistrement reste **à faire** : ne pas prétendre que les commandes sont visibles.
