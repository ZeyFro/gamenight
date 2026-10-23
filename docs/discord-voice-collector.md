# Collecteur vocal Discord

La collecte reste désactivée tant que `VOICE_PRESENCE_ENABLED` n'est pas explicitement défini à `true`. Le worker ne démarre que dans un serveur Node auto-hébergé avec `VOICE_PRESENCE_WORKER_MODE=standalone`, un jeton Discord et les références de décision de consentement et de rétention. L'unité systemd fixe le flag à `false`; `.env.example` le laisse vide. Comme l'EnvironmentFile peut remplacer la valeur de l'unité, il doit lui aussi contenir explicitement `VOICE_PRESENCE_ENABLED=false` tant que la collecte n'est pas autorisée. Vercel, le runtime Edge et les instances web ordinaires ne lancent pas le worker.

## Consentement, lecture et conservation

Chaque créateur ou invité actif donne son accord individuellement depuis le panneau de la soirée. Tant qu'il n'a pas consenti, le worker ne lance aucun collecteur pour cette soirée. Le participant ne voit que ses propres durées; le créateur de la soirée et les admins du site ou de sa communauté voient celles des personnes consentantes. Le panneau admin vocal ne donne accès qu'à ces données vocales et ne contourne pas la confidentialité de la page de soirée.

Retirer son consentement supprime immédiatement l'accord et les intervalles de cette personne, y compris après clôture pendant la rétention. Annuler une soirée supprime ses accords et intervalles dans la transaction qui marque l'annulation et efface immédiatement les bornes de lacune. Si aucun contrôle du worker n'existe, l'annulation n'en crée pas. Si un bail est encore valide, la commande `PURGE_REQUESTED` reste jusqu'à l'arrêt du worker ou son expiration; le nettoyage existant peut alors supprimer la commande orpheline pour une séance annulée. Si ce runner/cron ne s'exécute pas, cette ligne de contrôle peut rester, mais la séance annulée et l'absence de consentements empêchent de nouvelles écritures. À la clôture normale, la date de cutoff est écrite avec l'état de la soirée, sans attendre le worker; les intervalles persistés sont bornés à cette date. La finalisation asynchrone applique une conservation de 30 jours après le cutoff; les métadonnées de contrôle finalisées et purgées sont ensuite supprimées. Le nettoyage utilise le runner et le cron de rétention déjà présents, par lots bornés; cette PR n'ajoute ni n'active de cron.

## Coordination durable et reprise après crash

Vercel ne contacte pas le worker pendant une action de clôture. Dans la même transaction que le statut terminal, l'application écrit une commande `STOP_REQUESTED` avec le cutoff, ou `PURGE_REQUESTED` pour une annulation. Le worker unique revendique un bail SQL muni d'une génération. Après la découverte et la revendication, il reverrouille la séance puis revérifie son statut, un consentement non expiré, le propriétaire, la génération et l'expiration du bail avant de construire le collecteur Gateway. Chaque intervalle répète ces contrôles dans sa transaction; un worker concurrent ou périmé ne peut donc pas continuer à écrire après la révocation.

Le worker vide ses écritures avant de finaliser la commande. Si le worker est arrêté ou perd son bail, la prochaine instance reprend la commande; la clôture du site est déjà effective. Un crash ne prolonge jamais un intervalle ouvert. Seuls les intervalles fermés et enregistrés sont conservés. Le processus ne persiste pas le tuple Gateway de reprise; au redémarrage il refait `Identify`. Chaque épisode sans observation est conservé comme une plage distincte, de la dernière observation durable (heartbeat ou expiration du bail) au premier état Gateway frais confirmé (`RESUMED` ou snapshot `GUILD_CREATE`). Une interruption supplémentaire après une reprise confirmée crée une nouvelle plage; les retries au cours d'une même interruption gardent une seule plage ouverte. Aucune durée n'est estimée dans ces plages. Les observations issues d'un snapshot, qui n'a pas d'heure d'entrée, sont enregistrées comme partielles à partir de l'heure du snapshot.

Les lignes d'intervalle restent la seule source des durées affichées. Le panneau vocal expose toutes les plages de lacune conservées et indique pour chacune si une reprise a été confirmée; aucune ne devient du temps vocal. L'historique est supprimé dans la transaction d'annulation et expire 30 jours après le cutoff d'une séance terminée, avec le nettoyage vocal par lots du runner de rétention existant. Si ce runner/cron est désactivé ou ne s'exécute pas, les lignes arrivées à expiration restent physiquement présentes jusqu'à son prochain passage, mais la lecture les masque dès leur date d'expiration.

## Préparation de l'hôte Raspberry Pi

Le paquet local comprend `packaging/systemd/gamenight.service` et `scripts/gamenight-server.mjs`. L'unité lance le serveur GameNight sur `127.0.0.1:3000` et utilise le mode worker autonome si les contrôles d'environnement autorisent le démarrage. Le lanceur traite SIGINT/SIGTERM, ferme l'admission HTTP, attend les requêtes actives, vide le worker puis ferme Next.js. L'arrêt systemd est limité à 45 secondes. Les erreurs fatales font échouer le processus pour permettre son redémarrage par systemd; aucun watchdog ou avis automatique n'est fourni.

Le lanceur fourni doit être utilisé pour l'hôte worker : `npm start` / `next start` ne coordonnent pas son flush à l'arrêt. Un reverse proxy local est à configurer séparément si l'application doit être joignable depuis le réseau. L'unité ne contient aucun secret; le gestionnaire systemd lit les variables de l'application dans `/etc/gamenight/gamenight.env`. Ce fichier doit appartenir à `root:root`, être en mode `0600` et contenir explicitement `VOICE_PRESENCE_ENABLED=false`; ne jamais afficher son contenu pendant une inspection. Garder le flag et les références de décision désactivés/non configurés jusqu'à leur mise en service autorisée.

### Préinspection SSH en lecture seule

Remplacer uniquement `<SSH_USER>` et `<RASPBERRY_HOST_OR_IP>` par les valeurs fournies par l'opérateur. Cette préinspection n'affiche jamais le contenu complet de l'EnvironmentFile, une valeur brute de flag, les propriétés `Environment` ou `ExecStart` de systemd. Pour `VOICE_PRESENCE_ENABLED`, elle ne renvoie que `conforme (false)`, `absent` ou `non conforme`.

```powershell
$Pi = '<SSH_USER>@<RASPBERRY_HOST_OR_IP>'
$RemoteInspection = @'
set -eu
printf '%s\n' '--- OS/architecture ---'
uname -a
uname -m
getconf LONG_BIT
printf '%s\n' '--- comptes/groupes ---'
id
for name in gamenight gamenight-build; do
  getent passwd "$name" || true
  getent group "$name" || true
done
printf '%s\n' '--- Node utilisé par l’unité ---'
if test -x /usr/bin/node; then /usr/bin/node --version; else echo '/usr/bin/node absent'; fi
printf '%s\n' '--- npm requis pour préparer le build ---'
if command -v npm >/dev/null 2>&1; then npm --version; else echo 'npm absent'; fi
printf '%s\n' '--- chemins cibles (métadonnées seulement) ---'
for path in /opt/gamenight /opt/gamenight/current /etc/gamenight /etc/gamenight/gamenight.env /etc/systemd/system/gamenight.service /etc/systemd/system/gamenight.service.d /etc/systemd/system/multi-user.target.wants/gamenight.service /run/systemd/system/gamenight.service /run/systemd/system/gamenight.service.d /usr/local/lib/systemd/system/gamenight.service /usr/local/lib/systemd/system/gamenight.service.d /lib/systemd/system/gamenight.service /lib/systemd/system/gamenight.service.d /usr/lib/systemd/system/gamenight.service /usr/lib/systemd/system/gamenight.service.d /var/lib/gamenight-build /var/lib/gamenight-build/gamenight; do
  if test -e "$path" || test -L "$path"; then stat -c '%n %F %U:%G %a' "$path"; else printf 'ABSENT %s\n' "$path"; fi
done
printf '%s\n' '--- permissions des parents ---'
for path in /opt/gamenight/current /etc/gamenight/gamenight.env /var/lib/gamenight-build/gamenight; do namei -l "$path" || true; done
printf '%s\n' '--- état systemd (champs non sensibles seulement) ---'
systemctl show gamenight.service --no-pager -p LoadState -p ActiveState -p UnitFileState -p User -p Group -p WorkingDirectory -p FragmentPath -p DropInPaths || true
printf '%s\n' '--- conformité du flag, sans révéler sa valeur ---'
report_flag() {
  label=$1
  file=$2
  key_pattern=$3
  expected_line=$4
  if ! sudo -n true; then printf '%s: non conforme (lecture sudo indisponible)\n' "$label"; return; fi
  if ! sudo -n test -e "$file"; then printf '%s: absent\n' "$label"; return; fi
  if ! sudo -n test -r "$file"; then printf '%s: non conforme (lecture indisponible)\n' "$label"; return; fi
  count=$(sudo -n grep -Ec "$key_pattern" "$file" || true)
  if test "$count" -eq 0; then printf '%s: absent\n' "$label"
  elif test "$count" -eq 1 && sudo -n grep -qxF "$expected_line" "$file"; then printf '%s: conforme (false)\n' "$label"
  else printf '%s: non conforme\n' "$label"
  fi
}
for unit in /etc/systemd/system/gamenight.service /run/systemd/system/gamenight.service /usr/local/lib/systemd/system/gamenight.service /lib/systemd/system/gamenight.service /usr/lib/systemd/system/gamenight.service; do
  report_flag "unité $unit" "$unit" '^Environment=VOICE_PRESENCE_ENABLED=' 'Environment=VOICE_PRESENCE_ENABLED=false'
done
report_flag 'EnvironmentFile' /etc/gamenight/gamenight.env '^[[:space:]]*VOICE_PRESENCE_ENABLED=' 'VOICE_PRESENCE_ENABLED=false'
printf '%s\n' '--- écoute TCP 3000 (sans identifiants de processus) ---'
ss -ltn | grep -E '(^State|:3000([[:space:]]|$))' || true
'@
$RemoteInspection | ssh $Pi 'bash -s'
```

Si l'architecture n'est pas `aarch64`, `/usr/bin/node` est absent ou plus ancien que `v22.15.0`, `npm` est absent, si un chemin/compte/groupe cible existe déjà, si `DropInPaths` n'est pas vide, si `FragmentPath` ne correspond à aucun emplacement vérifié ci-dessus ou si le port `3000` est déjà écouté, arrêter ici et faire inspecter l'hôte. Ne pas remplacer, supprimer, re-propriétariser ni changer les modes d'éléments préexistants. Le prérequis PostgreSQL et la migration additive approuvée sont traités séparément; cette procédure ne se connecte pas à la base et n'exécute aucune migration.

### Préparation et installation, sans démarrage

Cette séquence ne convient qu'à un hôte neuf dont la préinspection a confirmé l'absence de tous les comptes, groupes et chemins listés. Toute présence impose l'arrêt sans modification de propriétaire ou de mode. L'opérateur doit avoir fourni au préalable au compte de build un accès GitHub en lecture seule et une clé d'hôte vérifiée, hors de cette séquence; ne jamais inclure de credential dans une commande. Si cet accès n'est pas déjà configuré, arrêter avant toute installation. Remplacer `<APPROVED_MAIN_SHA>` par un commit déjà intégré à `origin/main` et approuvé pour cet hôte.

```bash
set -euo pipefail
APPROVED_MAIN_SHA='<APPROVED_MAIN_SHA>'
sudo sh -eu -c '
  for path in /opt/gamenight /opt/gamenight/current /etc/gamenight /etc/gamenight/gamenight.env /etc/systemd/system/gamenight.service /etc/systemd/system/gamenight.service.d /etc/systemd/system/multi-user.target.wants/gamenight.service /run/systemd/system/gamenight.service /run/systemd/system/gamenight.service.d /usr/local/lib/systemd/system/gamenight.service /usr/local/lib/systemd/system/gamenight.service.d /lib/systemd/system/gamenight.service /lib/systemd/system/gamenight.service.d /usr/lib/systemd/system/gamenight.service /usr/lib/systemd/system/gamenight.service.d /var/lib/gamenight-build /var/lib/gamenight-build/gamenight; do
    if test -e "$path" || test -L "$path"; then echo "STOP: chemin déjà présent: $path" >&2; exit 1; fi
  done
  for name in gamenight gamenight-build; do
    if getent passwd "$name" >/dev/null || getent group "$name" >/dev/null; then echo "STOP: compte ou groupe déjà présent: $name" >&2; exit 1; fi
  done
'
test "$(uname -m)" = aarch64
/usr/bin/node -e 'const [a,b,c]=process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && (b > 15 || (b === 15 && c >= 0))) ? 0 : 1)'
command -v npm >/dev/null 2>&1

sudo groupadd --system gamenight
sudo useradd --system --gid gamenight --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin gamenight
sudo groupadd --system gamenight-build
sudo useradd --system --gid gamenight-build --create-home --home-dir /var/lib/gamenight-build --shell /bin/bash gamenight-build
sudo install -d -o root -g gamenight -m 0750 /opt/gamenight
sudo -u gamenight-build -- git ls-remote git@github.com:ZeyFro/gamenight.git refs/heads/main >/dev/null
sudo -u gamenight-build -- git clone --no-checkout git@github.com:ZeyFro/gamenight.git /var/lib/gamenight-build/gamenight
sudo -u gamenight-build -- git -C /var/lib/gamenight-build/gamenight fetch origin main
sudo -u gamenight-build -- git -C /var/lib/gamenight-build/gamenight merge-base --is-ancestor "$APPROVED_MAIN_SHA" FETCH_HEAD
sudo -u gamenight-build -- git -C /var/lib/gamenight-build/gamenight checkout --detach "$APPROVED_MAIN_SHA"
sudo -u gamenight-build -- sh -eu -c '
  cd /var/lib/gamenight-build/gamenight
  npm ci
  env -u DATABASE_URL -u TEST_DATABASE_URL NEXT_TELEMETRY_DISABLED=1 npx next build
'
sudo install -d -o root -g gamenight -m 0750 /opt/gamenight/current
tar --exclude=.git -C /var/lib/gamenight-build/gamenight -cf - . | sudo tar --no-same-owner -C /opt/gamenight/current -xf -
sudo chown -R root:gamenight /opt/gamenight/current
sudo find /opt/gamenight/current -type d -exec chmod 0750 {} +
sudo find /opt/gamenight/current -type f -exec chmod 0640 {} +
sudo install -d -o gamenight -g gamenight -m 0750 /opt/gamenight/current/.next/cache
sudo chown -R gamenight:gamenight /opt/gamenight/current/.next/cache
sudo chmod -R u+rwX /opt/gamenight/current/.next/cache
sudo install -d -o root -g root -m 0750 /etc/gamenight
sudo install -o root -g root -m 0600 /dev/null /etc/gamenight/gamenight.env
sudoedit /etc/gamenight/gamenight.env
sudo sh -eu -c '
  file=/etc/gamenight/gamenight.env
  count=$(grep -Ec "^[[:space:]]*VOICE_PRESENCE_ENABLED=" "$file" || true)
  test "$count" -eq 1
  grep -qx "VOICE_PRESENCE_ENABLED=false" "$file"
  test "$(stat -c "%U:%G %a" "$file")" = "root:root 600"
'
sudo sh -eu -c '
  file=/opt/gamenight/current/packaging/systemd/gamenight.service
  count=$(grep -Ec "^Environment=VOICE_PRESENCE_ENABLED=" "$file" || true)
  test "$count" -eq 1
  grep -qx "Environment=VOICE_PRESENCE_ENABLED=false" "$file"
'
sudo install -o root -g root -m 0644 /opt/gamenight/current/packaging/systemd/gamenight.service /etc/systemd/system/gamenight.service
sudo systemd-analyze verify /etc/systemd/system/gamenight.service
sudo systemctl daemon-reload
```

Le checkout et le build appartiennent au compte non privilégié `gamenight-build`. Le service tourne sous le compte distinct `gamenight`; le code installé est ensuite en lecture seule pour lui, à l'exception de `.next/cache`. `npm run build` est interdit ici : le script du dépôt peut lancer `prisma migrate deploy`. N'installez aucune dépendance en root et ne fournissez pas de `DATABASE_URL` ou `TEST_DATABASE_URL` au build. Remplir l'EnvironmentFile via le canal secret approuvé, sans copier ou afficher de secret; la vérification n'imprime que le flag et les métadonnées de permissions. L'installation de l'unité et `daemon-reload` ne l'activent ni ne la démarrent.

### Démarrage ultérieur, étape séparée

À exécuter seulement après la migration approuvée traitée séparément et une autorisation explicite de démarrage. La collecte reste désactivée; ces commandes ne changent pas son flag.

```sh
set -eu
sudo sh -eu -c '
  file=/etc/gamenight/gamenight.env
  count=$(grep -Ec "^[[:space:]]*VOICE_PRESENCE_ENABLED=" "$file" || true)
  test "$count" -eq 1
  grep -qx "VOICE_PRESENCE_ENABLED=false" "$file"
  test "$(stat -c "%U:%G %a" "$file")" = "root:root 600"
  unit=/etc/systemd/system/gamenight.service
  unit_count=$(grep -Ec "^Environment=VOICE_PRESENCE_ENABLED=" "$unit" || true)
  test "$unit_count" -eq 1
  grep -qx "Environment=VOICE_PRESENCE_ENABLED=false" "$unit"
  environment_file_count=$(grep -Ec "^EnvironmentFile=" "$unit" || true)
  test "$environment_file_count" -eq 1
  grep -qx "EnvironmentFile=/etc/gamenight/gamenight.env" "$unit"
  test "$(systemctl show gamenight.service -p FragmentPath --value)" = "$unit"
  test -z "$(systemctl show gamenight.service -p DropInPaths --value)"
'
sudo systemctl enable gamenight.service
sudo systemctl start gamenight.service
sudo systemctl is-active --quiet gamenight.service
systemctl show gamenight.service --no-pager -p ActiveState -p SubState -p MainPID
ss -ltn | grep '127.0.0.1:3000'
```

Ne pas utiliser `systemctl show -p Environment`, `systemctl cat` ou une commande qui imprime l'EnvironmentFile. `enable` et `start` restent des commandes séparées et ne doivent jamais être combinées avec `--now`.

La migration d'historique vocal est additive et doit être appliquée uniquement par la procédure de migration approuvée avant le démarrage d'un worker utilisant ce code. Aucune migration ni connexion Production, installation Raspberry, activation de flag/cron, connexion au Gateway réel ou notification Discord n'a été effectuée pour ce lot. Le contrôle final juste avant construction du collecteur réduit la course avec un retrait; un retrait commité après ce contrôle mais avant l'ouverture effective du socket peut laisser une brève connexion Gateway en transit. Un événement Gateway déjà reçu en mémoire peut aussi être en transit, mais le propriétaire/génération/consentement sont revérifiés sous verrou avant chaque écriture : après le commit du retrait, aucune nouvelle contribution ne peut être persistée. Le poll suivant ferme le collecteur.

## Runbook d'exploitation du worker

Valable pour l'unité systemd (`gamenight.service`) et pour le conteneur (`docker/voice-worker/compose.yaml`). Rien de ce qui suit n'est exécuté automatiquement : chaque étape marquée « à autoriser » exige une décision explicite.

### Arrêt propre et délais

- Signaux traités par le lanceur `scripts/gamenight-server.mjs` : `SIGTERM` (systemd, `docker stop`), `SIGINT` (Ctrl+C), `SIGBREAK` (Ctrl+Break Windows) et `SIGHUP` (fermeture de la console ou du terminal, y compris Windows).
- Séquence : fermeture de l'admission HTTP, attente des requêtes en cours, arrêt des collecteurs (les intervalles encore ouverts sont fermés et enregistrés, une lacune `shutdown` est notée), vidage des écritures de lacune, libération du bail SQL, fermeture de Next.js, code de sortie 0.
- Un **second signal** pendant l'arrêt force une sortie immédiate (code 1) : les écritures non vidées sont perdues, le bail expire tout seul et la prochaine instance reprend.
- Délai maximal : `VOICE_WORKER_SHUTDOWN_TIMEOUT_MS` (1000 à 600000 ms, défaut 40000; valeur invalide = défaut). Passé ce délai, sortie forcée avec le code 1. Si vous l'augmentez, augmentez aussi `TimeoutStopSec` (systemd, 45 s) et `stop_grace_period` (compose, 45 s), sinon l'orchestrateur tue le processus avant.

### Supervision

- systemd : `Restart=on-failure`, `RestartSec=5s`, plafond `StartLimitBurst=5` en 300 s. Au-delà, l'unité passe en `failed` (« start request repeated too quickly ») et ne redémarre plus : c'est le signal d'alerte. Diagnostic : `systemctl is-failed gamenight.service`, `journalctl -u gamenight.service -n 100 --no-pager`. Relance après correction : `sudo systemctl reset-failed gamenight.service` puis `sudo systemctl start gamenight.service`. Les directives de backoff croissant (`RestartSteps`) ne sont pas utilisées : absentes de systemd 252 (Raspberry Pi OS Bookworm).
- Docker : `restart: unless-stopped` (le démon applique un délai croissant entre redémarrages, plafonné à 1 minute, mais pas de plafond de tentatives). Pour un plafond signalé, remplacer par `restart: on-failure:5` (le conteneur reste alors arrêté, visible avec `docker ps -a`). `HEALTHCHECK` : connexion TCP locale sur `127.0.0.1:3000` toutes les 30 s (`docker inspect --format '{{.State.Health.Status}}' <conteneur>`). Ce contrôle prouve que le serveur répond, pas que la Gateway Discord est connectée; il n'y a pas de heartbeat applicatif.
- Journalisation : sortie standard vers le journal systemd ou `docker logs`. Les messages du worker ne contiennent ni jeton, ni URL de base, ni détail d'erreur de base de données : seulement une catégorie (`discovery`, `gateway`, `persistence`, `gap_persistence`, `shutdown`) et la raison d'une lacune. Ne jamais copier un `EnvironmentFile` ou `docker inspect` (qui affiche l'environnement) dans un ticket.
- Exemple compose validé syntaxiquement : `docker compose -f docker/voice-worker/compose.yaml config -q`. Exemple systemd : `systemd-analyze verify /etc/systemd/system/gamenight.service` sur l'hôte (non exécutable sous Windows).

### Démarrer, arrêter, mettre à jour

- Démarrer (à autoriser) : voir « Démarrage ultérieur ». Compose : `docker compose -f docker/voice-worker/compose.yaml up -d voice-worker`, collecte éteinte tant que `VOICE_PRESENCE_ENABLED` n'est pas `true`.
- Arrêter : `sudo systemctl stop gamenight.service` ou `docker compose -f docker/voice-worker/compose.yaml stop voice-worker`. Vérifier la sortie propre : `systemctl show gamenight.service -p Result -p ExecMainStatus` (attendu `success` et `0`) ou `docker inspect --format '{{.State.ExitCode}}' <conteneur>` (attendu `0`).
- Mettre à jour (à autoriser) : appliquer d'abord les migrations additives par la procédure approuvée, arrêter le worker (attendre la sortie propre), déployer le nouveau commit approuvé, redémarrer. Ne jamais lancer deux workers sur la même base : le bail SQL ne tolère qu'un propriétaire, mais le second reprendrait les séances au premier.
- Reprise après arrêt brutal (kill -9, coupure électrique) : les intervalles ouverts sont perdus par conception, le bail expire, la prochaine instance reprend et la plage de lacune est conservée.

### Retrait du consentement

C'est un geste de la personne depuis le panneau de la soirée; il supprime immédiatement son accord et ses intervalles. Au prochain poll (`VOICE_PRESENCE_POLL_INTERVAL_MS`, 15 s par défaut), le worker ferme le collecteur s'il ne reste aucun accord. Rien à faire côté hôte; ne pas arrêter le worker pour cela. Vérification côté base par l'opérateur autorisé : plus de ligne d'accord ni d'intervalle pour cette personne et cette séance.

### Désactivation d'urgence

1. Mettre `VOICE_PRESENCE_ENABLED=false` dans `/etc/gamenight/gamenight.env` (ou la variable du compose), sans afficher le fichier.
2. Redémarrer : `sudo systemctl restart gamenight.service` (le redémarrage vide les écritures et libère le bail). Sans redémarrage le worker continue : le drapeau est lu au démarrage.
3. Plus rapide si l'hôte est injoignable ou le drapeau ignoré : retirer le salon vocal de la communauté (`CommunityChannelConfig` catégorie VOICE désactivée) coupe la découverte au poll suivant.
4. Les données déjà collectées expirent 30 jours après la clôture; la suppression anticipée passe par l'annulation de la soirée ou le retrait de consentement.

### Ce qui est vérifié localement et ce qui ne l'est pas

Vérifié sans Discord réel : arrêt (signaux, second signal, délai maximal, flush avant fermeture de Next) par `src/lib/gamenight-server.test.ts` et `src/lib/gamenight-server-shutdown.test.ts`; arrêt du worker et vidage des lacunes par `voice-presence-worker*.test.ts`; collecteur contre un faux Gateway WebSocket local et Postgres jetable par `voice-presence-gateway-simulation.integration.test.ts` (dont l'arrêt avec un intervalle ouvert); artefacts Docker/systemd par `voice-worker-docker.test.ts`; `docker compose config`; construction locale de l'image (non publiée), démarrage du conteneur sans réseau avec collecte éteinte (`healthy`) puis `docker stop` : SIGTERM réel, sortie 0 en moins d'une seconde.

**Non vérifié et à autoriser séparément** : installation sur le Raspberry Pi (y compris `systemd-analyze verify` sur l'hôte et le comportement réel de `StartLimitBurst`), connexion au vrai Gateway Discord avec un vrai jeton, migration de l'historique vocal en Production, activation de la collecte (`VOICE_PRESENCE_ENABLED=true`, références de décision de consentement et de rétention), notifications Discord.

## Ordre de déploiement et drapeau maître

**Migrations d'abord, puis code.** Les 4 migrations vocales (avec les 2 migrations XP/boutique) s'appliquent par la procédure approuvée AVANT le déploiement du code. Par sécurité, le code ne touche aucune table vocale tant que `VOICE_PRESENCE_ENABLED` n'est pas exactement `true` : page détail d'une soirée (`readSessionVoicePresence` renvoie le panneau « désactivé » sans requête), annulation, clôture (`sessions.ts`) et étape vocale de la rétention (`retention-runner.ts`, `voicePresence: null` dans le rapport). Preuve : `src/lib/voice-presence-flag-off.integration.test.ts` tourne sur une base migrée UNIQUEMENT avec les migrations de `origin/main` (pas de table vocale) et exécute lecture de page, annulation, clôture et rétention sans erreur ; le même test avec le drapeau à `true` échoue (contrôle négatif exécuté une fois). Préparer la base : `git archive origin/main prisma/migrations | tar -x -C <dossier>/`, copier `prisma/schema.prisma` dans `<dossier>/prisma/`, `prisma migrate deploy --schema <dossier>/prisma/schema.prisma` sur une base Docker jetable, puis `LEGACY_SCHEMA_DATABASE_URL=… npx vitest run src/lib/voice-presence-flag-off.integration.test.ts` (sinon la suite est SKIPPÉE).

Conséquence à connaître : drapeau éteint, une annulation ou un retrait de soirée ne purge pas les données vocales déjà collectées, et la rétention ne s'exécute pas pour le vocal. Pour purger après une désactivation d'urgence, rallumer temporairement le drapeau avec le worker arrêté (`VOICE_PRESENCE_WORKER_MODE` vide) : le runner de rétention et l'annulation reprennent alors leur effet.

## Lignes de contrôle STOP_REQUESTED

`markSessionDone` n'écrit plus de ligne `STOP_REQUESTED` pour toute soirée terminée : sans contrôle existant (aucun worker n'a collecté) ET sans accord vocal, il n'y a rien à finaliser et aucune ligne n'est créée. Choix retenu plutôt qu'une purge périodique : c'est le plus sûr (aucune suppression de plus, l'accumulation est évitée à la source), et un accord ne peut plus être donné après la fin (`canConsent` exige `SCHEDULED`). Les lignes déjà créées avant ce correctif restent à nettoyer par l'opérateur autorisé. Test : `src/lib/voice-presence-stopat.integration.test.ts`.

## Fuseaux : `stopAt` est un instant réel

Analyse : les dates de soirée sont stockées en heure murale de Paris encodée en UTC (`wallclock.ts`), donc `wallClockNow()` est décalé de +1 h (hiver) ou +2 h (été) par rapport à l'instant réel. Les horodatages Gateway, `consentedAt`, `startedAt`/`endedAt` des intervalles et `finalizeVoiceIntervalAtCutoff` sont des instants réels. Le défaut était confirmé : `stopAt` était écrit avec `wallClockNow()` puis comparé à `startedAt` (`startedAt >= control.stopAt`) et utilisé comme borne de coupure, soit un cutoff trop tardif de 1 à 2 h. Correction : `stopAt` = `new Date()` aux trois appels de `sessions.ts` ; les échéances 30 jours (`stopAt + 30 j`) sont comparées à des instants réels (lecture, retrait, rétention) ; seuls les baux (`leaseExpiresAt`, `heartbeatAt`, décision `date <= now` de la soirée) restent en heure murale, avec le paramètre `leaseNow`. Tests : `voice-presence-stopat.integration.test.ts` (clôture simulée avant et après le passage heure d'été/hiver du 2026-10-25, en plein été et en plein hiver ; le test vérifie que l'heure murale diffère de l'instant réel). Limite connue : les lignes `stopAt` déjà écrites avec l'ancienne convention ont un cutoff trop tardif de 1 à 2 h.

## Isolation des modèles vocaux (décision `communityId`)

Les modèles vocaux (`SessionVoicePresence*`) n'ont volontairement pas de `communityId` : ils sont rattachés à une `Session`, qui porte sa communauté. L'isolation passe par la séance : consentement et écriture d'intervalle exigent l'invitation ou la création de la séance, une communauté ACTIVE avec le salon vocal VOICE activé, le serveur Discord de la communauté et, isolation active, une appartenance ACTIVE (tests : `session-voice-presence.integration.test.ts`, cas « does not insert when … first » pour la révocation d'appartenance, la communauté inactive, le salon désactivé et l'invitation révoquée) ; la lecture est limitée au créateur, aux admins du site ou de la communauté de la séance et aux invités pour leurs propres durées (`session-voice-presence.test.ts`). Aucune modification de schéma n'est faite.

## Arrêt : serveur et worker en parallèle

À l'arrêt, la fermeture du serveur HTTP et le vidage du worker démarrent ensemble : une connexion HTTP maintenue ouverte ne retarde ni le flush ni la libération du bail. Les connexions inactives sont coupées tout de suite, les requêtes actives disposent de 3 s après le flush, puis les connexions restantes sont coupées avant la fermeture de Next.js ; le tout reste borné par `VOICE_WORKER_SHUTDOWN_TIMEOUT_MS`. Test : `src/lib/gamenight-server-shutdown.test.ts` (« connexion HTTP maintenue ouverte »). Dans la section « Arrêt propre », l'attente des requêtes en cours est donc plafonnée à 3 s.

Précision : cette coupure des requêtes HTTP actives 3 s après le flush ne concerne que le lanceur auto-hébergé (`scripts/gamenight-server.mjs`) ; elle n'a aucun effet sur Vercel, qui n'utilise pas ce lanceur.

Le test `voice-presence-flag-off.integration.test.ts` est autonome : à partir de `TEST_DATABASE_URL` (Postgres local `gamenight_*` seulement, hôte 127.0.0.1/localhost), il crée sa propre base `gamenight_legacy_<horodatage>` avec les migrations du dépôt sans les 4 migrations vocales, y joue les scénarios drapeau éteint (lecture de page, annulation, clôture, rétention, retrait de consentement, page admin en `notFound`), puis supprime la base et son dossier temporaire. Il n'écrit jamais dans `TEST_DATABASE_URL` elle-même et n'utilise aucun ref git. Les liens « Durées vocales » (`/sessions`, `/admin`) et la page admin ne s'activent que si le drapeau vaut `true`.
