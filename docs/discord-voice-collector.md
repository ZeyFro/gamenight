# Collecteur vocal Discord (préparatoire)

Le noyau `src/lib/discord-voice-gateway.ts` utilise le WebSocket natif de Node, les heartbeats, les séquences Gateway et `RESUME`. Il écoute uniquement `GUILD_VOICE_STATES` avec `GUILDS`; il n'active pas `GUILD_PRESENCES` ni `GUILD_MEMBERS`. La connexion initiale récupère l'URL recommandée auprès de `/gateway/bot`.

La configuration utilise `VOICE_PRESENCE_ENABLED` (seule la valeur exacte `true` active), `VOICE_PRESENCE_GUILD_ID`, `VOICE_PRESENCE_CHANNEL_IDS` et `VOICE_PRESENCE_SESSION_ID`, avec le `DISCORD_BOT_TOKEN` existant. Le collecteur intégré refuse de démarrer si la soirée n'est pas explicitement associée à une seule session.

À la première synchronisation, les membres déjà présents commencent à l'heure de l'observation et les intervalles sont marqués `partial`. Une reprise valide rejoue les événements après le dernier numéro de séquence. Ces événements n'ont pas d'heure de transition exploitable : pendant le replay, ils reconstruisent seulement l'état, sans produire de durée. À `RESUMED`, les visites encore présentes recommencent à l'heure d'observation, marquées partielles. Les visites ouvertes avant la coupure sont abandonnées, même pour leur portion antérieure à la coupure : les totaux sont incomplets, aucune durée du trou n'est inventée. Les doublons de séquence sont ignorés.

Une session invalide, un numéro de séquence inutilisable ou `GUILD_DELETE` détruit l'état en mémoire et signale une lacune. Un serveur redevenu disponible repart de son instantané `GUILD_CREATE`, partiel. Les codes de fermeture indiquant une configuration ou une authentification invalide arrêtent les tentatives et remontent le code sans le jeton. Les arrêts SIGINT/SIGTERM ferment la socket et signalent une lacune pour les visites encore ouvertes.

Le pont GameNight convertit un intervalle en secondes et l'associe à la session configurée seulement si la communauté, le guild Discord, le salon VOICE actif, l'état `SCHEDULED`, la date de début et l'invitation active/créateur correspondent. L'appartenance `Membership ACTIVE` à cette communauté est exigée même avec l'isolation désactivée. La date de soirée est comparée dans l'horloge murale Paris du projet (été/hiver); l'heure de début de l'intervalle conserve l'instant UTC réel. Les lignes idempotentes conservent l'utilisateur GameNight, le salon, l'heure de début, la durée et l'indicateur partiel. Seul le créateur de la soirée peut voir les totaux; l'accès passe aussi par `getSessionAccessRole`. La migration est additive et n'a été appliquée à aucune base distante.

La configuration d'exemple laisse le flag vide, donc désactivé. Le périmètre, le consentement et la rétention/suppression restent à décider : le modèle ne fixe pas de durée de conservation. Ce chantier reste en Draft. Aucun hôte durable ni démarrage réel n'a été configuré. Une erreur de découverte Gateway est retentée avec délai exponentiel plafonné; les tests utilisent seulement des membres et sockets synthétiques. Le pont requiert un callback d'erreur et `stop()` attend les écritures déjà lancées.

## Préparation de la machine persistante

Le point d'entrée est `scripts/discord-voice-collector.mjs`. Il réutilise les modules du dépôt et le WebSocket de Node, sans nouvelle dépendance. Utiliser Node 24.12+ (vérifié localement sur 24.20); les hooks de résolution et le stripping TypeScript existent aussi sur Node 22 récent, qui reste à vérifier pour ce lancement. Aucun matériel ni hébergement payant n'est imposé : une machine existante allumée pendant les soirées convient si elle peut héberger un processus durable. Un appel HTTP ou un cron périodique ne remplace pas ce processus.

Préparer un checkout propre et son client Prisma généré correspondant au schéma vocal. La génération se fait dans les dépendances propres à ce checkout, jamais dans un `node_modules` partagé. La migration de la base choisie est une étape distincte soumise à la revue prévue; `--check` ne l'applique pas et ne vérifie pas le schéma distant.

```sh
node scripts/discord-voice-collector.mjs --check
```

C'est aussi le mode par défaut sans argument. Flag désactivé : sortie `disabled` sans connexion. Flag activé et configuration complète : chargement des modules, contrôle du modèle Prisma généré et création du collecteur, puis sortie sans `start()`, requête SQL ou socket. La configuration privée du processus doit fournir les quatre variables vocales décrites plus haut, le jeton et sa connexion de base. Le script ne charge aucun fichier `.env` automatiquement et n'affiche aucune valeur de configuration.

Après les décisions et corrections bloquantes ci-dessous seulement, le lancement explicite serait :

```sh
node scripts/discord-voice-collector.mjs --run
```

Ce lancement exige en plus `VOICE_PRESENCE_APPROVED=true` dans l'environnement local du service. Ce garde-fou ne remplace ni le recueil du consentement ni la décision de rétention. Il n'a pas été activé pendant cette préparation. Ne pas configurer ce processus dans le démarrage de Next ou dans les previews Vercel. Une seule instance par association guild/salons/soirée est requise : plusieurs processus ne coordonnent pas leurs visites en mémoire.

Exemple de service Linux **à compléter et conserver inactif**; aucune commande d'installation/activation n'a été exécutée :

```ini
[Unit]
Description=GameNight vocal (préparation)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/chemin/checkout-gamenight
EnvironmentFile=/chemin/prive/gamenight-voice.env
ExecStart=/chemin/node scripts/discord-voice-collector.mjs --run
Restart=no
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Choisir un compte de service sans privilèges et restreindre la lecture du fichier privé. L'auto-redémarrage reste désactivé pour qu'un code fatal de configuration ne provoque pas une boucle de connexion. Les reconnexions transitoires sont gérées à l'intérieur du processus. Un gestionnaire de tâches équivalent peut lancer la même commande sur une machine Windows; aucun n'a été installé.

## Diagnostic hors ligne puis exploitation autorisée

Les journaux structurés donnent l'étape et la raison, sans jeton, identifiant membre ou contenu de salon :

| Journal | Interprétation / contrôle |
| --- | --- |
| `voice_startup_failed`, `arguments` | Argument accepté : aucun, `--check` ou `--run`. |
| `voice_startup_failed`, `local_approval` | L'approbation locale explicite manque; rester en préparation. |
| `voice_startup_failed`, `database_configuration` | Connexion de base absente; ne pas la tester sur une base distante. |
| `voice_startup_failed`, `module_load` | Vérifier Node, les dépendances et le format de la configuration locale. |
| `voice_startup_failed`, `generated_client` | Le client généré ne contient pas le modèle vocal; le générer dans ce checkout isolé. |
| `voice_startup_failed`, `collector_configuration` | Vérifier guild/salons/session explicites et IDs Discord valides. |
| `voice_status`, `discovery_retry` | Découverte HTTP échouée; nouvelle tentative avec délai exponentiel plafonné à 30 s. |
| `voice_status`, `ready` / `resumed` | Identification reçue / replay terminé. `started` seul ne prouve pas la synchronisation du serveur. |
| `voice_status`, `reconnecting` | Socket fermée, tentative planifiée; surveiller la répétition et les lacunes. |
| `voice_gap` | `transport_closed`, `resume_failed`, `guild_unavailable`, `shutdown` ou `fatal_close`; durée manquante non reconstruite. |
| `voice_fatal` | Code Gateway fatal; corriger la configuration avant tout redémarrage manuel. |
| `persistence failed; stopping` | Écriture perdue, arrêt avec code 1; aucune relance automatique d'une écriture incertaine. |

Un arrêt normal attend les écritures déjà engagées, puis déconnecte Prisma. Une coupure forcée/timeout peut perdre ces écritures. Les visites ouvertes ne sont pas enregistrées à l'arrêt; aucune durée fictive de fin n'est créée.

## Blocages d'activation et limites établies

- Décider les salons, les personnes concernées, le consentement, les destinataires des mesures, la durée de conservation et la suppression. Aucune collecte ne précède ces décisions.
- Fermer la course entre les vérifications communauté/membre/invitation/soirée et l'upsert : elles restent séparées. Une révocation déjà visible est filtrée, y compris isolation OFF; une révocation concurrente après lecture n'est pas garantie. Les tests unitaires ne prouvent pas cette atomicité.
- Définir la fin de mesure : si la soirée passe à `DONE` avant la sortie vocale, l'intervalle final est rejeté par le filtre `SCHEDULED`. Les passages de salon et sorties alimentent actuellement le stockage; aucun flush de fin de soirée n'existe.
- La découverte HTTP n'a pas encore de timeout/AbortSignal; l'arrêt invalide les résultats tardifs mais n'annule pas une requête déjà en vol.
- Les lacunes sont dans les logs; la page privée montre les totaux des seuls intervalles conservés et leur indicateur partiel. Elle ne constitue pas une preuve exhaustive de présence, d'absence ou d'activité. Aucun audio n'est enregistré.

Sources techniques : [reprise Gateway et fin de replay `RESUMED`](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx), [hooks Node](https://nodejs.org/api/module.html#moduleregisterhooksoptions), [exécution TypeScript native et limites des alias](https://nodejs.org/api/typescript.html).

## Vérification de cette préparation (20 octobre 2026)

Sept suites ciblées (`discord-voice-gateway`, `discord-voice-presence`, `session-voice-collector`, `session-voice-presence`, `session-voice-runner`, `community-scope`, `wallclock`) : 45 tests passés, aucun ignoré. Régressions constatées rouges puis vertes pour replay, indisponibilité du serveur, filtre de communauté isolation OFF et heures été/hiver. Lint des fichiers modifiés et `git diff --check` réussis.

Le client partagé initial ne contenant pas le modèle vocal, son refus `generated_client` a été vérifié. Le contrôle nominal a ensuite réussi avec le vrai client Prisma 6.19.3 généré dans une copie privée du runtime, sous Node 24.20. La configuration était synthétique et l'URL de base locale injoignable (`127.0.0.1:1`); des barrières sur `fetch`, `WebSocket` et `net.Socket.connect` ont compté **zéro tentative réseau**. Les 18 empreintes des fichiers du client généré partagé étaient inchangées après génération privée. Le warning Node `MODULE_TYPELESS_PACKAGE_JSON` est attendu à ce chargement TS; aucun changement global du type de package n'a été fait.

Aucun test PostgreSQL, parcours navigateur, connexion Gateway, bot réel ou environnement distant n'a été exécuté pour ce lot. Les courses de révocation et les décisions de consentement/rétention restent les blocages décrits ci-dessus.
