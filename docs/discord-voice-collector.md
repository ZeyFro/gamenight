# Collecteur vocal Discord

Le worker de présence est lancé par `src/instrumentation.ts` dans le serveur Next.js auto-hébergé en runtime Node, seulement lorsque `VOICE_PRESENCE_WORKER_MODE=standalone` est explicitement défini. Les instances web ordinaires laissent ce paramètre absent; Vercel et le runtime Edge sont toujours exclus. L'import du runtime et de Prisma reste différé jusqu'au passage des contrôles d'environnement.

Le démarrage exige `DISCORD_BOT_TOKEN` et des références non vides dans `VOICE_PRESENCE_CONSENT_DECISION` et `VOICE_PRESENCE_RETENTION_DECISION`. Elles restent vides dans `.env.example`. Ces variables sont seulement un verrou de prérequis : le code ne choisit ni n'implémente une politique de consentement ou de rétention. Ne les renseigner qu'après que ces décisions et leur application dans le produit ont été définies. Aucune activation ou collecte réelle n'a été faite.

Toutes les 15 secondes par défaut, le worker recherche les sessions `SCHEDULED` dont la date est atteinte, rattachées à une communauté `ACTIVE` qui a un salon `VOICE` actif. Il ouvre un collecteur par session. Il s'arrête lorsqu'une session sort de cet ensemble. `markSessionDone` et `cancelSession` ferment aussi le collecteur avant leur transaction terminale; les écritures déjà lancées sont attendues. Une erreur de la requête de découverte, de persistance ou une erreur Gateway fatale arrête le worker et termine le processus avec un code d'erreur; systemd le redémarre et conserve les messages dans le journal du service.

À la première synchronisation Gateway, les membres déjà présents sont enregistrés à l'heure observée avec `partial=true`. L'arrêt ferme les visites encore ouvertes en intervalles partiels et attend les écritures. Après un arrêt brutal, l'intervalle antérieur au crash ne peut pas être reconstruit; au redémarrage, les membres encore présents recommencent à l'heure de la nouvelle synchronisation, en partiel. Les reprises Gateway temporaires gardent la session Gateway et rejouent les événements depuis le dernier numéro de séquence.

## Hôte Raspberry Pi

Le paquet fournit `packaging/systemd/gamenight.service`. Cette unité est le processus auto-hébergé dédié qui sélectionne le mode `standalone`; elle lance `scripts/gamenight-server.mjs`, un serveur utilisant l'API publique Next.js sur `127.0.0.1:3000`. À réception de SIGINT ou SIGTERM, ce lanceur ferme les admissions HTTP et attend les requêtes en cours, le flush du worker puis la fermeture de Next avant de terminer. Il conserve un code d'erreur déjà posé et termine en erreur si cet arrêt échoue. L'arrêt reste limité par `TimeoutStopSec=45s` : un flush bloqué au-delà peut être tué par systemd.

Utiliser ce lanceur pour la collecte autonome : `npm start` / `next start` ne coordonnent pas le flush du worker avec leur propre fermeture.

Un reverse proxy local est à configurer séparément si l'application doit être accessible sur le réseau. L'unité ne contient aucun secret; elle lit l'environnement complet de l'application depuis `/etc/gamenight/gamenight.env` et redémarre après un échec, avec au plus cinq démarrages en 300 secondes. Une fois cette limite atteinte, une intervention est nécessaire pour corriger la cause puis relancer le service; aucun watchdog de collecte ni alerte automatique n'est fourni. `systemctl status gamenight` et `journalctl -u gamenight` permettent de superviser le processus.

Prérequis avant une mise en service locale :

- un Raspberry Pi Linux ARM64 avec Node.js 22.15 ou plus récent pour la parité avec le dépôt et sa CI;
- les dépendances de production et le build Next.js préparés pour cette architecture;
- une base PostgreSQL accessible via `DATABASE_URL`, avec les migrations requises appliquées par la procédure de déploiement déjà approuvée;
- un fichier `/etc/gamenight/gamenight.env` lisible seulement par l'utilisateur du service, contenant les variables d'application habituelles et `DISCORD_BOT_TOKEN`;
- les choix de consentement et de rétention définis et implémentés avant de renseigner leurs références ou d'activer le flag.

Le script `npm run build` du dépôt lance `prisma migrate deploy` avant la compilation hors Preview. Ne pas l'exécuter contre une base de production dans le cadre de la préparation du Pi; appliquer les migrations uniquement par le processus de déploiement approuvé. Le lanceur du service ne lance pas de migration.

La mise en service doit être préparée avec le flag et les deux références de décision laissés vides. Aucun accès Pi, installation, appel Discord réel ou test de collecte n'a été effectué pour ce changement.
