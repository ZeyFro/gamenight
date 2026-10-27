# Audit local du serveur Discord

Le script `scripts/audit-discord-guild.mjs` produit un inventaire JSON et CSV du serveur The Tower (`553922938101825536`) en requêtes Discord REST `GET`.

## Contenu et limites

L'outil lit les paramètres généraux du serveur, les rôles, les salons (dont les catégories), les permissions de rôles sur les salons, les événements planifiés, ainsi que le widget, l'écran d'accueil, l'onboarding et les règles AutoMod lorsque Discord les rend accessibles.

Il n'appelle aucune route de membre, de message, de journal d'audit, d'invitation ou de webhook. Il retire les identifiants de membres des permissions individuelles et ne conserve que leur nombre. Les textes libres (sujets, descriptions, prompts, réponses, critères AutoMod et messages personnalisés) sont omis; seuls certains indicateurs de présence et nombres sont gardés. Les noms des salons, rôles et événements, leurs identifiants, et les paramètres techniques du serveur figurent dans le rapport.

Les suggestions `keep`, `merge`, `archive`, `review` et `delete` sont des pistes de revue. Aucune suppression n'est recommandée. Une proposition de fusion fondée sur un nom identique ne tient pas compte des attributions de rôles aux membres ni de l'activité ou du contenu des salons; un administrateur doit la vérifier manuellement. Les routes optionnelles refusées (403/404) sont signalées comme indisponibles. Les cellules CSV commençant comme une formule sont neutralisées pour éviter leur exécution par un tableur.

## Exécution sécurisée

Le script local est utile quand un opérateur peut fournir `DISCORD_BOT_TOKEN` au processus par un moyen sécurisé. `vercel env run` ne peut pas injecter les valeurs sensibles de Production dans cette configuration; `vercel env pull` écrirait les secrets sur disque et ne doit pas être utilisé pour cet audit.

### Utilisation locale hors Vercel

Si le jeton est fourni par un gestionnaire de secrets local approuvé, sans affichage ni fichier `.env`, la commande du guide initial reste :

```powershell
npm ci
node scripts/audit-discord-guild.mjs --guild-id 553922938101825536 --out .private-audit/discord
```

Le script lit `DISCORD_BOT_TOKEN` en mémoire uniquement. Ne lancez pas `vercel env pull`, n'affichez pas la variable et ne passez pas sa valeur en argument.

Le bot doit être présent sur le serveur et disposer de l'accès de lecture correspondant. Le script échoue sans le jeton ou si l'identifiant cible diffère. Le dossier `.private-audit/` est ignoré par Git; les fichiers sont créés sans écrasement et avec des permissions locales restrictives lorsque le système les prend en charge. Gardez-les sur un poste approuvé, ne les commitez pas et ne les joignez pas à un ticket ou service externe. Limitez aussi les copies, sauvegardes et captures d'écran selon les règles de votre organisation.

Les tests simulés n'appellent jamais Discord :

```powershell
npx vitest run src/lib/discord-audit.test.ts
```

L'outil ne modifie pas le serveur. Les recommandations sont des données de travail locales; toute opération de réorganisation doit être décidée et effectuée séparément dans Discord.
