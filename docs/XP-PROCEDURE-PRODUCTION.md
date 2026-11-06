# Procédure Production du lot XP + vocal (#325) : écrite, NON exécutée

Protocole à faire autoriser, pas une autorisation. Rien de ce document n'a été exécuté contre Neon, Vercel ou Discord. Décisions du propriétaire (6 novembre 2026) : **D2** rôle partagé (option B) avec barrière d'écriture hors rôle + script de recalage ; **D3** snapshot + restauration de test ; **D4** migration 1 inchangée si le volume le permet (`docs/LIVRAISON-XP.md` §8) ; **D7** collecte vocale bornée à 12 h.

Documents liés : commandes détaillées `docs/LIVRAISON-XP.md` ; contexte et récupération `docs/XP-ROLLOUT-DECISION-20261019.md` ; retours arrière `docs/XP-MIGRATIONS-ROLLBACK.md` ; vocal `docs/LIVRAISON-VOCAL.md`.

## Préconditions (7)

| # | Précondition | État dans le dépôt | Reste au propriétaire |
|---|---|---|---|
| 1 | Liaison Vercel → Neon prouvée (hôte attendu, sans afficher l'URL) | Checklist ci-dessous (étape 1) | Lire la variable Production (accès 403 pour l'assistant) |
| 2 | Rôle de migration | Option B : même rôle que le runtime, `--allow-shared-role` (runner de #370, à fusionner avant) | Accepter le « MODE DÉGRADÉ » ; ou créer un rôle de migration distinct |
| 3 | Barrière d'écriture | Hors rôle : maintenance + crons en pause + worker vocal arrêté + contrôle `pg_stat_activity` ; filet = `scripts/xp-balance-reconcile.mjs` | Exécuter la coupure (Vercel, cron-job.org) |
| 4 | Sauvegarde fraîche restaurée en isolation | Procédure étapes 4–5 | Snapshot Neon et restauration de test |
| 5 | Durée réelle | Mesures locales §8 ; comptage Production à fournir (requête SELECT lecture seule) | Lancer le comptage |
| 6 | Migrations avant code | Vrai sur `main` (aucun build ne migre) ; ordre « migrer → vérifier → merger → déployer » | Ordonnancer la fenêtre |
| 7 | Drapeaux OFF, 3 accords vocaux distincts | `VOICE_PRESENCE_ENABLED` absent/≠ `true` ; tests drapeau éteint | Accords : migration vocale / worker / collecte |

Le lot ne s'applique qu'une fois #370 et #406 fusionnées et les 6 migrations renommées avec un horodatage postérieur à toutes celles de `main` (phase 4) : la garde chronologique du runner refuse sinon.

## Étapes

1. **J-1, lecture seule.** `node scripts/check-xp-rollout-migration-gate.mjs` ; `GAMENIGHT_PRECHECK_DATABASE_URL=… GAMENIGHT_EXPECTED_TARGET="<hôte>/<base>" node scripts/prod-precheck.mjs --state=pre` (aucune des 6 migrations, aucune inachevée, volumes) ; `xp-lot-invariants.mjs --phase=before` ; noter l'`EMPREINTE`. Comparer le comptage de `CommunityMemberStats` au seuil de ~300 000 lignes (§8) ; au-dessus, refaire la mesure avant d'aller plus loin. Preuve de liaison : l'hôte de la variable Production correspond à `GAMENIGHT_EXPECTED_TARGET`.
2. **Coupure des écritures (hors rôle).** Page de maintenance ou drapeau, cron-job.org en pause (`/api/cron/*`, `/api/backfill/*`), worker vocal arrêté, `VOICE_PRESENCE_ENABLED` non défini. Vérifier : `SELECT usename, state, count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1, 2` (hors connexion de l'opérateur) = aucune écriture en cours ; patienter jusqu'à vidage des requêtes.
3. **Snapshot Neon frais** de la branche Production : identifiant et horodatage notés (jamais d'URL dans un ticket).
4. **Restauration de test (D3)** du snapshot dans une branche isolée (`finalize` non appelé) ; y lancer `prod-precheck.mjs --state=pre` et `xp-lot-invariants.mjs --phase=before` : l'empreinte doit être identique à l'étape 1.
5. **Dry-run.** `MIGRATION_DATABASE_URL=<URL directe, non poolée> GAMENIGHT_RUNTIME_ROLE=<rôle runtime> GAMENIGHT_EXPECTED_TARGET="<hôte>/<base>" node scripts/db-migrate.mjs --expect=<6 noms> --allow-shared-role` : relire la liste « À appliquer » (6 lignes, sha256) et le message « MODE DÉGRADÉ ». Aucune écriture.
6. **Accord écrit du propriétaire** pour cette exécution (une réponse distincte pour la migration, le worker et la collecte vocale).
7. **Exécution unique.** Même commande avec `--execute --confirm-database=<base>`. Codes : 0 ok, 2 refusé, 3 migration en échec, 4 contrôle après migration en échec. Sur 3 ou 4 : ne pas relancer, ne pas `migrate resolve` ; conserver les sorties ; voir « Échec » plus bas. Durée attendue : < 1 s si moins de ~100 000 lignes (§8) ; la table est illisible pendant la migration 1.
8. **Contrôles avant tout redémarrage.** `xp-lot-invariants.mjs --phase=after --expect-fingerprint=<empreinte>` ; `prod-precheck.mjs --state=post` ; 6 lignes terminées ; `xpBalance = xpTotal` partout ; aucun négatif. Pas de navigation authentifiée sur Production (`touchStreak` peut écrire sur un GET).
9. **Merge de #325 → déploiement** (le build ne migre pas). Écritures encore fermées côté nouveau code si la maintenance reste posée.
10. **Recalage XP, dry-run** : `XP_RECONCILE_DATABASE_URL=… node scripts/xp-balance-reconcile.mjs` : doit afficher `AUCUNE CORRECTION` si la barrière a tenu depuis la fin de la migration. Sinon relire le rapport, puis `--execute --confirm-database=<base>` (voir `docs/LIVRAISON-XP.md` §7 pour les cas « à arbitrer »).
11. **Réouverture** : retirer la maintenance, relancer les crons un par un ; relevés périodiques `xp-lot-invariants.mjs --phase=reopened`. `VOICE_PRESENCE_ENABLED` reste éteint tant que les trois accords vocaux ne sont pas donnés.
12. **Échec et retour arrière.** Avant déploiement et sans écriture applicative : restaurer le snapshot (branche de restauration, vérifications, puis bascule décidée par le propriétaire) et remettre l'ancien code. Après déploiement : correction applicative d'abord ; sinon `docs/XP-MIGRATIONS-ROLLBACK.md` dans l'ordre inverse, sous accord, après retour au code de `main`.

## Ce que cette procédure ne prouve pas

Non vérifié : liaison Vercel → Neon réelle ; volume Production ; version et comportement exacts de Neon (durée de la migration 1 mesurée sur PostgreSQL 16.15 local) ; existence et privilèges des rôles Production ; test avec de vrais membres Discord. Option B réduit la protection : le rôle runtime détient les droits de migration pendant la fenêtre, d'où la barrière hors rôle et le recalage.
