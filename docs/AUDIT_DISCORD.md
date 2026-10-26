# Audit local du serveur Discord

Le script `scripts/audit-discord-guild.mjs` produit un inventaire JSON et CSV du serveur The Tower (`553922938101825536`) en requêtes Discord REST `GET`. Il sert aussi de cœur à la route temporaire décrite plus bas.

## Contenu et limites

L'outil lit les paramètres généraux du serveur, les rôles, les salons (dont les catégories), les permissions de rôles sur les salons, les événements planifiés, ainsi que le widget, l'écran d'accueil, l'onboarding et les règles AutoMod lorsque Discord les rend accessibles.

Il n'appelle aucune route de membre, de message, de journal d'audit, d'invitation ou de webhook. Il retire les identifiants de membres des permissions individuelles et ne conserve que leur nombre. Les textes libres (sujets, descriptions, prompts, réponses, critères AutoMod et messages personnalisés) sont omis; seuls certains indicateurs de présence et nombres sont gardés. Les noms des salons, rôles et événements, leurs identifiants, et les paramètres techniques du serveur figurent dans le rapport.

Les suggestions `keep`, `merge`, `archive`, `review` et `delete` sont des pistes de revue. Aucune suppression n'est recommandée. Une proposition de fusion fondée sur un nom identique ne tient pas compte des attributions de rôles aux membres ni de l'activité ou du contenu des salons; un administrateur doit la vérifier manuellement. Les routes optionnelles refusées (403/404) sont signalées comme indisponibles. Les cellules CSV commençant comme une formule sont neutralisées pour éviter leur exécution par un tableur.

## Exécution sécurisée

Le script local est utile quand un opérateur peut fournir `DISCORD_BOT_TOKEN` au processus par un moyen sécurisé. `vercel env run` ne peut pas injecter les valeurs sensibles de Production dans cette configuration; `vercel env pull` écrirait les secrets sur disque et ne doit pas être utilisé pour cet audit.

### Route temporaire côté serveur (non déployée)

La route `GET /api/admin/discord-audit?format=json` ou `?format=csv` réutilise `scripts/audit-discord-guild.mjs`. Chaque URL lance un nouvel audit REST, puis télécharge directement le format choisi; aucun rapport n'est conservé par le serveur. La réponse contient uniquement paramètres généraux, rôles, catégories/salons, permissions de rôles et événements. Les réglages d'accueil et AutoMod sont retirés de cette réponse.

`requireAdmin()` valide la session et le rôle plateforme existant (`User.role=ADMIN` ou `ADMIN_DISCORD_IDS`). La route ajoute `DISCORD_GUILD_AUDIT_ENABLED=true` et un identifiant correspondant dans `DISCORD_GUILD_AUDIT_ADMIN_IDS`; les deux valeurs sont désactivées/vides par défaut. Les requêtes d'origine cross-site sont refusées, les réponses sont `no-store`, et un administrateur non inscrit reçoit 404. L'ID de l'administrateur sert uniquement à la garde et n'est jamais rendu dans le rapport.

Pour une mise en service contrôlée, après validation explicite et déploiement du SHA examiné, ajouter temporairement en Production `DISCORD_GUILD_AUDIT_ENABLED=true` et `DISCORD_GUILD_AUDIT_ADMIN_IDS=<discordId de l'opérateur>`. Ne pas modifier `DISCORD_BOT_TOKEN`. Depuis une session GameNight de cet administrateur, ouvrir successivement les URL JSON et CSV ci-dessus; chacune déclenche une lecture distincte. Vérifier les deux téléchargements, puis désactiver le drapeau ou retirer les deux réglages.

Après récupération, retirer complètement la capacité temporaire dans une PR distincte : supprimer `src/app/api/admin/discord-audit/route.ts` et son test, enlever les deux lignes de `.env.example` et cette section du guide, puis déployer le SHA de retrait après validation. Ne pas supprimer le script local `scripts/audit-discord-guild.mjs`, qui est l'outil réutilisable hors serveur.

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
npx vitest run src/app/api/admin/discord-audit/route.test.ts src/lib/api-routes-auth.test.ts src/lib/discord-audit.test.ts
```

L'outil ne modifie pas le serveur. Les recommandations sont des données de travail locales; toute opération de réorganisation doit être décidée et effectuée séparément dans Discord.
