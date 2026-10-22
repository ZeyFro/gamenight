# Collecteur vocal Discord

La collecte reste désactivée tant que `VOICE_PRESENCE_ENABLED` n'est pas explicitement défini à `true`. Le worker ne démarre que dans un serveur Node auto-hébergé avec `VOICE_PRESENCE_WORKER_MODE=standalone`, un jeton Discord et les références de décision de consentement et de rétention. `.env.example` et l'unité systemd fixent le flag à `false` par défaut; un opérateur autorisé peut le remplacer dans l'EnvironmentFile. Vercel, le runtime Edge et les instances web ordinaires ne lancent pas le worker.

## Consentement, lecture et conservation

Chaque créateur ou invité actif donne son accord individuellement depuis le panneau de la soirée. Tant qu'il n'a pas consenti, le worker ne lance aucun collecteur pour cette soirée. Le participant ne voit que ses propres durées; le créateur de la soirée et les admins du site ou de sa communauté voient celles des personnes consentantes. Le panneau admin vocal ne donne accès qu'à ces données vocales et ne contourne pas la confidentialité de la page de soirée.

Retirer son consentement supprime immédiatement l'accord et les intervalles de cette personne, y compris après clôture pendant la rétention. Annuler une soirée supprime ses accords et intervalles dans la transaction qui marque l'annulation et efface immédiatement les bornes de lacune. Si aucun contrôle du worker n'existe, l'annulation n'en crée pas. Si un bail est encore valide, la commande `PURGE_REQUESTED` reste jusqu'à l'arrêt du worker ou son expiration; le nettoyage existant peut alors supprimer la commande orpheline pour une séance annulée. Si ce runner/cron ne s'exécute pas, cette ligne de contrôle peut rester, mais la séance annulée et l'absence de consentements empêchent de nouvelles écritures. À la clôture normale, la date de cutoff est écrite avec l'état de la soirée, sans attendre le worker; les intervalles persistés sont bornés à cette date. La finalisation asynchrone applique une conservation de 30 jours après le cutoff; les métadonnées de contrôle finalisées et purgées sont ensuite supprimées. Le nettoyage utilise le runner et le cron de rétention déjà présents, par lots bornés; cette PR n'ajoute ni n'active de cron.

## Coordination durable et reprise après crash

Vercel ne contacte pas le worker pendant une action de clôture. Dans la même transaction que le statut terminal, l'application écrit une commande `STOP_REQUESTED` avec le cutoff, ou `PURGE_REQUESTED` pour une annulation. Le worker unique revendique un bail SQL muni d'une génération; chaque intervalle vérifie le propriétaire, la génération, le consentement et le cutoff dans sa transaction. Un worker concurrent ou périmé ne peut donc pas continuer à écrire après la prise de bail.

Le worker vide ses écritures avant de finaliser la commande. Si le worker est arrêté ou perd son bail, la prochaine instance reprend la commande; la clôture du site est déjà effective. Un crash ne prolonge jamais un intervalle ouvert. Seuls les intervalles fermés et enregistrés sont conservés. Le processus ne persiste pas le tuple Gateway de reprise; au redémarrage il refait `Identify`. La lacune est signalée entre la dernière observation durable (heartbeat ou expiration du bail) et le premier état Gateway confirmé après reconnexion (`RESUMED` ou snapshot `GUILD_CREATE`). Aucune durée n'est estimée dans cette plage. Les observations issues d'un snapshot, qui n'a pas d'heure d'entrée, sont enregistrées comme partielles à partir de l'heure du snapshot.

Les lignes d'intervalle restent la seule source des durées affichées. Le panneau expose aussi la dernière plage de lacune connue et indique si une reprise a été confirmée; il ne transforme jamais cette plage en temps vocal.

## Préparation de l'hôte Raspberry Pi

Le paquet local comprend `packaging/systemd/gamenight.service` et `scripts/gamenight-server.mjs`. L'unité lance le serveur GameNight sur `127.0.0.1:3000` et utilise le mode worker autonome si les contrôles d'environnement autorisent le démarrage. Le lanceur traite SIGINT/SIGTERM, ferme l'admission HTTP, attend les requêtes actives, vide le worker puis ferme Next.js. L'arrêt systemd est limité à 45 secondes. Les erreurs fatales font échouer le processus pour permettre son redémarrage par systemd; aucun watchdog ou avis automatique n'est fourni.

Le lanceur fourni doit être utilisé pour l'hôte worker : `npm start` / `next start` ne coordonnent pas son flush à l'arrêt. Un reverse proxy local est à configurer séparément si l'application doit être joignable depuis le réseau. L'unité ne contient aucun secret; elle lit les variables de l'application dans `/etc/gamenight/gamenight.env`, lisible seulement par l'utilisateur du service. Garder `VOICE_PRESENCE_ENABLED` et les références de décision vides jusqu'à leur mise en service autorisée.

Prérequis techniques avant toute installation locale :

- Raspberry Pi Linux ARM64 avec Node.js 22.15 ou plus récent, pour correspondre au dépôt et à la CI;
- dépendances de production et build Next.js préparés pour cette architecture;
- PostgreSQL accessible par `DATABASE_URL`, et migrations appliquées par le processus de déploiement approuvé;
- environnement applicatif complet dans `/etc/gamenight/gamenight.env`, avec droits limités et jeton Discord ajouté par l'opérateur hors du dépôt.

`npm run build` lance `prisma migrate deploy` avant la compilation hors Preview. Ne pas lancer le build contre une base de production pour préparer le Pi; appliquer les migrations uniquement par la procédure de déploiement approuvée. Le service ne lance pas lui-même les migrations.

Aucune migration ni connexion Production, installation Raspberry, activation de flag/cron, connexion au Gateway réel ou notification Discord n'a été effectuée pour ce lot.
