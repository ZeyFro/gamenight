# Livraison du worker vocal : installation reproductible, sans activation

Ce document prépare l'installation du worker vocal sur un hôte auto-hébergé (Raspberry Pi ou autre). Il n'installe rien, n'active rien et ne se connecte à aucun service. Le détail du fonctionnement (consentement, bail, lacunes, rétention) est dans `docs/discord-voice-collector.md`.

## Trois autorisations séparées

Chaque étape exige sa propre décision explicite du propriétaire. Aucune n'implique les autres.

| # | Autorisation | Ce qu'elle permet | Ce qu'elle ne permet pas |
|---|--------------|-------------------|--------------------------|
| 1 | **Migration vocale** | Appliquer les 4 migrations additives vocales (avec les 2 XP/boutique) par la procédure de migration approuvée, AVANT le code. | Installer ou démarrer le worker, allumer le drapeau. |
| 2 | **Installation du worker** | Préparer l'hôte, installer l'image ou l'unité, créer le fichier d'environnement privé, démarrer le service COLLECTE ÉTEINTE (`VOICE_PRESENCE_ENABLED=false`). | Se connecter au Gateway Discord, collecter, appliquer la migration. |
| 3 | **Activation de la collecte** | Mettre `VOICE_PRESENCE_ENABLED=true`, fournir jeton et références de décision (consentement, rétention), redémarrer. | Rien d'autre : sans accord individuel dans le panneau de la soirée, aucun collecteur n'est lancé. |

Tant que l'autorisation 3 n'est pas donnée, le code ne touche aucune table vocale (voir « Ordre de déploiement » dans le runbook).

## Permissions Discord strictement nécessaires (déduites du code)

Source : `src/lib/discord-voice-gateway.ts` (Identify avec `intents: 1 | 128`) et `src/lib/session-voice-presence.ts`.

- **Intents Gateway** : `GUILDS` (1) et `GUILD_VOICE_STATES` (128). Rien d'autre.
- **Aucun intent privilégié** : ni `MESSAGE_CONTENT` (aucune lecture de contenu de message), ni `GUILD_MEMBERS`, ni `GUILD_PRESENCES`. Rien à activer dans la section « Privileged Gateway Intents » du portail développeur.
- **Permission de salon** : `View Channel` (Voir le salon) sur les salons vocaux surveillés, pour recevoir leurs `VOICE_STATE_UPDATE`. Pas de `Connect`, pas de `Speak` : le worker ne rejoint jamais un salon vocal et ne reçoit aucun audio.
- **API REST** : un seul appel, `GET /gateway/bot`, avec le jeton du bot.
- Le bot est celui déjà utilisé par l'application (`DISCORD_BOT_TOKEN`) : ne pas lui ajouter de permission pour le vocal au-delà de `View Channel` sur les salons concernés.

## Configuration privée (noms seulement)

| Nom | Quand | Rôle |
|-----|-------|------|
| `DATABASE_URL` | démarrage | Base de données (le client de production passe par l'adaptateur Neon, `src/lib/prisma.ts` : l'URL doit lui convenir). |
| `VOICE_PRESENCE_ENABLED` | démarrage | Doit valoir exactement `false` jusqu'à l'autorisation 3. Une seule ligne. |
| `VOICE_PRESENCE_WORKER_MODE` | fixé par l'unité / le compose | `standalone` ; ne pas le définir sur les instances web. |
| `DISCORD_BOT_TOKEN` | activation | Jeton du bot. |
| `DISCORD_BOT_GUILD_ID` | activation | Serveur de la communauté par défaut. |
| `VOICE_PRESENCE_CONSENT_DECISION` | activation | Référence de la décision de consentement. |
| `VOICE_PRESENCE_RETENTION_DECISION` | activation | Référence de la décision de rétention. |
| `AUTH_SECRET`, `CRON_SECRET` | activation | Repris du compose existant. |
| `VOICE_PRESENCE_POLL_INTERVAL_MS` | optionnel | Poll, minimum 5000, défaut 15000. |
| `VOICE_WORKER_SHUTDOWN_TIMEOUT_MS` | optionnel | Arrêt propre, 1000 à 600000, défaut 40000 (garder sous 45 s). |

Règles :

- Le fichier d'environnement est créé **localement par le propriétaire, sur l'hôte**, `root:root`, mode `0600` (`/etc/gamenight/gamenight.env`). Il n'est jamais écrit dans le dépôt, jamais collé dans une conversation, un ticket ou un journal. `docker inspect` affiche l'environnement : ne jamais en copier la sortie.
- Le modèle sans valeurs est `docker/voice-worker/voice-worker.env.example` (noms uniquement).
- Contrôle sans exposer de valeur : `node scripts/voice-host-diagnostic.mjs` (voir plus bas).

## Procédure pas à pas

Toutes les commandes sont à lancer par le propriétaire, sur l'hôte, sauf mention contraire. Étapes 1 à 3 : sans effet sur Discord ni sur la base.

### 1. Hôte : diagnostic en lecture seule

Depuis une copie du dépôt sur l'hôte (le script n'écrit rien, ne se connecte à aucune base ni à Discord, ne fait que résoudre `gateway.discord.gg` et `discord.com` en DNS) :

```sh
sudo node scripts/voice-host-diagnostic.mjs            # sudo : pour lire les NOMS du fichier d'environnement
sudo node scripts/voice-host-diagnostic.mjs --json     # même chose, lisible par un outil
```

Il contrôle : Node (>= 22.15.0), Docker, architecture, mémoire et disque libres, synchronisation de l'horloge (`timedatectl`), unité systemd, image, permissions du fichier d'environnement (`0600`, `root:root`), noms de variables présents ou absents, `VOICE_PRESENCE_ENABLED` défini une fois et éteint, résolution DNS. Codes de sortie : `0` aucun échec, `1` au moins un échec, `2` usage (toute option d'écriture est refusée). Avant l'étape 3, `env-fichier` en échec est normal. Corriger tout autre `FAIL` avant de continuer.

### 2. Voie A : conteneur (compose)

```sh
docker compose -f docker/voice-worker/compose.yaml config -q          # syntaxe, doit sortir 0 sans rien afficher
docker compose -f docker/voice-worker/compose.yaml build voice-worker # construit gamenight-voice-worker:local (non publiée)
```

`build` ne contient aucun secret et n'utilise pas `npm run build` (qui lancerait `prisma migrate deploy`).

### 2. Voie B : unité systemd

La procédure complète (comptes `gamenight` / `gamenight-build`, build sans `DATABASE_URL`, copie dans `/opt/gamenight/current`, installation de l'unité) est dans `docs/discord-voice-collector.md`, sections « Préinspection SSH en lecture seule » et « Préparation et installation, sans démarrage ». Elle se termine par :

```sh
sudo systemd-analyze verify /etc/systemd/system/gamenight.service
sudo systemctl daemon-reload
```

`daemon-reload` n'active ni ne démarre l'unité.

### 3. Fichier d'environnement privé

```sh
sudo install -d -o root -g root -m 0750 /etc/gamenight
sudo install -o root -g root -m 0600 /dev/null /etc/gamenight/gamenight.env
sudoedit /etc/gamenight/gamenight.env     # noms du modèle ; saisir les valeurs à la main ; laisser VOICE_PRESENCE_ENABLED=false
sudo node scripts/voice-host-diagnostic.mjs
```

Attendu : `env-permissions` `ok`, `var:DATABASE_URL` `ok`, `collecte-eteinte` `ok`. Les variables d'activation restent `info` (absentes) tant que l'autorisation 3 n'est pas donnée. Pour le compose, passer ce fichier avec `--env-file /etc/gamenight/gamenight.env` (lisible par root seulement : lancer `docker compose` via `sudo`).

### 4. Vérifications à sec (collecte éteinte)

Rien ne doit se connecter à Discord. Avant de démarrer :

```sh
sudo grep -Ec '^[[:space:]]*VOICE_PRESENCE_ENABLED=' /etc/gamenight/gamenight.env   # attendu : 1
sudo grep -qx 'VOICE_PRESENCE_ENABLED=false' /etc/gamenight/gamenight.env && echo "collecte éteinte"
```

Vérifier que l'autorisation 1 (migration) a été donnée et appliquée avant d'aller plus loin.

### 5. Démarrage supervisé (autorisation 2 requise)

```sh
# Voie B (systemd)
sudo systemctl enable gamenight.service
sudo systemctl start gamenight.service
sudo systemctl is-active --quiet gamenight.service && echo actif
journalctl -u gamenight.service -n 50 --no-pager
ss -ltn | grep '127.0.0.1:3000'

# Voie A (compose)
sudo docker compose -f docker/voice-worker/compose.yaml --env-file /etc/gamenight/gamenight.env up -d voice-worker
docker inspect --format '{{.State.Health.Status}}' gamenight-voice-voice-worker-1   # nom à confirmer avec `docker ps`
```

`enable` et `start` restent séparés (jamais `--now`). Collecte éteinte, le worker ne démarre pas (`voicePresenceWorkerConfig` renvoie `null`), seul le serveur web tourne : c'est le résultat attendu.

### 6. Contrôle de redémarrage

Qui redémarre et jusqu'où :

| Supervision | Politique | Plafond | Signal d'alerte |
|-------------|-----------|---------|-----------------|
| systemd | `Restart=on-failure`, `RestartSec=5s` | `StartLimitBurst=5` en 300 s | unité `failed` (« start request repeated too quickly ») ; `systemctl is-failed gamenight.service` |
| Docker | `restart: unless-stopped`, délai croissant du démon plafonné à 1 min | aucun plafond de tentatives ; `restart: on-failure:5` pour en imposer un | `docker ps -a`, `docker inspect --format '{{.RestartCount}}'` |

Dans le processus, une base indisponible n'entraîne plus de crash immédiat (sauf au démarrage, volontairement strict) : après un premier poll réussi, 7 échecs de découverte consécutifs sont tolérés (le 8e est fatal) avec un délai doublé (15, 30, 60, 120, 240, 300, 300 s avec le poll de 15 s, soit environ 17 minutes cumulées). Journal, sans URL ni jeton ni détail d'erreur :

```
[voice-presence] database unavailable (attempt 3/8); next attempt in 60s
[voice-presence] database available again after 3 failed attempt(s)
```

Au 8e échec consécutif, fatal `discovery` : le worker s'arrête proprement (collecteurs fermés, bail libéré), journalise `fatal worker error (discovery); service will restart` et sort avec le code **1**, que systemd ou Docker relancent selon le tableau ci-dessus. Si une base coupée surprend un collecteur actif, la première écriture d'intervalle qui échoue est fatale (code 1) : les intervalles ouverts sont perdus par conception, le bail expire et la prochaine instance reprend en conservant une lacune.

Bail pendant une coupure longue : le bail dure 45 s et ne se renouvelle qu'au poll, donc un backoff supérieur à 45 s laisse expirer le bail. Un collecteur encore actif voit alors ses écritures refusées (intervalle non enregistré), ce qui est voulu : à la reprise, le poll réclame le bail (nouvelle génération), ouvre une lacune rétroactive depuis le dernier battement durable, fence l'ancien collecteur et la lacune se referme au premier état Gateway frais, sans créer de durée. Preuve : `voice-presence-lease-outage.integration.test.ts` (bail réclamé à un instant passé, aucune attente réelle).

Codes de sortie du lanceur `scripts/gamenight-server.mjs` : `0` arrêt propre ; `1` toute erreur fatale (démarrage du serveur, fatal du worker, arrêt échoué, second signal, délai d'arrêt dépassé).

Remise en route après un `failed` systemd, une fois la cause corrigée : `sudo systemctl reset-failed gamenight.service && sudo systemctl start gamenight.service`.

### 7. Arrêt propre

`SIGTERM` (`systemctl stop` ou `docker stop`) : fermeture de l'admission HTTP, fermeture des collecteurs (intervalles ouverts enregistrés, lacune `shutdown` notée), vidage des écritures, libération du bail, fermeture de Next.js, sortie `0`.

- Délai : `VOICE_WORKER_SHUTDOWN_TIMEOUT_MS` (défaut 40 s) puis sortie 1 ; `TimeoutStopSec=45s` (systemd) et `stop_grace_period: 45s` (compose) laissent 5 s de marge. Si le délai applicatif est augmenté, augmenter les deux.
- Un second signal force la sortie immédiate (code 1) : les écritures non vidées sont perdues, le bail expire seul.

```sh
sudo systemctl stop gamenight.service
systemctl show gamenight.service -p Result -p ExecMainStatus     # attendu : Result=success, ExecMainStatus=0
# compose
docker compose -f docker/voice-worker/compose.yaml stop voice-worker
docker inspect --format '{{.State.ExitCode}}' <conteneur>         # attendu : 0
```

### 8. Retour arrière

1. Arrêt propre (étape 7).
2. Désactivation : `sudo systemctl disable gamenight.service` (ou `docker compose ... down`). Le code ne touche aucune table vocale tant que le drapeau n'est pas `true`.
3. Désinstallation de l'unité : `sudo rm /etc/systemd/system/gamenight.service && sudo systemctl daemon-reload`. Le fichier `/etc/gamenight/gamenight.env` reste en place, à supprimer par le propriétaire s'il n'est plus utile. Image : `docker image rm gamenight-voice-worker:local`.
4. Les migrations vocales sont additives et ne se défont pas par ce retour arrière ; les données collectées expirent 30 jours après la clôture de la soirée.
5. Désactivation d'urgence de la collecte (autorisation 3 retirée) : `VOICE_PRESENCE_ENABLED=false` dans le fichier d'environnement puis redémarrage ; voir le runbook, « Désactivation d'urgence ».

## Preuves par comportement (tests existants et ajoutés)

Tous sans Discord réel : faux Gateway WebSocket local et Postgres jetable (`TEST_DATABASE_URL`).

| Comportement | Test |
|--------------|------|
| Consentement requis avant tout collecteur ou bail | `voice-presence-gateway-simulation.integration.test.ts` « ne se connecte pas sans opt-in… » ; `voice-presence-coordination.integration.test.ts` « does not claim a lease without non-expired consent » ; `voice-presence-worker-runtime.test.ts` « does not claim a lease or create a collector before individual opt-in » |
| Retrait du consentement en cours de collecte (intervalles supprimés, génération révoquée, worker fencé, socket fermée) | `voice-presence-gateway-simulation.integration.test.ts` « le retrait du consentement efface les durées, révoque la génération… » ; `session-voice-presence.integration.test.ts` « deletes the participant's rows on withdrawal… », « serializes a concurrent interval write and withdrawal… », « rejects a claimed target when consent is withdrawn before Gateway startup » |
| Purge à l'échéance (30 jours après le cutoff) | `voice-presence-gateway-simulation.integration.test.ts` « la clôture finalise… TTL fixe de 30 jours, puis la purge ne retire qu'après l'échéance » ; `voice-presence-coordination.integration.test.ts` « purges only expired voice intervals… », « purges canceled control tombstones and finalized gap metadata after 30 days » ; `voice-presence-stopat.integration.test.ts` |
| Purge d'une soirée annulée | `voice-presence-coordination.integration.test.ts` « purges existing consent and intervals in the cancellation transaction », « cleans an orphaned cancellation command… » ; `voice-presence-gateway-simulation.integration.test.ts` « l'annulation purge immédiatement accords et durées… » |
| Crash puis reprise (bail expiré, lacunes `SessionVoicePresenceGap`) | `voice-presence-coordination.integration.test.ts` « fences a second worker and records a gap when an expired lease is taken over », « retains each consecutive crash gap… » ; `voice-presence-gateway-simulation.integration.test.ts` « un redémarrage du worker ne persiste pas la session Gateway… » |
| Intervalles ouverts à l'arrêt | `voice-presence-gateway-simulation.integration.test.ts` « un arrêt propre avec une personne encore en vocal enregistre l'intervalle ouvert… » ; `discord-voice-gateway.test.ts` « flushes open visits as partial intervals on an orderly stop » |
| Un seul worker actif par bail | `voice-presence-coordination.integration.test.ts` (réclamation concurrente : une seule gagne) ; `voice-presence-worker-runtime.test.ts` « refuse un second runtime dans le même processus » (ajouté) |
| Drapeau éteint, base sans tables vocales | `voice-presence-flag-off.integration.test.ts` (7 tests) |
| Base indisponible (backoff borné, journal sans secret, reprise, abandon code 1) | `voice-presence-worker.test.ts` « base indisponible… » (4 tests, ajoutés) ; `voice-presence-worker-runtime.test.ts` « base coupée après le démarrage… » (ajouté) ; `voice-presence-db-outage.integration.test.ts` : worker réel derrière un proxy TCP coupé puis rétabli, et démarrage sur `127.0.0.1:1` (ajouté) |
| Base coupée plus longtemps que le bail (lacune rétroactive, temps manquant non compté, ancien collecteur fencé) | `voice-presence-lease-outage.integration.test.ts` (ajouté, passé du premier coup : aucun correctif nécessaire) |
| Diagnostic d'hôte (décisions, aucune valeur exposée, options d'écriture refusées) | `voice-host-diagnostic.test.ts` (ajouté) |
| Unité systemd cohérente (analyse statique), modèle d'environnement sans valeurs | `voice-worker-docker.test.ts` (2 tests ajoutés) |

## Vérifié localement et reste à faire

Vérifié ici : `docker compose -f docker/voice-worker/compose.yaml config -q` (sortie 0, aussi avec le modèle d'environnement en `--env-file`), les tests ci-dessus, le diagnostic exécuté une fois sur le poste de développement.

Non vérifié, à autoriser et exécuter sur l'hôte : `systemd-analyze verify` (absent du poste de développement Windows : seule l'analyse statique de `voice-worker-docker.test.ts` est faite), construction de l'image sur l'architecture de l'hôte, comportement réel de `StartLimitBurst`, résolution DNS et horloge de l'hôte, connexion au vrai Gateway, migration, activation.
