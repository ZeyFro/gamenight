# Audit 02 — Bot Discord, tâches planifiées, sauvegarde

Audit en lecture seule (code et docs, aucune exécution contre Discord, Vercel ou Neon). Un constat par ligne : **Gravité | Où | Preuve | Correctif**. Gravités : 🔴 bloquant lancement · 🟠 important · 🟡 mineur · 🟢 OK vérifié.

## 1. Bot Discord (réponse < 3 s, signature, débit)

| Gravité | Où | Preuve | Correctif |
|---|---|---|---|
| 🟢 | `src/lib/discord-signature.ts` | Ed25519 (`createPublicKey` + `verify(null, timestamp + rawBody, …)`), `false` sur toute entrée invalide, corps brut lu avant parsing. | Aucun. |
| 🟢 | `src/lib/discord-interactions.ts` | 503 sans `DISCORD_APP_PUBLIC_KEY`, 401 signature invalide, 400 JSON/schéma invalide ; PING (type 1) acquitté même éteint. | Aucun. |
| 🟢 | Commandes slash (`discord-*-command(s).ts`) et boutons RSVP | Toutes répondent `{type:5, flags: EPHEMERAL}` (réponse différée) AVANT tout accès base ; le travail tourne dans `after()` (`route.ts`, `maxDuration = 120`) ; suite via `editSetupResponse` (PATCH webhook, budget 10 s, repli d'erreur). Le délai de 3 s ne dépend donc pas du réveil de Neon. | Aucun. |
| 🟢 | Fenêtre anti-rejeu | Chaque handler refuse un timestamp à plus de 300 s et un `application_id` inattendu. | Aucun. |
| 🟠 | `src/lib/discord-autocomplete.ts` (tournois, soirées, rôles) | L'autocomplétion (type 4) ne peut pas être différée et interroge la base AVANT de répondre. Avec une base Neon endormie (démarrage à froid de plusieurs secondes), la réponse dépasse 3 s : Discord affiche « chargement échoué ». | Répondre une liste vide ou statique si la requête dépasse ~2 s (course `Promise.race`) ; cache mémoire court des listes (jeux, rôles) ; ping `/api/health` toutes les 5 min par le planificateur externe pour garder la base éveillée aux heures de pointe. |
| 🟡 | Suivi des 15 min (jeton d'interaction) | Les `run*` plafonnent à `REPLY_BUDGET_MS = 10_000` ; au-delà, message d'erreur. Aucune reprise automatique. | Acceptable ; documenter dans `docs/RUNBOOK.md` que l'utilisateur doit relancer la commande. |
| 🟡 | Débit sortant (429 Discord) | `discord-rest.ts` gère les réponses d'erreur, mais aucune mesure du nombre de 429 n'est exposée. | Compter les 429 dans `logger.warn` avec la route (déjà visible dans les journaux Vercel, 1 h seulement : voir § 3). |

## 2. Tâches planifiées (Vercel Hobby, DST du défi de 18 h)

| Gravité | Où | Preuve | Correctif |
|---|---|---|---|
| 🔴 | `vercel.json`, `docs/CRONS.md`, `docs/LANCEMENT_GO.md` (D1 ⬜) | `vercel.json` ne déclare aucun cron : aucune tâche n'est lancée par Vercel. Tout le travail de fond (executor de notifications, rappels, clôture des soirées, balayages) dépend d'un planificateur EXTERNE (cron-job.org) dont `docs/CRONS.md` précise qu'aucun job n'est affirmé comme créé. Sans lui : plus de MP, plus de rappels, plus de clôtures. | Avant le lancement : créer les jobs listés dans `docs/CRONS.md`, noter dans `LANCEMENT_GO.md` (D1) la liste réelle, activer l'e-mail d'échec de cron-job.org, et tester chaque route avec `Authorization: Bearer <CRON_SECRET>` (202 attendu). |
| 🔴 | `.github/workflows/tower-team-daily.yml` (`0 16,17 * * *`, garde « heure de Paris == 18 ») | Les workflows planifiés GitHub peuvent être retardés de plusieurs dizaines de minutes aux heures chargées. Deux créneaux (16 h et 17 h UTC) couvrent l'été (18 h = 16 h UTC) et l'hiver (17 h UTC) ; mais si GitHub retarde le créneau de plus d'1 h, l'heure de Paris passe à 19 et la garde du workflow saute la journée. La route `isTowerTeamDailyDue` accepte pourtant « heure de Paris ≥ 18 » et la clé `team-<jour de Paris>` rend l'appel idempotent : la garde du workflow est plus stricte que la route. | Retirer la garde `== 18` du workflow (laisser la route décider avec `≥ 18` et l'idempotence) et ajouter un 3ᵉ créneau de rattrapage ; ou appeler la route depuis cron-job.org en fuseau `Europe/Paris` à 18:00. |
| 🟠 | DST (changements d'heure 29/03 et 25/10) | Les créneaux UTC fixes couvrent les deux régimes ; `getTowerParisDayKey` calcule le jour en `Europe/Paris`, donc pas de doublon ni de trou le jour du changement. Aucun test ne simule les deux nuits de bascule. | Ajouter deux tests unitaires de `isTowerTeamDailyDue` / `getTowerParisDayKey` aux dates de bascule (30 mars et 26 octobre 2027, par ex.). |
| 🟠 | GitHub Actions | GitHub désactive les workflows planifiés d'un dépôt sans activité pendant 60 jours ; le défi quotidien s'arrêterait en silence. | Dépôt actif (PR fréquentes) : risque faible, mais ajouter une vérification mensuelle dans le point de contrôle d'exploitation. |
| 🟠 | Vercel Hobby | Cron natif Vercel Hobby : 2 jobs max, 1 exécution par jour, précision ±59 min : inutilisable pour l'executor (minutes) et le défi de 18 h (précision). Plafond de 100 déploiements par jour : une rafale de PR et de previews peut bloquer le build (« Deployment rate limited », déjà observé). | Garder le planificateur externe ; limiter les previews via `scripts/vercel-ignore-build.mjs` (PR docs seules ignorées). |
| 🟡 | Routes longues | Toutes répondent 202 et travaillent dans `after()` ; `maxDuration` borné ; timeout de cron-job.org 30 s sans effet. | Aucun. |
| 🟡 | `GET /api/health` | Existe (bearer `CRON_SECRET`, `SELECT 1`, 200/503) mais aucun appelant n'est prouvé. | Planifier l'appel (voir § 3, alerte de panne). |

## 3. Sauvegarde, restauration, journaux, alerte de panne

| Gravité | Où | Preuve | Correctif |
|---|---|---|---|
| 🔴 | `docs/LANCEMENT_GO.md` A4 🔴, `docs/MIGRATIONS.md` (critère 3 ⬜), `docs/CAPACITE.md` | Offre gratuite Neon : historique de restauration de 6 h seulement, aucune sauvegarde longue durée. Aucune preuve qu'une restauration ait été essayée : la procédure existe (créer une branche à l'instant voulu, compter des lignes d'une table connue) mais le critère « restauration éprouvée » est resté ⬜. Une erreur de données découverte après 6 h est irrécupérable. | Avant le lancement : (1) faire l'essai de `docs/audit/procedure-restauration.md` et noter la date et la durée dans `LANCEMENT_GO.md` ; (2) créer une branche de sauvegarde datée juste avant l'ouverture ; (3) planifier un export logique hebdomadaire hors Neon (`pg_dump` depuis un poste de confiance, jamais en CI avec un secret de production). |
| 🔴 | `docs/LANCEMENT_GO.md` D2 🔴 | Aucune alerte de panne : personne n'est prévenu si le site ou la base tombe. Le point d'accès de santé n'a pas d'appelant. | Créer un job cron-job.org quotidien/5 min sur `/api/health` avec e-mail à Maxime en cas d'échec (cf. lot I `HOSTING_ALERT_ENABLED`) ; sinon un moniteur de disponibilité gratuit sur la page de connexion. |
| 🟠 | Journaux | Vercel Hobby conserve 1 h de journaux ; `src/lib/logger.ts` n'écrit que dans `console` (pas de Sentry ni de table d'erreurs : aucun modèle d'erreurs dans `prisma/schema.prisma`). Une erreur survenue la nuit est perdue au matin. | Sans nouvelle dépendance : journal d'erreurs minimal en base (table additive, purge à 30 jours) pour les `logger.error` des routes cron et du bot ; ou, avec accord, un puits de journaux gratuit. |
| 🟠 | `docs/CAPACITE.md` | 100 h de calcul Neon par mois : aucune mesure automatique. Un dépassement coupe la base. | Relever la consommation dans la console Neon chaque semaine pendant le premier mois ; alerte à 80 %. |
| 🟡 | Branche `backup-avant-tower-migrations-20261030` | Doc : ne jamais la supprimer ; à ce jour aucune garde automatique. | Mentionner dans le runbook de la renommer en `ne-pas-supprimer-…` si la console le permet. |
| 🟢 | `scripts/restore-fingerprint.*`, `precheck-production.yml` | Empreinte de restauration en lecture seule et précontrôle Production existent. | Aucun. |

## Procédures

La procédure pas à pas de restauration est dans [`procedure-restauration.md`](procedure-restauration.md).

### Contrôle de planification (à faire une fois avant le lancement)

1. Lister les routes de `docs/CRONS.md`, créer un job par route dans cron-job.org (méthode, en-tête `Authorization: Bearer <CRON_SECRET>`, cadence documentée).
2. Déclencher chaque job à la main ; attendre 202 (ou 200) et lire la ligne « dernier statut ».
3. Activer l'e-mail d'échec ; provoquer un échec (secret faux) et vérifier la réception.
4. Défi de 18 h : le lendemain du changement d'heure, vérifier dans la base qu'une seule ligne `team-<jour>` existe.

## Synthèse

- 🔴 : 4 (planificateur externe non prouvé ; garde du workflow de 18 h trop stricte ; restauration jamais éprouvée avec 6 h d'historique ; aucune alerte de panne).
- 🟠 : 6 (autocomplétion et base endormie ; tests DST absents ; désactivation GitHub à 60 jours ; limites Vercel Hobby ; journaux 1 h ; calcul Neon non mesuré).
- 🟡 : 5.
- 🟢 : 5 vérifiés (signature, ACK différé, fenêtre anti-rejeu, routes longues, empreinte).
