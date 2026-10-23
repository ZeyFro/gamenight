# Livraison XP, boutique et grades : commandes et contrôles définitifs

Protocole, pas une autorisation : rien n'est prouvé pour Production. Contexte, impacts, barrière des writers, sauvegarde et récupération : `docs/XP-ROLLOUT-DECISION-20261019.md` (non dupliqué ici). Équilibrage : `docs/XP-BALANCE-20261019.md`. Recette boutique : `docs/RECETTE-BOUTIQUE-20261023.md`. Admin : `docs/ADMIN_CORRECTION_XP.md`.

Le lot = 6 migrations, dans cet ordre, appliquées en UNE exécution, AVANT le déploiement du code :

```
20261019190000_separate_xp_balance,20261020150000_session_voice_presence,20261022120000_voice_presence_consent_coordination,20261022130000_voice_presence_retention_gap_bounds,20261022140000_voice_presence_gap_history,20261022142500_shop_balance_purchase_reason
```

Dans les commandes, `$LOT` désigne cette liste, `$BASE` le nom de la base cible. Aucune URL ni mot de passe n'est affiché par les scripts ; ne jamais en coller dans un ticket.

## 0. Prérequis (hors dépôt, à la charge de l'opérateur)

Barrière d'écriture vérifiée sur anciens et nouveaux runtimes, dump custom restauré dans une cible isolée, rôle de migration distinct du rôle runtime : voir « Séquence de bascule » de la décision de publication. Sans cela, ne pas continuer.

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
- Durée et verrous sur le volume Production : inconnus.

## 6. Intermittence du scénario « achats historiques » de `scripts/recette-boutique.mjs`

Cause **non démontrée**. Constats :

- Deux passages complets consécutifs sur une base dédiée (Turbopack, Chrome headless) : 4/4 et 4/4, sans modification du script.
- Le journal Next de la dernière exécution dans `gnw\integ` (lecture seule) se termine sur le second `GET /classement?periode=week` du scénario historique (12 s, `POST` d'achat à 46 s) : l'échec survient donc entre cette page et `stats()`, sur une machine très chargée ; le message complet de l'échec n'a pas été conservé.
- Exclu par lecture du code : aucune route de l'application ne supprime de ligne `CommunityMemberStats` (seul `seasons.ts` fait un `updateMany` à 0, qui produirait une assertion sur `xpTotal`, pas une erreur Prisma) ; les fixtures sont supprimées en fin de run par préfixe unique, jamais pendant les scénarios.
- Hypothèses restantes, non confirmées : (a) un `TRUNCATE` d'une autre suite d'intégration sur une base partagée (injecté volontairement ici pendant ce scénario : il produit un timeout de la page classement et « 0 utilisateur supprimé », pas l'erreur observée ; l'hypothèse ne tient que si le `TRUNCATE` tombe après le dernier chargement) ; (b) une perte de connexion à PostgreSQL (le moteur Docker s'est arrêté pendant un run précédent). Le délai de 15 s des transactions boutique a corrigé les `P2028` mais ne résout pas ce point.
- Pour trancher au prochain échec : conserver `logs/recette-boutique-next.log` et le message complet, lancer sur une base réservée à la recette, relever `pg_stat_database` (`xact_rollback`) et les `TRUNCATE` concurrents.
