# #444 — validation Production avant fusion (procédure, rien n'est exécuté ici)

Rédigé le 17/11/2026 sur la branche `agent/preflight-20261116`. **Aucune
connexion Neon, aucune migration, aucune restauration, aucun secret lu ou
modifié dans cette session.**

## 1. Constat qui change la demande initiale

La demande parlait de « valider la restauration Neon avant la fusion de #445 ».
Entre-temps, **#445 est fusionnée** (méthode standard, `docs/MIGRATIONS.md`) :
la fusion dans `main` **vaut accord** et `.github/workflows/migrate-production.yml`
applique automatiquement les migrations sur Neon Production (environnement
`production-migrations`, secret `PRODUCTION_MIGRATION_DATABASE_URL` en URL
directe, refus si l'URL contient `-pooler`).

Conséquence : ce n'est plus #445 qu'il faut encadrer, mais **#444 elle-même**,
qui apporte `prisma/migrations/20261201120000_discord_team_space/`. Merger #444
déclenchera ce workflow. La présente procédure est donc la condition de fusion
de #444.

## 2. Cible

| Élément | Valeur attendue | Vérifié ici |
| --- | --- | --- |
| Base | branche Neon `production` du projet GameNight | non (aucun accès) |
| Workflow | `.github/workflows/migrate-production.yml` | oui, relu sur `main` |
| Environnement GitHub | `production-migrations` | non (côté GitHub seulement) |
| Secret | `PRODUCTION_MIGRATION_DATABASE_URL` (URL directe, sans `-pooler`) | non (jamais lu) |
| Déclencheur | push sur `main` touchant `prisma/migrations/**` ou `prisma/schema.prisma` | oui |
| Migrations appliquées | `prisma migrate deploy` | oui (documenté) |

Le build Vercel ne migre jamais (`npm run build` = `prisma generate` +
`next build`).

## 3. Sauvegardes disponibles

- **Point de restauration de la fenêtre** : l'heure UTC est écrite dans le
  résumé du job `migrate-production` **avant** l'application. C'est le repère
  de retour arrière à recopier dans la note de fusion.
- **Restauration ponctuelle Neon** (PITR / restauration de branche) : mécanisme
  documenté par Neon, jamais exercé depuis ce dépôt.
- **Snapshot historique** `prod-avant-tower-migrations-20261102` : présence
  relevée dans un audit antérieur, **restauration jamais démontrée**. Voir
  `docs/TOWER_SNAPSHOT_RESTORE_PROCEDURE.md` : l'exercice se fait vers une
  branche isolée, jamais vers `production`.
- **Inventaire des sauvegardes réellement disponibles : non vérifié ici**, faute
  d'accès Neon. À confirmer dans la console Neon avant la fusion (fenêtre PITR
  effective, quota de branches libres pour une restauration d'essai).

## 4. Ce que la migration fait, et ce qu'elle ne fait pas

`20261201120000_discord_team_space/migration.sql` :

- `CREATE TABLE IF NOT EXISTS "DiscordTeamSpace"` + 3 index `IF NOT EXISTS` ;
- aucune clé étrangère (le schéma Prisma ne déclare pas de relation, nettoyage
  applicatif) ;
- aucun `DROP`, `DELETE`, `TRUNCATE`, `ALTER TABLE`, `UPDATE` ;
- **preuve d'idempotence** : deux applications consécutives sur PostgreSQL 16
  jetable, la seconde ne produit que des `NOTICE … already exists, skipping` ;
- garde automatisée : `src/lib/discord-team-space-migration.test.ts`
  (additivité, idempotence, absence de FK, alignement avec `schema.prisma`).

Le code tolère l'absence de la table : `discord-team-space-service.ts` répond
`migration_required` tant qu'elle n'existe pas — donc **un déploiement Vercel
antérieur à la migration ne casse rien**, il ferme seulement les espaces
d'équipe.

## 5. Ordre des migrations

1. `20261104140000_tower_team_membership_policy` (#370, avec #408/#416) :
   `captainId`, backfill, index d'appartenance.
2. `20261106150000_…` (#408/#416) selon l'ordre décidé par le propriétaire.
3. `20261201120000_discord_team_space` (#444, cette branche).

Prisma applique par ordre de nom de dossier : tant que (3) est la plus récente,
elle passe en dernier, quel que soit l'ordre de fusion des PR **antérieures**.
Deux points à respecter :

- ne pas fusionner #444 avant que les migrations de #370/#406 déjà prévues ne
  soient dans `main`, sinon (3) s'applique seule puis les autres plus tard —
  fonctionnellement sans risque ici (aucune FK, aucune dépendance de colonne),
  mais cela complique la lecture de l'état de `_prisma_migrations` ;
- ne jamais modifier une migration déjà appliquée : toute correction passe par
  une nouvelle migration additive.

## 6. Risques de concurrence

- **Deux fusions rapprochées** : chaque push sur `main` lance un job. Fusionner
  une seule PR à migration à la fois et attendre le job vert avant la suivante.
- **Déploiement et migration en parallèle** : Vercel peut servir le nouveau
  code avant la fin du job. Acceptable ici (dégradation `migration_required`),
  mais à éviter pour une migration qui change une colonne lue en permanence.
- **Cron et bot Discord** pendant la fenêtre : aucune écriture Discord n'est
  déclenchée par cette migration (aucun flag activé par elle) ; les crons
  continuent de tourner et n'utilisent pas `DiscordTeamSpace`.
- **`migrate deploy` concurrents** : un seul job à la fois ; ne pas lancer de
  `workflow_dispatch` manuel pendant qu'une fusion est en cours.

## 7. Procédure de fusion (à exécuter par le propriétaire)

1. Vérifier `gh pr checks 444` : `verify`, `storage`, `rules`, `immutable`,
   `Vercel` verts sur le dernier SHA.
2. Recopier dans la note de fusion : SHA de tête, date/heure UTC, numéro du job.
3. Confirmer dans Neon : fenêtre PITR et horodatage du dernier point de
   restauration, quota de branches libre pour un essai isolé.
4. Merger #444 (squash ou merge commit selon la politique du dépôt).
5. Suivre le job `migrate-production` : heure UTC **avant** migration dans le
   résumé, `migrate status`, `migrate deploy`, `migrate status` final.
6. Vérifier `_prisma_migrations` : une entrée `20261201120000_discord_team_space`
   terminée, aucune inachevée.
7. Contrôler l'application : `/equipes` répond, les espaces d'équipe restent
   fermés tant que `DISCORD_TEAM_SPACES_ENABLED` n'est pas ouvert
   (cf. `docs/ACTIVATION-DISCORD.md`, étape 3).

## 8. Conditions de retour arrière

- Prisma n'annule pas une migration.
- **Rollback standard** : restaurer la branche Neon à l'heure UTC notée à
  l'étape 5 vers une branche isolée, vérifier le schéma, puis basculer
  `production` dessus selon la procédure Neon. Aucune donnée applicative n'est
  concernée par cette table (elle est vide à la création).
- **Rollback ciblé** (si la table vient d'être créée et reste vide) :
  `DROP TABLE "DiscordTeamSpace";` puis retirer l'entrée correspondante de
  `_prisma_migrations` — opération manuelle, jamais automatisée, et seulement
  après accord explicite. Ne jamais faire cela si des lignes existent : elles
  portent l'association salon/rôle des équipes.
- Après un rollback, corriger par une **nouvelle** migration additive.

## 9. Conditions d'arrêt (avant de merger)

- Sauvegarde/PITR non confirmée dans Neon → ne pas merger.
- Job `migrate-production` en échec ou `migrate status` signalant une migration
  inachevée → ne pas relancer à l'aveugle, ne pas merger la PR suivante.
- Toute migration concurrente déjà présente dans `main` et non appliquée →
  traiter celle-là d'abord.
- Toute demande de modifier le secret, de supprimer une branche Neon ou de lancer
  une restauration : hors périmètre de cette procédure, accord séparé.

## 10. Ce qui reste non prouvé

- L'existence et la fenêtre réelle des sauvegardes Neon (aucun accès ici).
- La restauration effective d'une branche de production (jamais exercée).
- L'application du workflow sur Production (aucune fusion effectuée).
- Le parcours Discord réel (aucune activation, guilde de test uniquement).
