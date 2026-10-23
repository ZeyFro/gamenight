# Stabilisation V2 — 8 octobre 2026

Branche `perf/stabilisation-v2`, base `be3b809` (merge #201). Le chantier
du PC fixe était absent ; cette implémentation a été reconstruite sur main.
Aucun accès Neon, notification Discord réelle, changement de flag ou d’offre.

## Créations et reprises

Les cinq formulaires partagent un état de soumission immédiat : champs et
boutons désactivés, message de progression et nouvelle tentative explicite.
Une clé UUID identifie le geste et reste stable après une réponse perdue.
Un nouveau formulaire fournit une nouvelle clé : son contenu identique ne
constitue pas un doublon. La règle métier d’une seule session instantanée
active reste applicable. Après rechargement complet, le formulaire représente
un nouveau geste ; la clé n’est pas stockée globalement dans le navigateur.

La migration additive `20261008090000_creation_intent` ajoute un reçu durable,
unique par acteur/type/clé. Verrou transactionnel PostgreSQL, parent,
invitations et intentions bot partagent le commit. Une tentative annulée par
rollback peut être reprise ; un reçu dont le parent a été purgé interdit sa
recréation. Les reprises relisent les droits. Les appartenances sont verrouillées
durant la création lorsque l’isolation est activée. Les reçus ne sont pas
purgés automatiquement : les conserver évite de rouvrir les anciennes clés.

La roulette différée verrouille sa ligne et crée résultat, soirée, votes et
éditions de MP dans une transaction, sans état SPINNING intermédiaire.
Les anciennes lignes SPINNING nécessitent un diagnostic opérateur : aucun
nouveau tirage automatique ne tente de deviner un résultat historique.
La roulette liée à une soirée conserve son verrou métier VOTING et ne tire
qu’une fois. Les XP/badges restent idempotents et attendus ; une reprise de
soirée répare une interruption après le commit. Aucun envoi bot HTTP n’est
attendu avant confirmation, les intentions passent par la file durable.

## Lectures et navigation

Les résolutions communauté/appartenance sont mutualisées seulement pendant
un chargement explicite de l’accueil, avec une clé par utilisateur et un
contexte asynchrone isolé. Aucun cache global de droits, aucune réutilisation
dans les mutations ou livraisons. Le chargement suivant revalide les retraits
et le serveur sélectionné. La liste des tournois suit désormais ce serveur.
Les scénarios A → B → A et retrait de membership sont testés sur PostgreSQL.
Le polling chat ne se chevauche plus ; les sessions instantanées arrêtent
leur polling une fois terminées. Les onglets masqués restent sans polling.
Les cadences visibles existantes de 15 s/30 s sont conservées.

## Discord

Le chemin bot utilise les modèles existants de création, changement de date
et rappel, avec créateur, invité, jeu et ancienne/nouvelle date réels. Les
catégories de rappel proche/lointain correspondent au délai restant ; le texte
personnel du rappel conserve sa priorité. Les modèles existants ne possèdent
pas de catégorie tournoi : les textes spécialisés tournoi sont conservés.

Création soirée/tournoi : MP aux invités éligibles et mention dans le fil ;
créateur par MP, secours uniquement selon les règles existantes. Retrait de
membership, préférences et provenance sont relus à la livraison. Modification
ordinaire, fin et annulation restent des éditions sans nouveau ping ; inscription
tournoi sans ping général. Date, validation et rappels gardent leurs destinataires
ciblés. Roulette différée : MP uniquement, résultat par édition des MP ; la
soirée résultante ne déclenche pas une nouvelle invitation ou mention roulette.

Le préfixe historique `default-guild` des targetSlot est une clé logique,
pas une preuve de provenance Discord. Un événement incompatible avec son
parent est refusé. L’absence de parent/provenance ne crée plus une communauté
default par défaut. Les sources historiques null restent compatibles avec
default selon les règles PR A/B, sans backfill ni réaffectation automatique.

### Diagnostic opérateur (lecture seule)

Les données fournies par l’audit du PC fixe n’ont pas été relues sur Neon.
Pour examiner les échecs et dépendances, utiliser une session SQL autorisée :

```sql
SELECT e.id, e."eventType", e."sourceId", e."communityId",
       d.id AS delivery_id, d.operation, d.status, d."targetSlot",
       d."errorClass", d."lastError", d."discordThreadId", d."discordMessageId"
FROM "NotificationEvent" e JOIN "NotificationDelivery" d ON d."eventId" = e.id
WHERE d.status IN ('FAILED', 'PENDING')
ORDER BY e."createdAt", d.sequence;

SELECT e.id, e.category, e."eventType", e."sourceId", e."communityId",
       s."communityId" AS session_community,
       t."communityId" AS tournament_community,
       i."communityId" AS instant_community
FROM "NotificationEvent" e
LEFT JOIN "Session" s ON e.category = 'SESSION' AND s.id = e."sourceId"
LEFT JOIN "Tournament" t ON e.category = 'TOURNAMENT' AND t.id = e."sourceId"
LEFT JOIN "InstantSession" i ON e.category = 'INSTANT_SESSION' AND i.id = e."sourceId"
WHERE e."communityId" IS NULL
ORDER BY e."createdAt" DESC;
```

- `SESSION_INVITE_SYNC discord:not_found` : examiner le thread réel, le statut
  de l’invitation, le membership actif, la présence du bot et l’accès de l’invité.
  Le nouveau diagnostic distingue vérification du fil et ajout du membre et
  conserve le code Discord (10003/10013…). Un 404 ne justifie pas de remplacer
  les salons. L’ajout vérifié se fait seulement sur un fil privé valide.
  Voir [Discord Add Thread Member](https://docs.discord.com/developers/resources/channel#add-thread-member).
- `SESSION_DM dm_unavailable` est terminal. Ne pas le réarmer en boucle ; le
  secours prévu pour le créateur est conservé, sans ping général additionnel.
- EDIT/ARCHIVE sans message et dont tous les SEND sont FAILED/SKIPPED deviennent
  SKIPPED `dependency:send_terminal_without_message`. Un SEND PENDING, RESERVED,
  programmé ou absent reste récupérable. Le prochain executor applique ce
  traitement aux anciennes éditions bloquées ; aucune réparation SQL distante
  n’a été effectuée. Vérifier l’état réellement envoyé avant toute reprise manuelle.
- Pour une provenance null, distinguer parent historique null, parent purgé et
  incohérence de journal. Ne jamais affecter en masse les lignes à default.

## Mesures et validation

Les fichiers JSON adjacents conservent les résultats bruts avant/après sur
PostgreSQL 16.15 local, Node 24.19.0, timezone Europe/Paris. Les scénarios
communautés sont identiques : 100 et 1 000 communautés, un échauffement,
10 lectures, puis 8 lectures concurrentes. Comptage Prisma incluant transactions
et requêtes relationnelles, fixtures exclues, HTTP Discord simulé uniquement.
Le scénario accueil appelle `loadHomeData` : il mesure ses lectures métier,
sans authentification, Header, onboarding ni clôture paresseuse d’une soirée.
La même mutualisation est appliquée à la page `/`, mais le total SQL d’une
navigation navigateur complète n’est pas assimilé à ce compte de loader.
Les durées sont des mesures locales, pas un SLA Vercel ou Neon.

Accueil : 96 → 38 SQL dans les deux jeux de données (−60,4 %).
Les temps ci-dessous proviennent de la dernière passe, sans autre validation
concurrente. Une passe réalisée pendant TypeScript/ESLint avait un p95 de
211,99 ms à 100 communautés : les durées restent sensibles à la charge locale,
contrairement aux comptes SQL constants. Aucun gain de latence universel n’est garanti.

| Communautés | SQL avant/après | p50 ms avant/après | p95 ms avant/après | 8 lectures concurrentes ms avant/après |
| --- | --- | --- | --- | --- |
| 100 | 96 / 38 | 43,91 / 32,07 | 100,28 / 92,38 | 306,45 / 178,49 |
| 1 000 | 96 / 38 | 209,71 / 147,93 | 275,70 / 195,15 | 1 290,70 / 976,65 |

File vide : 6 → 1 SQL, chacune des 10 exécutions. Le benchmark de roulette
liée recrée une soirée VOTING à chaque mesure, vérifie le vrai tirage et ses
intentions, puis vérifie que le second appel ne tire plus. Il ne mesure pas
une boucle de no-op sur une soirée déjà tirée ; aucun gain avant/après n’est
revendiqué pour ce scénario.
La roulette liée effectue 21 SQL par vrai tirage dans les dix échantillons.

Validation locale : 173 fichiers / 2 060 tests passent avec PostgreSQL,
sans tests ignorés. TypeScript, ESLint, build Next direct sur URL locale et
comparaison schéma/base (`prisma migrate diff`, aucune différence) passent.
Les quatre scénarios Preview/production/development/hors-Vercel vérifient le
script de build réel sans exécuter de migration distante. Le téléchargement
des polices a demandé l’accès réseau ; aucun accès base distant n’a été utilisé.
La compilation propre a aussi exigé de séparer deux imports de constantes
client des modules Prisma serveur ; l’ancien cache `.next` a été conservé
dans un dossier temporaire.
Une seconde passe complète a révélé deux échecs XP dans la fixture e2e
« Jouer maintenant » : la communauté default d’une précédente suite pouvait
rester suspendue. Le scénario remet désormais à zéro Community et son cache,
sans changer la règle de production qui bloque la progression sur un serveur suspendu.

Commandes reproductibles, sur des bases locales jetables distinctes :

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55439/gamenight_stabilisation_test'
node scripts/test-postgres.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:NEXT_TELEMETRY_DISABLED='1'
node node_modules/next/dist/bin/next build

$env:TEST_DATABASE_URL='postgresql://postgres:test@127.0.0.1:55439/gamenight_load_stabilisation'
node scripts/benchmark-communities.mjs
node node_modules/vitest/vitest.mjs run --config scripts/queue-load.config.mts --maxWorkers=1
node node_modules/vitest/vitest.mjs run --config scripts/linked-roulette.config.mts --maxWorkers=1
```

Les suites et benchmarks PostgreSQL doivent être exécutés en série. Les
benchmarks refusent une base autre que 127.0.0.1 / gamenight_load_*.

## Coût Neon et réglages opérateur

Capture fournie du 07/10 : 46,58 CU-heures depuis le 01/10, stockage 38,67 Mo,
calcul 0,25–4 CU, Francfort. Aucun réglage distant consulté ou changé.
Une CU-heure dépend de la taille du compute et de son temps actif ; une
requête par minute peut encore empêcher la mise en veille, même après 6 → 1 SQL.
La mise en veille par défaut demande cinq minutes sans activité. Voir
[Neon endpoints](https://neon.com/docs/manage/endpoints/).
À 0,25 CU constamment actif, sept jours représentent 42 CU-heures : c’est
un ordre de grandeur, pas une attribution causale de la capture.

Inventaire à comparer dans les journaux autorisés : executor chaque minute,
cadence des rappels selon la configuration externe (voir [CRONS.md](CRONS.md)), synchronisation des guilds
quotidienne, profils/Steam/retention selon leurs cadences déjà configurées,
polling des navigateurs, doubles jobs externes et previews actives. Les crons
externes ne sont pas entièrement décrits par le dépôt. Le présent chantier
ne ralentit ni les rappels ni les reprises. Aucun service payant ajouté.
La file vide ne prend plus de transaction de réservation/recovery inutile.

Pour mesurer un effet CU-heures : comparer des fenêtres de durée et trafic
similaires, noter compute actif/inactif, moyenne de CU, requêtes par route,
onglets ouverts et cadence des jobs. Vérifier les jobs doublonnés et grouper
les tâches quotidiennes non urgentes si leur procédure le permet. Une baisse
des SQL seule ne démontre pas une baisse de facturation. Les changements
de cadence/offre/flags restent des décisions opérateur distinctes.

## Preview et production

`npm run build` appelle `scripts/build.mjs` : dans tous les environnements,
uniquement Prisma generate puis Next build, jamais migrate deploy. Le test
exécute le vrai script avec processus enfants simulés dans quatre environnements.
Les migrations de production s'appliquent à part, avec `node scripts/db-migrate.mjs`
(rôle de migration distinct du runtime, liste exacte des migrations attendues), avant
de fusionner le code qui en dépend. Les anciennes migrations sont immuables. Une Preview doit utiliser une base isolée avec la
migration additive appliquée séparément, sinon les créations échoueront faute
de table ; aucune migration sur une base de production depuis une Preview.
Voir [environnements Vercel](https://vercel.com/docs/deployments/environments).

Restent à vérifier par l’opérateur : UX navigateur sur un vrai changement de
serveur et réseau interrompu, essai Discord sur serveur/bot de test séparés,
diagnostics fournis relus après déploiement autorisé, effet réel sur CU-heures.
La PR reste Draft, sans merge et sans activation de flags.
