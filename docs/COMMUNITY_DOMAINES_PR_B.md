# Progression et rétention par communauté — PR B

Base = main, à vérifier avant de merger

Base de travail : `3b484ed` (PR #196 déjà mergée). Branche :
`feat/communautes-progression-pr-b`. PR7–PR9 et PR A restent acquis ; cette PR
complète leur isolation sans reconstruire leurs domaines. Aucun flag de
production modifié, aucun appel Discord réel, aucune base Neon utilisée.

## Architecture implémentée

| Domaine | Source et frontière |
| --- | --- |
| XP et streaks | `CommunityMemberStats`, clé `(communityId, userId)` : solde, streak courant, dernière activité, meilleur streak, compteur durable de participations aux tournois. |
| Récompenses | `XpEvent`, `LevelUpEvent`, `UserBadge` portent un `communityId` obligatoire. Unicité XP `(communityId, userId, reason, sourceId)` et badge `(communityId, userId, badgeId)`. |
| Profil / potes / classement | Projection de la progression du serveur choisi par le lecteur. La sélection du pote ne choisit pas le serveur de sa fiche. Aucun fallback sur le solde historique `User`. Sans communauté autorisée : progression zéro, sans création de ligne. |
| Accueil | Badges et niveaux filtrés par provenance communautaire, en plus de l'appartenance. Streaks lus dans les statistiques du serveur ; le membre commun à A/B ne mélange plus ses valeurs. |
| Saisons | Snapshot, reset du solde du seul serveur et création de la saison suivante atomiques. Les départs restent dans les snapshots ; le champion annoncé doit être encore membre actif. Historique du profil filtré, aussi lors du retour aux flags OFF (`default`). |
| Récaps | Somme de tous les événements XP du serveur dans le mois, y compris badges, tournois et sources déjà purgées. Snapshot mensuel et meilleure série propres au serveur. |
| Paris | Lecture du solde communautaire sous verrou, contrôle de la mise et débit dans la même transaction ; récompense du serveur de la soirée. |
| Résumés durables | `SessionResult`, `Notification`, `NotificationEvent` reçoivent une provenance ; les résumés déjà portés par PR A restent conservés. |
| Administration métier | Audit, enfants des parents, livraisons et inventaire legacy dans la communauté active de l'admin. Réessai par `deliveryId` réellement visible, jamais par paramètres de rôle/source forgés. Rôle plateforme seul insuffisant après retrait. |
| Rétention | Intersection du scope demandé avec les communautés ACTIVE, relue sous verrou avant chaque mutation. Six purges couvertes : chat, soirées, tournois, instantanées, notifications et livraisons techniques. |

Le client scopé couvre les nouveaux modèles, et `scopedTransactionPrisma`
applique les mêmes règles dans une transaction Prisma (où `$extends` n'existe
pas). Les filtres explicites de progression restent nécessaires avec les flags
OFF : le client collectif est alors transparent, tandis que les vues XP
choisissent `default`. Une récompense dérivée conserve toujours le serveur du
parent, indépendamment du serveur actuellement choisi par le destinataire.

Les anciennes colonnes `User.xpTotal`, `streakCount`, `streakLastActiveAt`,
`bestStreakCount` et `UserLifetimeStats` sont conservées pour l'historique. Elles
ne sont plus utilisées comme progression vivante. Les données personnelles
partagées (bibliothèque, ancienneté du compte, disponibilités, liaison Steam)
restent des faits du compte ; les badges gagnés et leurs XP appartiennent à
la communauté où ils sont attribués. Les récompenses du *premier* geste
Steam/disponibilités ne sont pas recréditées dans un autre serveur : live et
backfill verrouillent le même utilisateur avant de consulter le ledger.

### Inventaire des appelants

Recherche `rg`, puis parcours des `CallExpression` avec le compilateur TypeScript :
**20 appels réels à `awardXp` dans 15 fichiers**, hors déclaration, commentaires
et tests. Le nombre approximatif de la demande n'est pas repris comme preuve.

| Fichier | Appels / communauté |
| --- | --- |
| `src/app/disponibilites/actions.ts` | 1 : communauté active du geste personnel. |
| `src/app/api/steam/callback/route.ts` | 1 : communauté active du geste personnel. |
| `src/app/roulette/actions.ts` | 1 : soirée créée. |
| `src/app/sessions/actions/session-lifecycle.ts` | 1 : soirée créée. |
| `src/app/sessions/actions/proposals-votes.ts` | 1 : soirée de la proposition. |
| `src/app/sessions/actions/results.ts` | 2 branches : soirée des résultats. |
| `src/lib/sessions.ts` | 2 chemins de participation : soirée. |
| `src/lib/instant-sessions.ts` | 1 : session instantanée. |
| `src/lib/roulette.ts` | 1 : roulette source. |
| `src/lib/pronostics.ts` | 1 : soirée source. |
| `src/lib/superlative-voting.ts` | 1 : soirée source. |
| `src/lib/weekly-challenges.ts` | 1 : défi source. |
| `src/lib/tournaments.ts` | 3 placements : tournoi source. |
| `src/lib/xp-bets.ts` | 1 : soirée du pari. |
| `src/lib/badges.ts` | 2 : attribution et réparation d'un gain manquant dans le serveur du badge. |

Les écritures silencieuses `awardXpRaw` / `unlockBadgeRaw` des backfills ont
également été contrôlées. Les déclencheurs de badges (création, votes,
participation, superlatifs, défis, pronostics, mises, tournois, imports de
bibliothèque et temporalité) transmettent le serveur source ou le serveur actif.
`getCurrentUser` touche uniquement le streak de la communauté autorisée.
Les inscriptions/désinscriptions mettent le compteur de tournoi à jour seulement
si la participation change réellement.

### Concurrence et interruptions

- Les writers de progression prennent `Community FOR SHARE`, puis revalident
  `Membership ACTIVE` sous verrou lorsque l'isolation est active.
- La saison prend `Community FOR UPDATE` avant son claim et son snapshot. Cela
  couvre aussi le **premier INSERT** de statistiques d'un nouveau membre pendant
  le reset, sans dépendre de la présence préalable d'une ligne stats.
- Ledger XP, incrément atomique du solde et événement de niveau sont dans la
  même transaction. Le solde précédent est dérivé du résultat de l'incrément,
  et non d'une lecture qui pourrait être dépassée par un gain concurrent.
- Le streak relit sa ligne `FOR UPDATE` ; des chargements concurrents ne
  produisent pas plusieurs incréments.
- Un badge déjà persisté dont le gain XP manque est réparé idempotemment,
  même si son catalogue est désactivé ou si son ancien seuil de streak est perdu.
- Les reprises live vérifient les gains historiques conservés dans default.
  Pour les paris et pronostics, le crédit XP, la notification in-app et
  l'intention Discord partagent désormais une transaction. La clé durable
  `xp-reward:<XpEvent.id>` permet aussi de réparer un crédit sans intention,
  sans recréditer le solde. Les replays concurrents ne multiplient pas les
  notifications ; une notification in-app purgée n'est pas recréée au replay.
- Une désinscription historique hors `default`, sans compteur attribuable,
  ne crée pas de valeur négative.

Référence du verrouillage : [PostgreSQL 16 — explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html).
Les clés composites et incréments transactionnels ont été vérifiés avec la
documentation officielle Prisma via Context7.

### Annonces et configuration

`postToCommunity` englobe aussi la résolution de `default` dans sa garantie
best effort : toute erreur est loggée et retournée, sans faire échouer
l'attribution pour une résolution de destination.

Avec le transport bot actif, les actions écrivent une intention dans la file
existante (`REWARD` / `COMMUNITY_SYSTEM_ANNOUNCE`), avec payload et provenance.
Seul l'executor appelle Discord. À la livraison : flags relus, communauté ACTIVE,
destinataires personnels encore membres ACTIVE, salon résolu à nouveau, puis
vérification que le salon appartient réellement au guild attendu avant POST.
Le webhook historique est réservé à `default` avec bot inactif ; ses mentions
personnelles sont également revalidées. Pour les gains de paris et pronostics,
ce webhook passe lui aussi par l'outbox et requiert donc l'executor et son flag
maître. Il n'est plus appelé directement après le crédit. Le client REST
partage les délais/reprises du bot, sans envoyer son en-tête Authorization
au webhook. Les autres usages historiques de `postToCommunity` restent inchangés.
`ok` côté bot signifie **mis en file**,
pas livré. Le flag maître OFF empêche toute livraison.

Un serveur nondefault sans salon ou guild configuré n'emprunte jamais les
variables d'environnement de `default`, même si les flags de salons sont OFF.
Un nouveau serveur passe par configuration et installation du bot : aucun ID
de serveur codé en dur, aucune nouvelle migration spécifique au serveur.

## Migration et conservation

Une seule nouvelle migration : `20261006190000_community_progression`.
Les 71 migrations précédentes restent immuables.

1. Crée `default` si elle manque, puis `CommunityMemberStats`.
2. Copie **exactement** les colonnes historiques `User` et le compteur
   `UserLifetimeStats` dans `default`. Ne recalcule pas le solde depuis la somme
   XP : celle-ci ne retrace pas les débits de mises et resets mensuels.
3. Rattache tous les événements XP/niveaux et badges historiques à `default`.
   Remplace seulement les deux index uniques globaux par leurs clés composites.
4. Backfill la provenance des résultats et notifications depuis leurs parents
   encore présents ; distingue les catégories lorsque deux modèles ont le même
   `sourceId`. Pour les sources introuvables ou déjà purgées : `default`.
5. Ajoute `NotificationEvent.payload` et les index de lecture.

Aucun `DROP TABLE`, aucune suppression de colonne ou de ligne historique.
Les deux `DROP INDEX` remplacent des contraintes globales devenues inadéquates.
Les nouveaux journaux/statistiques n'ont pas de FK vers `Community` : une
suppression de communauté ne transforme pas leur provenance en `default`.
La FK utilisateur existante reste conservée.

La rétention garde les résultats, récompenses, ledgers et statistiques durables.
Une dette impayée bloque toujours la cascade du parent autorisé, même si sa
provenance est incohérente ou désigne un serveur suspendu. Les définitions de
badges/superlatifs sont archivées plutôt que supprimées avec leurs acquis.
Les livraisons fixes ou non terminales gardent leur politique de conservation.
`NotificationEvent` reste un journal durable ; ses nouveaux payloads peuvent
contenir contenu et destinataires, ils ne sont pas présentés comme anonymes.

## Validation locale initiale (avant correctifs de revue)

Environnement : Windows, Node 24.19.0, Prisma 6.19.3, Next.js **16.3.8** et
Vitest 4.1.11. Un `npm ci --ignore-scripts` a remis les dépendances au niveau du
verrou ; le client Prisma a ensuite été généré explicitement.

Docker indisponible : binaires portables PostgreSQL **16.15**, publiés par EDB
depuis la [page officielle PostgreSQL Windows](https://www.postgresql.org/download/windows/).
Cluster jetable dans `%TEMP%`, écoute uniquement `127.0.0.1:55439`. Bases neuves
distinctes pour main, PR B et répétitions historiques. `fsync` et
`synchronous_commit` désactivés sur ce cluster temporaire pour réduire le coût
des TRUNCATE ; cela ne simule pas la résistance aux crashs. Aucun Neon, aucune
notification réelle. Les suites et mutations Postgres sont **en série**.

| Contrôle | Résultat |
| --- | --- |
| Baseline main `3b484ed`, migrations/client à jour | 158 fichiers, 1861 tests : 1857 réussis, 4 échecs reproduits ; aucun skipped. Reproduite aussi dans une copie intacte de main avec les versions verrouillées : même résultat, 270,68 s. |
| Migration main → PR B, base historique avec default | Réussie : conservation de toutes les anciennes colonnes/IDs, solde 137 distinct du ledger 999, streaks, badge, compteur 11, collisions sourceId, résumés orphelins. |
| Même répétition sans default | Réussie : default recréée, mêmes assertions, clés indépendantes et provenance conservée après purge du parent et suppression du serveur. |
| Prisma | Migration deploy sur base neuve, validate, generate et migrate diff : aucune dérive. |
| Suite complète PR B, sources stabilisées | 162 fichiers, 1955 tests : **1951 réussis, les mêmes 4 échecs que main**, aucun skipped ; 309,65 s. Aucun nouvel échec. La suite complète n'est donc pas verte. |
| Tests ciblés A/B | 33 tests progression/concurrence, 10 tests de vues réelles et 24 tests admin/rétention réussis, ainsi que les tests d'annonces et les gardes statiques dans la suite complète. |
| Mutations | **58 protections distinctes retirées temporairement, toutes détectées (58/58)** : progression, lectures, annonces, admin et rétention. Rapports de 53 puis 5 cas complémentaires ; sources restaurées avec SHA-256. |
| TypeScript / ESLint / Next | typegen et tsc réussis, ESLint sans avertissement, build Next 16.3.8 réussi sur les sources finales. |

Commandes reproductibles (shell avec URL **locale** uniquement) :

```text
DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_prb_final
TEST_DATABASE_URL=<même URL locale>
npx prisma generate
npx prisma migrate deploy
npm run test:postgres
node scripts/verify-community-progression-migration.mjs
node scripts/verify-community-progression-mutations.mjs
npx next typegen
npx tsc --noEmit
npm run lint
npx next build
```

Les scripts de validation exigent `127.0.0.1`. Le runner de mutations exige aussi
l'absence de secrets Discord ; les tests ciblés mockent le réseau. Ses tests
hors cible exclus par `-t` sont enregistrés comme non exécutés, jamais comme
réussis : 1434 occurrences d'exclusion sur les 58 runs, pas 1434 tests distincts.
Le compteur accepte les statuts Vitest `skipped` et `pending` ; une répétition
du mutant `profile-season` confirme 1 échec attendu et 9 tests hors cible.
La suite complète finale n'a aucun test ignoré. `npm run build` n'est pas utilisé :
il déploierait les migrations.

Les derniers journaux locaux sont conservés dans `%TEMP%` :
`gamenight-prb-baseline-locked.log`, `gamenight-prb-postgres-delivery.log`,
`gamenight-prb-migration-delivery.log` et `gamenight-prb-build-delivery.log`.
Les rapports de mutations sont dans `gamenight-prb-mutations-MN4jwW/report.json`
et `gamenight-prb-mutations-4VINoU/report.json`. Les passages intermédiaires
avec fixtures incomplètes ou sources modifiées pendant un run ne sont pas
présentés comme la validation finale ; ils ont été suivis de corrections,
de vérifications ciblées et du passage complet ci-dessus.

### Échecs reproduits sur main : noms exacts

| Fichier | Nom exact du test | Résultat baseline |
| --- | --- | --- |
| `discord-thread-cleanup.integration.test.ts` | `archivage : 429 retry_after=12 s → reprogrammé à +12 s (pas le backoff générique), inatteignable avant, rejoué ensuite` | Livraison réclamée à +5 s au lieu de `null`. |
| `notification-executor.integration.test.ts` | `runExecutorBatch propage sa propre échéance à chaque livraison traitée (pas seulement entre deux réclamations)` | 8 traitements au lieu de 1. |
| `session-announce.integration.test.ts` | `une fois le fil créé, le rappel en attente devient éligible et part dans le fil` | `retrying` au lieu de `sent`. |
| `session-announce.integration.test.ts` | ``le nettoyage attend tant que le SEND `thread` reste PENDING avec une reprise PROGRAMMÉE (échec retryable pas encore retraité) — jamais un raccourci qui suppose son sort`` | `resolver:expired` au lieu de `resolver:dependency_not_ready`. |

Le rapport Claude « 1861 tests tous verts » n'a pas été pris comme baseline.
Ces tests ne sont ni supprimés, ni ignorés, ni affaiblis pour publier la PR.

## Correctifs de revue du 7 octobre 2026

La lecture des badges d'un pote vérifie désormais les deux Membership ACTIVE
dans la communauté sélectionnée lorsque l'isolation est active. Le scénario
lecteur dans A/B, pote retiré de A mais encore dans B, sélection A, renvoie
`notFound` ; sélectionner B permet la lecture. Flags OFF conserve la lecture
historique de default sans exiger de Membership.

Les gains de paris et pronostics utilisent l'intention durable décrite plus
haut. Les tests couvrent une interruption immédiatement après commit, un
échec du contrôle des badges, la réparation d'un ancien crédit, les replays
concurrents, le rollback si la persistance échoue et le replay après purge
in-app. Les deux transports sont simulés, sans appel Discord réel. Le journal
à occurrence vide reste conservé par la rétention technique : il porte la
preuve d'idempotence après purge du parent ou de la notification in-app.

### Diagnostic des quatre échecs locaux

Les quatre tests ci-dessus ont été exécutés réellement, en série, sur la même
base PostgreSQL 16.15 locale isolée, avec des connexions neuves pour chaque
fuseau. Avant correction : 4/4 réussis sous UTC, les quatre échecs reproduits
sous Europe/Paris. Après correction : 4/4 réussis sous chaque fuseau, avec
les attentes d'origine. Les 115 tests hors cible par passage sont des exclusions,
pas des tests réussis.

| Mesure SQL | UTC | Europe/Paris |
| --- | --- | --- |
| `SHOW TimeZone` | `UTC` | `Europe/Paris` |
| Type de `NotificationDelivery.nextAttemptAt` | `timestamp without time zone` | Identique |
| `pg_typeof` du paramètre Prisma `Date` | `timestamp with time zone` | Identique |
| Échéance stockée 12:00:12 UTC, comparaison implicite à 12:00:05 UTC | Future | Éligible à tort |
| Même comparaison avec paramètre converti `AT TIME ZONE 'UTC'` | Future | Future |

La cause est donc démontrée par la mesure SQL et la reproduction, et non
déduite du fuseau de la machine. `claimNextDelivery` convertit explicitement
son paramètre en timestamp UTC avant comparaison. Une régression intégration
force Europe/Paris sur la base locale puis restaure son réglage. Le script
`node scripts/diagnose-notification-timezone.mjs --expect-pass` reproduit les
mesures et les quatre tests ; il exige une base `gamenight_prb_*` sur 127.0.0.1.

### Validation des correctifs

- Tests ciblés : 169 tests réussis dans huit fichiers (le test webhook 429
  a été relancé après correction de sa fixture `allowedMentions`).
- Mutations pertinentes : 11/11 détectées, sources restaurées avec SHA-256
  (intention, reprise, atomicité, rétention/replay, pote retiré, fuseau,
  suspension, guild, destinataire et deux replis de salon).
- Les 72 migrations restent inchangées. La répétition historique depuis main
  avec puis sans default confirme à nouveau conservation, solde exact,
  clés séparées, provenance durable et absence de dérive Prisma.
- Suite complète Postgres en série : 163 fichiers, 1973/1973 tests réussis,
  aucun skipped. Dernière passe répétée après restauration des textes UTF-8.
- Next typegen, TypeScript et ESLint réussis ; `next build` 16.3.8 réussi
  sur les sources finales. L'accès réseau aux polices Google a été requis ;
  aucun appel Discord ni migration lancé par le build.

Journaux : `%TEMP%/gamenight-prb-timezones-before.log`,
`gamenight-prb-timezones-after.log`, `gamenight-prb-fixes-targeted-final.log`,
`gamenight-prb-fixes-webhook.log`, `gamenight-prb-fixes-migration.log`,
`gamenight-prb-fixes-mutations.log`, `gamenight-prb-fixes-postgres-final.log`
et `gamenight-prb-fixes-build-final.log`. Rapport des mutations :
`gamenight-prb-mutations-Vhr2UV/report.json`.

## Revue du diff et limites

Un snapshot des fichiers modifiés **et non suivis**, dont `.codex/` et `AGENTS.md`,
a été conservé dans `%TEMP%/gamenight-prb-snapshot-i0Pp5g`. Ces deux éléments
utilisateur ne sont pas ajoutés à la PR. Audit de tous les fichiers modifiés,
incluant les 33 auparavant signalés : UTF-8 valide, sans BOM ajouté,
caractère de remplacement ou corruption détectée. Les fins de ligne d'origine
ont été rétablies lors de l'audit initial de 55 fichiers, puis recontrôlées
après les dernières modifications ; leurs modifications fonctionnelles sont
conservées. Aucun fichier ne change uniquement par ses fins de ligne.
53 entrées fichier/modèle d'exceptions devenues inutiles ont été retirées ; aucune nouvelle
exception ajoutée. La garde statique ne vérifie pas les include imbriqués ou
le SQL brut : ils sont contrôlés par tests d'intégration et mutations ciblées.

- Les acquis globaux historiques ne permettent pas de reconstruire leur ancien
  serveur ; ils restent dans `default`, même si un utilisateur rejoint B.
  Le compteur historique des tournois n'est pas redistribué à partir de parents
  déjà purgés. Les nouveaux gains sont séparés dès cette migration.
- La reprise des annonces n'offre pas d'« exactement une fois » entre Postgres
  et Discord si le processus tombe après l'acceptation HTTP et avant sa
  finalisation. Les récompenses XP et badges sont, elles, idempotentes en base.
- Catalogues et configuration de plateforme restent partagés. `NotificationEvent`
  / Delivery ont des accès système légitimes ; leurs chemins admin/rétention
  sont filtrés explicitement, sans élargir la liste d'exceptions statiques.
- L'audit conserve sa borne d'échantillonnage existante (2000 parents terminaux).
- Context7 a répondu pour Prisma/Next. Firecrawl était inutilisable avec son
  jeton. Headroom n'a pas été contourné après rejet. Graphify sans graphe du
  dépôt et claude-mem sans résultat exploitable n'ont pas servi de preuve.

## Contrôles utilisateur avant production

1. Vérifier base `main`, revue du diff, checks GitHub `verify` et build Vercel.
   Garder Draft tant que les validations distantes ne sont pas acceptées.
2. Sauvegarder la base avant tout merge autorisé ; vérifier la migration
   `20261006190000_community_progression` dans `_prisma_migrations` après un
   déploiement décidé par l'utilisateur. Aucun rollback du seul code ancien
   sans stratégie compatible avec les nouvelles clés.
3. Contrôler les soldes/streaks/badges et compteurs historiques de default,
   l'absence de suppression de résultats, puis les profils et classements.
4. Dans un environnement de test ultérieurement autorisé : installer le bot,
   configurer guild/salons et Membership, tester un utilisateur membre de A/B,
   un retrait, une suspension et un salon manquant ou appartenant à un autre
   guild. Tester annonces/récaps via la file. Ces essais Discord **n'ont pas été
   exécutés** pendant cette tâche.
5. Examiner les logs de doubles attributions, P2002, P2025 et les budgets de
   rétention ; comparer dry-run et exécution avant activation décidée par
   l'utilisateur. Aucun flag activé ici, aucun merge.
