# Livraison XP, boutique et grades : commandes et contrôles définitifs

Protocole, pas une autorisation : rien n'est prouvé pour Production. Contexte, impacts, barrière des writers, sauvegarde et récupération : `docs/XP-ROLLOUT-DECISION-20261019.md` (non dupliqué ici). Équilibrage : `docs/XP-BALANCE-20261019.md`. Recette boutique : `docs/RECETTE-BOUTIQUE-20261023.md`. Admin : `docs/ADMIN_CORRECTION_XP.md`.

Le lot = 6 migrations, dans cet ordre, appliquées en UNE exécution, AVANT le déploiement du code :

```
20261019190000_separate_xp_balance,20261020150000_session_voice_presence,20261022120000_voice_presence_consent_coordination,20261022130000_voice_presence_retention_gap_bounds,20261022140000_voice_presence_gap_history,20261022142500_shop_balance_purchase_reason
```

Dans les commandes, `$LOT` désigne cette liste, `$BASE` le nom de la base cible. Aucune URL ni mot de passe n'est affiché par les scripts ; ne jamais en coller dans un ticket.

## 0. Prérequis (hors dépôt, à la charge de l'opérateur)

Barrière d'écriture vérifiée sur anciens et nouveaux runtimes, dump custom restauré dans une cible isolée, rôle de migration distinct du rôle runtime : voir « Séquence de bascule » de la décision de publication. Sans cela, ne pas continuer.

Procédure Production complète, ordonnée et non exécutée (décisions D2 option B, D3 snapshot + restauration de test) : `docs/XP-PROCEDURE-PRODUCTION.md`. Retours arrière par migration : `docs/XP-MIGRATIONS-ROLLBACK.md`.

## 1. Précontrôles (lecture seule)

Sur le checkout approuvé :

```
node scripts/check-xp-rollout-migration-gate.mjs
XP_INVARIANTS_DATABASE_URL=<url lecture> node scripts/xp-lot-invariants.mjs --phase=before
```

`--phase=before` exige : les 6 migrations absentes, aucune migration inachevée, aucun objet du lot, aucun `xpTotal < 0`. Noter la ligne `EMPREINTE <md5>` (progression + équipements + objets possédés, `xpBalance` exclu) et les comptes affichés. Hors machine locale, le script refuse sauf `XP_INVARIANTS_ALLOW_REMOTE="<hôte>[:port]/<base>"` identique à la cible. La transaction est `READ ONLY` (vérifiée par `SHOW transaction_read_only`).

Équivalent SQL manuel (lecture seule) :

```sql
SELECT count(*) AS membres, min("xpTotal") AS xp_min, max("xpTotal") AS xp_max,
       count(*) FILTER (WHERE "xpTotal" < 0) AS negatifs FROM "CommunityMemberStats";
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
WHERE (finished_at IS NULL AND rolled_back_at IS NULL) OR rolled_back_at IS NOT NULL;
SELECT pg_size_pretty(pg_total_relation_size('"CommunityMemberStats"'));
```

## 2. Dry-run puis exécution

```
MIGRATION_DATABASE_URL=<url directe, rôle de migration> GAMENIGHT_RUNTIME_ROLE=<rôle runtime> \
GAMENIGHT_EXPECTED_TARGET="<hôte>[:port]/<base>" node scripts/db-migrate.mjs --expect=$LOT
# relire la liste « À appliquer » (6 lignes, sha256) puis, une seule fois :
... node scripts/db-migrate.mjs --expect=$LOT --execute --confirm-database=$BASE
```

Option B (décision D2, rôle partagé) : le runner de #370 refuse par défaut un rôle de migration identique au rôle runtime ; ajouter `--allow-shared-role` aux DEUX commandes (message « MODE DÉGRADÉ ») seulement après un snapshot Neon frais vérifié immédiatement avant `--execute`. Cette option et la garde chronologique viennent du runner de #370, adopté tel quel à la fusion de `main` (phase 4) ; avant, le runner de cette branche n'a pas l'option.

Codes de sortie : 0 ok, 2 refusé, 3 migration en échec, 4 contrôle après migration en échec. Sur 3 : ne pas relancer ni `migrate resolve` sans revue de l'état exact. Ne jamais appliquer seulement une partie du lot. (En local : ajouter `--allow-local`, base `gamenight_*`.)

## 3. Contrôles après migration (avant toute réouverture des écritures)

```
XP_INVARIANTS_DATABASE_URL=<url lecture> node scripts/xp-lot-invariants.mjs --phase=after --expect-fingerprint=<md5 du précontrôle>
```

Attendu : `INVARIANTS OK (phase after)` ; 6 migrations terminées ; objets présents (colonne `xpBalance`, contrainte `CommunityMemberStats_xpBalance_nonnegative` validée, valeur d'enum `XpReason.SHOP_BALANCE_PURCHASE`, tables et colonnes vocales) ; `xpBalance = xpTotal` partout ; aucun négatif ; même empreinte et mêmes comptes (membres, événements, objets) qu'au précontrôle. Pas de navigation authentifiée sur Production (`touchStreak` peut écrire sur un simple GET).

Après réouverture, la phase `reopened` (mêmes contrôles sans l'égalité des compteurs, qui diverge légitimement après un achat) sert aux relevés périodiques.

## 4. Critères de réouverture et de repli

- Réouverture seulement si : section 3 entièrement verte, barrière confirmée, droits accordés au nouveau runtime seul.
- Pas de réouverture, maintenir la maintenance : un échec de la section 3, une migration inachevée, une empreinte différente.
- Repli avant réouverture : restaurer dans une cible isolée puis remettre l'ancien code (décision de publication, « Récupération »). Après réouverture : correction applicative ; ne jamais recopier `xpBalance = xpTotal` ni `xpTotal = xpBalance`.

## 5. Ce qui est vérifié localement (23 octobre, base jetable 127.0.0.1)

- `src/lib/xp-counters.integration.test.ts` : une assertion sur les deux compteurs pour gain, pari posé/gagné/perdu, solde au prix exact et un point en dessous, équipement/retrait sans débit ni événement, pénalité plafonnée (progression et solde non négatifs), grade/niveau à 5 000 XP (niveau 11) avec solde épuisé, ancien `SHOP_PURCHASE` conservé et nouvel achat exclu du classement par période. Complète `xp-shop`, `admin-xp` (correction), reset de saison et migration.
- `src/lib/xp-lot-invariants.integration.test.ts` : état main (sans les 6), dry-run et exécution réelle de `db-migrate.mjs`, phase `after` avec empreinte identique, dérive d'un ancien writer, xpTotal négatif avant le lot, migration inachevée, refus de cible distante, lecture seule.
- Durée et verrous : mesurés en local sur trois volumes (section 8) ; volume Production réel : non connu au moment de l'écriture (comptage lecture seule à produire par le propriétaire).

## 6. Intermittence du scénario « achats historiques » de `scripts/recette-boutique.mjs`

Cause **non démontrée**. Ne pas confondre les passages historiques avec la tête actuelle :

- Deux anciens passages complets sur une base dédiée (Turbopack, Chrome headless) : 4/4 et 4/4. Après le changement du délai des transactions boutique, un nouveau passage complet a fait 3/4 : « achats historiques » a échoué et Docker/Postgres est devenu injoignable. Le passage isolé de ce scénario avait réussi **avant** ce changement. Aucun passage complet 4/4 n'a été obtenu après le correctif; les anciens 4/4 ne valident donc pas la tête actuelle.
- Le journal Next de la dernière exécution dans `gnw\integ` (lecture seule) se termine sur le second `GET /classement?periode=week` du scénario historique (12 s, `POST` d'achat à 46 s) : l'échec survient donc entre cette page et `stats()`, sur une machine très chargée ; le message complet de l'échec n'a pas été conservé.
- Exclu par lecture du code : aucune route de l'application ne supprime de ligne `CommunityMemberStats` (seul `seasons.ts` fait un `updateMany` à 0, qui produirait une assertion sur `xpTotal`, pas une erreur Prisma) ; les fixtures sont supprimées en fin de run par préfixe unique, jamais pendant les scénarios.
- Hypothèses restantes, non confirmées : (a) un `TRUNCATE` d'une autre suite d'intégration sur une base partagée (injecté volontairement ici pendant ce scénario : il produit un timeout de la page classement et « 0 utilisateur supprimé », pas l'erreur observée ; l'hypothèse ne tient que si le `TRUNCATE` tombe après le dernier chargement) ; (b) une perte de connexion à PostgreSQL (le moteur Docker s'est arrêté pendant un run précédent). Le délai de 15 s des transactions boutique a corrigé les `P2028` mais ne résout pas ce point.
- Le point n'est toujours pas tranché : conserver `logs/recette-boutique-next.log` et le message Prisma complet, puis relancer sur une base réservée à la recette et relever `pg_stat_database` (`xact_rollback`) et les `TRUNCATE` concurrents. À la reprise du 26/10, Docker Desktop ne démarre pas; aucune recette Postgres/navigateur nouvelle n'a été exécutée.

## 7. Recalage du solde après migration (`scripts/xp-balance-reconcile.mjs`)

Filet de la décision D2 (rôle partagé, barrière hors rôle). La migration `separate_xp_balance` fixe `xpBalance = xpTotal`. Tant que l'ancien code tourne encore, il écrit `xpTotal` (et le ledger, ou la table des paris) sans connaître `xpBalance` : gains, `SHOP_PURCHASE`, paris, pénalités, corrections admin, reset de saison. Le script ramène `xpBalance` à la valeur attendue ; il ne modifie JAMAIS `xpTotal`, le ledger, ni les objets.

**Formule** : `cible = max(0, xpTotal + somme(XpEvent SHOP_BALANCE_PURCHASE.amount depuis --since))`. Le nouveau code tient `xpBalance = xpTotal` partout sauf pour les achats de boutique (seuls à débiter `xpBalance` seul, montants négatifs) ; le calcul est donc sans état, et un second passage ne trouve rien. Un ancien achat `SHOP_PURCHASE` fait après la migration baisse `xpTotal` (comme avant) : le solde le suit, la progression reste baissée du même montant (pas de restitution automatique).

**Quand** : après la migration et avant la réouverture des écritures du nouveau code (section 3 verte, barrière encore posée), puis à nouveau si un doute subsiste. Après réouverture, la formule reste exacte pour les joueurs sans achat du nouveau code ; ceux qui en ont (« mixtes ») ne sont plus recalés d'office (voir plus bas).

**Commande** (rôle autorisé à écrire `CommunityMemberStats`, par exemple le rôle de migration ; aucune URL n'est affichée) :

```
XP_RECONCILE_DATABASE_URL=<url> [XP_RECONCILE_ALLOW_REMOTE="<hôte>[:port]/<base>"] node scripts/xp-balance-reconcile.mjs [--since=<ISO>]
# relire le rapport puis, une seule fois :
... node scripts/xp-balance-reconcile.mjs --execute --confirm-database=$BASE [--since=<ISO>]
```

- Dry-run par défaut (transaction `READ ONLY`). `--execute` exige `--confirm-database=<base de l'URL>` ; sans lui, refus (2) sans écriture.
- Cible : base locale `gamenight_*` ou exactement `XP_RECONCILE_ALLOW_REMOTE`. Refus si `separate_xp_balance` n'est pas terminée, si une migration est inachevée, si colonne, contrainte validée ou valeur d'enum manquent.
- `--since` : instant ISO avec fuseau ; défaut = `finished_at` de `separate_xp_balance` dans `_prisma_migrations`. Refusé s'il est postérieur à cette fin (fenêtre incomplète).
- Une transaction, `lock_timeout` 5 s, `statement_timeout` 30 s, lignes à écrire verrouillées (`FOR UPDATE`, ordre stable), relecture sous verrou puis contrôle final : tout écart nouveau ou restant annule (ROLLBACK, sortie 4) ; verrou non obtenu = sortie 4, rien d'écrit.

**Lire le résultat**
- `Écarts à corriger : N (hausses, baisses, somme nette)` puis les 10 plus gros `communityId userId : xpTotal, xpBalance -> cible`. Attendu après un incident d'ancien code : quelques lignes ; `AUCUNE CORRECTION` = rien à faire (état du second passage).
- `sans trace dans le ledger` : écart sans événement ni pari depuis la fenêtre (reset de saison de l'ancien code, SQL manuel). À comprendre avant d'exécuter.
- `À ARBITRER solde exact négatif` : `xpTotal + achats` < 0, le CHECK `xpBalance >= 0` interdit la valeur exacte ; un solde négatif suppose un achat du nouveau code (joueur « mixte ») : le joueur est listé et le script n'écrit 0 (jamais de valeur négative) qu'avec `--include-mixed` ; sinon « non écrit », à arbitrer à la main.
- `À ARBITRER achats du nouveau code` : joueur « mixte » (au moins un `SHOP_BALANCE_PURCHASE` depuis la fenêtre) avec un écart. Des plafonds du nouveau code (pénalité d'absence, correction admin) séparent légitimement les compteurs : NON écrit sans `--include-mixed`, à arbitrer à la main.
- `--include-mixed` : à n'utiliser qu'après lecture du rapport. Après un reset de saison du nouveau code, les anciens `SHOP_BALANCE_PURCHASE` restent comptés par la formule et le solde serait abaissé à tort ; sans ce drapeau, le joueur est seulement listé.
- Sorties : 0 ok, 2 refusé, 4 concurrence ou verrou, 1 inattendu. Après exécution : `xp-lot-invariants.mjs --phase=reopened` doit rester vert (l'empreinte, `xpBalance` exclu, ne change pas si seul `xpBalance` a bougé ; `xpTotal` mis à jour par l'ancien code la change, ce qui est attendu).

Vérifié localement (base jetable 127.0.0.1) : `src/lib/xp-balance-reconcile.integration.test.ts` (écritures d'ancien code puis recalage exact, idempotence, dry-run sans écriture, refus sans confirmation, cas négatif, joueurs mixtes, migration absente ou inachevée, verrou externe, CLI). Boutique : `xp-shop.integration.test.ts` (achats parallèles, CHECK) et `xp-shop-lock.integration.test.ts` (une seule connexion, `lock_timeout` de 8 s : sans lui, un verrou externe fait attendre l'achat jusqu'à sa libération, le délai de transaction de Prisma n'interrompant pas la requête en attente). Non vérifié : durée et verrous sur le volume Production.

## 8. Durées mesurées (6 novembre 2026, PostgreSQL 16.15 local jetable, `fsync=on`, 4 cœurs, jamais Neon)

Banc : cluster dédié 127.0.0.1:55447, baseline = les 118 migrations de `main`, données `generate_series` (`CommunityMemberStats` : `xpTotal` aléatoire 0–50 000 ; `XpEvent` : 20 par membre, 1 par membre à 1 000 000), puis les 6 migrations dans l'ordre, chacune dans une transaction (`psql -1`). Sonde de verrou : lecture de la table toutes les ~50 ms pendant la migration. Les 5 migrations hors n°1 durent 30–60 ms quel que soit le volume.

| Volume (`CommunityMemberStats`) | Essais | Migration 1 `separate_xp_balance` | Lecture bloquée (pire sonde) | Taille de table avant → après |
|---|---|---|---|---|
| 1 000 | 3 | 41, 50, 51 ms (médiane 50 ms) | ≤ 54 ms | 0,28 → 0,42 Mo |
| 100 000 | 4 | 1 058, 1 255, 1 258, 1 468 ms (médiane 1,26 s) | 1,0–1,4 s | 19 → 33 Mo (×1,7) |
| 1 000 000 | 4 | 16,96 ; 17,15 ; 18,16 ; 18,57 s (médiane 17,7 s) | 17–18,6 s | 183 → 307 Mo (×1,7) |

Lecture : coût linéaire (~17 µs par ligne). `ADD COLUMN` + `UPDATE` + `ADD CONSTRAINT CHECK` tiennent un verrou `ACCESS EXCLUSIVE` jusqu'au COMMIT : la table est illisible pendant toute la migration 1 (la sonde le confirme), et l'`UPDATE` double la taille de la table (tuples morts, à récupérer par autovacuum). Seuil de 5 s atteint vers 300 000 lignes. `xpBalance = xpTotal` vérifié sur toutes les lignes après chaque essai.

Décision D4 : à tout volume plausible (< 300 000 lignes), la migration n'a pas besoin d'être réécrite ; la barrière d'écriture est de toute façon posée pendant la fenêtre. Si le comptage Production dépasse ~300 000 lignes, refaire la mesure avant de décider (`CHECK … NOT VALID` + `VALIDATE` ou `UPDATE` par lots dans une NOUVELLE migration additive). Limites : machine de test, Neon (stockage, WAL, cache) plus lent possible ; mesure indicative, à confirmer sur la copie restaurée (D3) si elle est faite.

Retours arrière : `scripts/rollback-xp-lot/` ; répétition `scripts/rehearse-xp-rollback.sh <base modèle>` (9 contrôles : schéma identique à la baseline après retour 6→1, données XP inchangées, lignes `_prisma_migrations` supprimées, lot rejouable, refus sur solde divergé / achat au solde / données vocales).
