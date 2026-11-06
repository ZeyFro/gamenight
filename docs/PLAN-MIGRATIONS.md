# Plan des migrations en attente de revue

> **Actualisation du 6 novembre :** ce plan est préparatoire. #370 `6cff66b` et
> #406 `97353dc` conservent les SQL/checksums ci-dessous ; leurs correctifs d’audit
> et leurs tests sont décrits dans ETAT.md. #407 `6ec348d` ajoute désormais une
> neuvième migration distincte, `20261106150000_tower_fixed_arbiter`, hors du
> périmètre des deux migrations proposées. Ne pas l’inclure implicitement.
> #325 reste exclusivement à Claude Code ; la table de nommage historique plus
> bas ne donne aucune instruction d’exécuter ses migrations.
> #418 `05ccb6c` ne permet que le dry-run après fusion manuelle autorisée.
> Rôle/secret/environnement distants non préparés : administration GitHub403 et
> mapping endpoint de test à vérifier. Aucun SQL applicatif distant exécuté.
> Toute migration, même de test, attend un nouvel accord explicite et la
> validation dry-run/sauvegarde. Les anciens accords ne lèvent pas ces verrous.

> **Périmètre et limites de vérification.** Ce document recense les fichiers de migration présents dans les PR ouvertes de ce dépôt au 5 novembre 2026. L’inventaire des fichiers modifiés dans toutes les PR ouvertes a trouvé huit migrations : six dans #325, une dans #370 et une dans #406; aucune autre PR ouverte ne modifie un fichier `prisma/migrations/**/migration.sql`. Les PR ne sont pas fusionnées. **Je n’ai pas consulté de base, Neon, Production ni la table `_prisma_migrations`** : « en attente » signifie ici « portée par une PR non fusionnée », et ne prouve pas que la migration est absente d’une base donnée. Vérifier la cible et son état avant toute décision ou exécution.

Les ordres SQL ci-dessous décrivent le DDL et les écritures des fichiers publiés sur les têtes actuelles des PR. Les commandes de retour arrière sont des **propositions à examiner**, pas un mécanisme Prisma ni des instructions à exécuter sans sauvegarde restaurée, contrôle de dépendances et autorisation distincte pour la migration concernée. Plusieurs retours arrière supprimeraient des données créées depuis l’application.

## Exécution Tower retenue — préparation du 6 novembre 2026

Le périmètre autorisé de préparation est **#370 puis #406 uniquement**. Les autres migrations recensées historiquement ci-dessous restent gelées et ne doivent pas entrer dans le checkout opérateur. Aucune migration Neon ou Production n’a été exécutée par cette session.

### Preuve locale et provenance

Répétition sur PostgreSQL 16 isolé, copie locale d’un historique fictif à 118 migrations : dry-run exact puis exécution du runner #370, passage à 119 ; assemblage local de #370 et #406, dry-run exact puis exécution #406, passage à **120 terminées, zéro inachevée**. Les six tests Vitest du garde chronologique passent. Les agrégats locaux donnent zéro doublon membre et zéro créateur orphelin. Le script distant de précontrôle refuse volontairement localhost (même avec un argument `--allow-local`, non pris en charge) ; il n’a pas été modifié ni présenté comme exécuté avec succès. Le premier lancement de ces tests avec `node --test` était inadapté (tests Vitest), puis la commande correcte a réussi ; aucun changement du runner.

| PR / tête vérifiée | Migration | SHA-256 du SQL |
| --- | --- | --- |
| #370 `4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb` | `20261104140000_tower_team_membership_policy` | `9f642e6200bef888669e9c058bf1623ad582cd2772ea5e433a7b78bfa596db8f` |
| #406 `1a495ede501784167b597c43438c1527b2d58082` | `20261105120000_tower_launch_channels_appeals_matchmaking` | `e7782519fcdf5e9637f131fbd348ceb07c8f6f177dbe87f82ba9a18f6c94a9de` |

Le rôle local de test était `postgres`, sans rôle runtime fourni : avertissement explicite du runner, acceptable uniquement pour cette répétition locale. Ce résultat ne prouve ni l’état de Neon ni la restauration d’une sauvegarde Production.

### Branche Neon de test — arrêt avant toute écriture distante

Cible attendue : projet `misty-tooth-45335023`, branche `tower-migration-test-20261105` (`br-snowy-snow-b1cggq2w`), non primaire et non par défaut. Revalider ces métadonnées et la correspondance de l’hôte direct avant connexion ; l’ancien relevé de 118 migrations n’est pas une vérification actuelle.

Injecter `MIGRATION_DATABASE_URL` par liaison secrète, jamais dans un fichier, une commande contenant sa valeur ou le chat. Définir `GAMENIGHT_EXPECTED_TARGET` avec l’hôte direct vérifié et la base exacte, et `GAMENIGHT_RUNTIME_ROLE` avec le rôle runtime vérifié. Aucune URL concurrente de migration ne doit être injectée. Utiliser Node 22 et un checkout propre #370 avec `npm ci` et `prisma generate`. Ces commandes n’autorisent pas l’exécution distante :

```sh
node scripts/check-team-membership-duplicates.mjs
node scripts/db-migrate.mjs --expect=20261104140000_tower_team_membership_policy
```

Exiger zéro doublon/orphelin et une seule migration attendue. Consigner les contrôles, la cible, le SHA et la sauvegarde fraîche restaurable ; demander l’accord pour ce fichier sur cette branche. Après accord seulement, reprendre le même dry-run et ajouter `--execute --confirm-database=<BASE_VERIFIEE>` à la commande. Tout refus ou erreur impose l’arrêt, sans `resolve`, reset ou SQL de contournement.

Pour #406, utiliser un checkout d’intégration contenant **les deux têtes revues et le runner de #370**. La tête 97353dc intègre désormais #370 ; les anciennes têtes #406 seules ne contenaient pas ce runner. Après les contrôles de #370, répéter le dry-run avec `--expect=20261105120000_tower_launch_channels_appeals_matchmaking`, puis l’accord séparé et le contrôle final à 120 migrations. Si un rôle partagé est réellement nécessaire, son usage doit être explicitement accepté et signalé ; ne pas copier automatiquement l’option Production.

### Restauration de la branche de test — préparation, aucune exécution

Sauvegarde indépendante annoncée et vérifiée par le propriétaire :
`backup-tower-migration-test-20261106` (`br-purple-mud-b1nt0tfi`),
parent cible `br-snowy-snow-b1cggq2w`, LSN `0/2A355C30`.
Revalider via le contrôle Neon autorisé son état ready, sa filiation, son point
restaurable et la période de rétention ; une déclaration historique ne suffit pas.
Ne pas modifier cette branche de sauvegarde. Dix branches sont déjà utilisées :
aucune création ou suppression supplémentaire n'est autorisée.

En cas d'échec : arrêter les migrations suivantes et les writers de recette,
conserver les diagnostics expurgés et l'historique Prisma, puis faire revoir le
plan de restauration par le propriétaire. Identifier uniquement la branche de
TEST comme destination ; exclure explicitement Production et la sauvegarde.
Faire confirmer dans l'interface Neon la procédure supportée pour restaurer
cette destination depuis le point sauvegardé, son impact sur les données de test
et les connexions, puis demander l'autorisation distincte avant toute écriture.
Si le mécanisme exige une nouvelle branche ou une suppression, rester bloqué :
aucune libération de quota ni opération destructive automatique. Après restauration
autorisée, revérifier identité, historique, contraintes et intégrité avant reprise.
Aucune restauration n'a été exécutée ni son exploitabilité prouvée par cette session.

### Production — option B, procédure préparée uniquement

Ne commencer qu’après validation de la branche de test, revue indépendante et accord explicite de migration Production. Revalider l’identité Production, le nombre réel de migrations et les agrégats d’intégrité ; aucune donnée de Production ne sert aux tests. Injecter séparément sa connexion directe via le gestionnaire de secrets et définir la cible exacte. Si le rôle runtime et de migration est bien `neondb_owner`, définir `GAMENIGHT_RUNTIME_ROLE=neondb_owner` et ajouter `--allow-shared-role` : mode dégradé explicite, pas une séparation de rôles.

Pour chaque fichier, dans l’ordre #370 puis #406 : checkout approprié, contrôle d’intégrité, dry-run exact avec `--allow-shared-role`, accord désignant fichier et cible, **snapshot frais vérifié restaurable immédiatement avant chaque exécution**, puis seulement `--execute --confirm-database=<BASE_VERIFIEE>`. Exiger « aucune en attente » et zéro migration inachevée après chaque étape ; un nouveau dry-run déjà appliqué renvoie 2 (« Rien à faire »). Toute divergence bloque la suite. Ne pas lancer de rollback, redéploiement, migration ancienne ou merge automatiquement. L’accord de migration n’autorise ni Ready ni merge, ni flags, ni Discord.

## Synthèse et ordre proposé

| Ordre | Fichier | PR | Dépendance / raison |
|---:|---|---:|---|
| 1 | `20261019190000_separate_xp_balance/migration.sql` | #325 | Indépendante des tables vocales; conserve le total XP et crée un solde de dépense distinct. |
| 2 | `20261020150000_session_voice_presence/migration.sql` | #325 | Crée la table d’intervalles utilisée par les migrations vocales suivantes. |
| 3 | `20261022120000_voice_presence_consent_coordination/migration.sql` | #325 | Crée le contrôle/consentement et ajoute des colonnes à l’intervalle créé en 2. |
| 4 | `20261022130000_voice_presence_retention_gap_bounds/migration.sql` | #325 | Ajoute `gapStartedAt` à `SessionVoicePresenceControl`, créée en 3. |
| 5 | `20261022140000_voice_presence_gap_history/migration.sql` | #325 | Crée l’historique et le remplit depuis le contrôle et `gapStartedAt` de 4. |
| 6 | `20261022142500_shop_balance_purchase_reason/migration.sql` | #325 | Ajout d’enum indépendant; placé à sa position chronologique dans l’historique Prisma. |
| 7 | `20261104140000_tower_team_membership_policy/migration.sql` | #370 | Ordre chronologique après #325; index d’unicité et colonnes utilisées par les règles d’équipe. |
| 8 | `20261105120000_tower_launch_channels_appeals_matchmaking/migration.sql` | #406 | Ordre chronologique après #370; schéma partagé requis par #407 et #408. |

Cet ordre est un **ordre de dépendance et de nommage**, pas une recommandation d’appliquer en bloc. Avant de le retenir sur une base réelle, comparer son schéma et son historique de migrations au commit exact des branches. Si une migration est déjà appliquée, ne pas la rejouer; réconcilier d’abord son nom, checksum, état et objets. Le runner de migration doit rester la source d’exécution approuvée. Ne pas fusionner de code qui suppose un schéma absent.

## Migrations anciennes ajoutées après des migrations plus récentes

Le simple merge de #370 et #406 n'applique rien. **Si leurs migrations ont d'abord été exécutées manuellement**, puis que les six fichiers #325 arrivent dans le checkout plus tard, leurs noms d'horodatage sont antérieurs à ceux de #370/#406.

Dans la version initiale, antérieure au correctif chronologique décrit ci-dessous, de `scripts/db-migrate.mjs` de #370, le runner comparait les fichiers disponibles à `_prisma_migrations` et exige que `--expect` corresponde exactement à la liste en attente. Il ne compare toutefois pas le plus ancien fichier en attente à la migration réussie la plus récente déjà appliquée. Si #325 constitue ensuite la liste exacte passée à `--expect`, le runner appelle `prisma migrate deploy`; Prisma applique les migrations présentes sur disque qui restent en attente, dans l'ordre lexicographique des dossiers, en laissant les migrations #370/#406 déjà appliquées dans l'historique. Il n'annule pas ces migrations plus récentes. Le dry-run liste les noms « À appliquer » et l'exécution exige `--execute` plus `--confirm-database`, mais le runner ne signale pas spécialement cet ordre tardif et ne le refuse pas.

Références : [runner proposé dans #370](https://github.com/ZeyFro/gamenight/blob/feat/tower-team-rules-20261104/scripts/db-migrate.mjs), [contrôle de la liste attendue](https://github.com/ZeyFro/gamenight/blob/feat/tower-team-rules-20261104/scripts/db-migrate-lib.mjs), [ordre lexicographique de Prisma Migrate](https://www.prisma.io/docs/orm/v6/prisma-migrate/getting-started) et [application des migrations en attente](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production).

**Protection ajoutée dans la tête de la PR #370** (`711210265fa6164f523a49b3cd8d9f818abf154d`) : le runner refuse maintenant l'exécution si la plus ancienne migration en attente précède la dernière migration réussie. Le message affiche les deux noms et demande de réconcilier l'historique. Le nouveau fichier `scripts/db-migrate-lib.test.mjs` couvre le cas #325 tardif, l'ordre normal et les autres refus de précontrôle. Le test ciblé `Test migration runner guards` passe sur la tête `4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb`; la CI générale a depuis réussi sur cette tête. La PR #325 reste gelée et chaque migration de Production nécessite toujours son autorisation séparée.

## Détail par migration

### 1. #325 — `20261019190000_separate_xp_balance`

**DDL et données**
- `CommunityMemberStats.xpBalance` : colonne `INTEGER NOT NULL DEFAULT 0).
- Contrainte `CommunityMemberStats_xpBalance_nonnegative` : `xpBalance >= 0).
- Mise à jour de toutes les lignes : `xpBalance = xpTotal`. Aucun enregistrement ni colonne préexistante n’est supprimé ou renommé.

**Classement :** ajout de schéma avec backfill des données existantes; pas de DDL destructif. Le backfill écrit sur toute la table et peut prendre des verrous. Après activation du code, le solde peut diverger de `xpTotal`; supprimer ensuite `xpBalance` détruirait alors le solde dépensable.

**Retour arrière candidat (refuse si les deux soldes ont divergé) :**
```sql
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CommunityMemberStats"
    WHERE "xpBalance" <> "xpTotal"
  ) THEN
    RAISE EXCEPTION 'Rollback interdit : xpBalance diffère de xpTotal; exporter et arbitrer les soldes.';
  END IF;
END $$;
ALTER TABLE "CommunityMemberStats"
  DROP CONSTRAINT "CommunityMemberStats_xpBalance_nonnegative";
ALTER TABLE "CommunityMemberStats" DROP COLUMN "xpBalance";
COMMIT;
```

**Dépendances / contrôles**
- Aucune dépendance SQL entre les huit fichiers; dans #325, cette migration reste première par ordre chronologique.
- Avant : confirmer que la colonne et la contrainte sont absentes, compter les lignes, vérifier bornes/valeurs de `xpTotal`, estimer durée et verrouillage sur volume réel, répéter le backfill sur copie isolée.
- Après : colonne présente/not-null/default 0, aucune valeur négative, nombre de lignes inchangé, `xpBalance = xpTotal` pour toutes les lignes au moment du backfill. Tout écart postérieur doit être attendu par le code de boutique.

### 2. #325 — `20261020150000_session_voice_presence`

**DDL**
- Crée `SessionVoicePresenceInterval` avec `id`, `sessionId`, `userId`, `channelId`, `startedAt`, `durationSeconds`, `partial`, `createdAt).
- Ajoute un index unique `(sessionId,userId,channelId,startedAt)`, un index `(sessionId,userId)), et les FK vers `Session` et `User`, toutes deux `ON DELETE CASCADE).

**Classement :** ajout d’une table vide; pas de perte immédiate. Les suppressions ultérieures d’une session ou d’un utilisateur effaceront en cascade ses intervalles.

**Retour arrière candidat :**
```sql
BEGIN;
-- Avant de continuer : exporter les intervalles si des données ont été collectées.
DROP TABLE "SessionVoicePresenceInterval";
COMMIT;
```
Cette suppression perd les données d’intervalles présentes au moment du rollback.

**Dépendances / contrôles**
- Prérequis : `Session` et `User` avec les clés référencées; table absente.
- Avant : vérifier absence de la table/objets homonymes, cohérence des types de clés et comportement attendu des cascades; sauvegarde restaurée en isolation.
- Après : table, deux index et deux FK présents; vérifier que les suppressions de parents en cascade correspondent à la politique de rétention approuvée, sans lancer de suppression de test en Production.

### 3. #325 — `20261022120000_voice_presence_consent_coordination`

**DDL et backfill**
- Crée l’enum `SessionVoicePresenceControlStatus` (`ACTIVE`, `STOP_REQUESTED`, `PURGE_REQUESTED`, `FINALIZED`, `PURGED`).
- Crée `SessionVoicePresenceConsent` avec `id`, `sessionId`, `userId`, `consentedAt`, `expiresAt), ses index et ses FK en cascade vers `Session` et `User`.
- Ajoute `consentId`, `endedAt`, `expiresAt` à `SessionVoicePresenceInterval`; remplit `endedAt = startedAt + durationSeconds` et `expiresAt = createdAt + 30 jours`, puis rend les deux colonnes non nulles.
- Crée `SessionVoicePresenceControl` avec `sessionId`, état, génération, bail, heartbeat, arrêt, indicateurs de lacune et date de mise à jour; ajoute son index et sa FK en cascade vers `Session).
- Ajoute la FK optionnelle `SessionVoicePresenceInterval.consentId` vers `SessionVoicePresenceConsent.id`, en cascade.

**Classement :** ajout de tables, colonnes, type et données dérivées. Pas de suppression dans le sens avant. Le backfill matérialise une date de fin et une échéance de rétention; le retour arrière supprime consentements, contrôles et colonnes, ainsi que les données enregistrées après application.

**Retour arrière candidat (à exécuter seulement après export des données vocales utiles) :**
```sql
BEGIN;
ALTER TABLE "SessionVoicePresenceInterval"
  DROP CONSTRAINT "SessionVoicePresenceInterval_consentId_fkey";
DROP TABLE "SessionVoicePresenceControl";
DROP TABLE "SessionVoicePresenceConsent";
ALTER TABLE "SessionVoicePresenceInterval"
  DROP COLUMN "consentId",
  DROP COLUMN "endedAt",
  DROP COLUMN "expiresAt";
DROP TYPE "SessionVoicePresenceControlStatus";
COMMIT;
```

**Dépendances / contrôles**
- Dépend de la table de 2; la migration 4 ajoute une colonne au contrôle créé ici, donc retirer 4 avant celle-ci.
- Avant : vérifier `durationSeconds` et les calculs de dates, absence de dépassement de capacité, et schéma exact de l’intervalle; mesurer l’impact de l’UPDATE et du `SET NOT NULL`.
- Après : aucune colonne `endedAt`/`expiresAt` nulle; valeurs égales aux formules SQL; contraintes et relations présentes; contrôle d’échantillons sans données personnelles exposées.

### 4. #325 — `20261022130000_voice_presence_retention_gap_bounds`

**DDL :** ajoute `SessionVoicePresenceControl.gapStartedAt TIMESTAMP(3)`, nullable. Aucune table ou autre colonne n’est modifiée.

**Classement :** purement additive; aucune écriture de backfill ni perte avant application.

**Retour arrière candidat :**
```sql
ALTER TABLE "SessionVoicePresenceControl" DROP COLUMN "gapStartedAt";
```
Les dates de début de lacune collectées après application seraient perdues.

**Dépendances / contrôles**
- Dépend de 3, qui crée `SessionVoicePresenceControl); 5 lit cette colonne pour l’insertion de l’historique.
- Avant : confirmer table/colonne absentes et compatibilité du binaire.
- Après : colonne présente et nullable; le code qui suit doit enregistrer les transitions attendues.

### 5. #325 — `20261022140000_voice_presence_gap_history`

**DDL et backfill**
- Crée `SessionVoicePresenceGap` : `id`, `sessionId`, `generation`, `startedAt`, `resumedAt`, `expiresAt`, `createdAt); index unique `(sessionId,generation,startedAt)), index `(sessionId,startedAt)), index `expiresAt), FK cascade vers `Session).
- Insère une ligne pour la dernière lacune agrégée des contrôles dont `gapDetected = true), `gapStartedAt IS NOT NULL`, état différent de `PURGED`, et session non annulée. L’identifiant est un MD5 déterministe des identifiants/génération/date.

**Classement :** nouvelle table avec backfill; pas de suppression avant application. Le rollback supprimerait l’historique accumulé, y compris toute lacune écrite après l’insertion initiale.

**Retour arrière candidat :**
```sql
BEGIN;
-- Exporter les lignes avant rollback si leur historique doit être conservé.
DROP TABLE "SessionVoicePresenceGap";
COMMIT;
```

**Dépendances / contrôles**
- Dépend de 3 et 4; appliquer après elles. Retour arrière avant 4 et 3.
- Avant : compter les contrôles correspondant au filtre; calculer en lecture seule les identifiants déterministes et vérifier leur unicité; estimer le volume et valider la règle « dernière lacune seulement ».
- Après : nombre de lignes égal au nombre d’enregistrements admissibles, clés uniques, chaque session existe, dates/copies conformes à la source; les contrôles `PURGED` et sessions `CANCELLED` sont exclus.

### 6. #325 — `20261022142500_shop_balance_purchase_reason`

**DDL :** ajoute la valeur `SHOP_BALANCE_PURCHASE` à l’enum `XpReason`. La colonne concernée dans le schéma est `XpEvent.reason). Aucun enregistrement n’est modifié par cette migration.

**Classement :** ajout d’enum, sans perte avant application. PostgreSQL ne fournit pas de suppression directe d’une valeur d’enum; rollback par recréation du type, et seulement si aucune ligne n’utilise cette valeur.

**Retour arrière candidat :**
```sql
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "XpEvent" WHERE "reason"::text = 'SHOP_BALANCE_PURCHASE') THEN
    RAISE EXCEPTION 'Rollback interdit : XpEvent contient SHOP_BALANCE_PURCHASE.';
  END IF;
END $$;
CREATE TYPE "XpReason__rollback" AS ENUM (
  'CREATE_SESSION', 'VOTE', 'PARTICIPATE', 'AVAILABILITY_FIRST',
  'STEAM_LINK_FIRST', 'SESSION_RESULT', 'SESSION_ATTENDANCE',
  'SESSION_ABSENCE', 'SUPERLATIVE_AWARD', 'BADGE_UNLOCKED',
  'CHALLENGE_COMPLETE', 'PRONOSTIC_CORRECT', 'XP_BET_WON',
  'TOURNAMENT_RESULT', 'SHOP_PURCHASE', 'ADMIN_ADJUSTMENT'
);
ALTER TABLE "XpEvent" ALTER COLUMN "reason"
  TYPE "XpReason__rollback" USING ("reason"::text::"XpReason__rollback");
DROP TYPE "XpReason";
ALTER TYPE "XpReason__rollback" RENAME TO "XpReason";
COMMIT;
```

**Dépendances / contrôles**
- Aucune dépendance envers les tables vocales; placé en 6 par chronologie. Si l’ordre d’énumérations est différent sur la cible, comparer avant.
- Avant : confirmer les valeurs et toutes les dépendances au type `XpReason`, absence de type temporaire, type identique au code attendu.
- Après : valeur présente une fois, aucun événement modifié; vérifier que le code utilise la raison seulement pour les achats de solde. Pour rollback, vérifier absence de cette valeur dans toutes les colonnes/objets qui dépendent du type.

### 7. #370 — `20261104140000_tower_team_membership_policy`

**DDL et backfill**
- `Membership.lastTeamLeftAt TIMESTAMP(3)`, nullable.
- `CommunityTeam.captainLastActivityAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP). Les équipes existantes reçoivent la date courante lors de l’ajout; ce n’est pas une reconstitution de leur dernière activité historique.
- Index unique `CommunityTeamMember(communityId,userId)), imposant une seule équipe par membre et communauté.
- `CommunityTeam.captainId TEXT), rempli par `captainId = createdById), puis FK vers `User.id` avec `ON DELETE SET NULL ON UPDATE CASCADE). La colonne demeure nullable.
- Aucun objet n’est supprimé/renommé et aucune ligne n’est supprimée. La création d’index échoue si des doublons historiques existent; aucune déduplication automatique n’est faite.

**Classement :** structure additive, contrainte plus stricte et backfill de capitaine. Le timestamp courant peut fausser une règle d’inactivité basée sur les données historiques; vérifier que `createdById` correspond au capitaine souhaité avant de l’utiliser.

**Retour arrière candidat :**
```sql
BEGIN;
ALTER TABLE "CommunityTeam"
  DROP CONSTRAINT "CommunityTeam_captainId_fkey";
DROP INDEX "CommunityTeamMember_communityId_userId_key";
ALTER TABLE "CommunityTeam"
  DROP COLUMN "captainId",
  DROP COLUMN "captainLastActivityAt";
ALTER TABLE "Membership" DROP COLUMN "lastTeamLeftAt";
COMMIT;
```
Perte des capitaines réaffectés, dates d’activité, et dates de départ enregistrées après migration. Le retrait de l’index supprime aussi la garantie d’exclusivité.

**Dépendances / contrôles**
- Dépend des tables d’équipes/membres et des clés `Membership`, `CommunityTeam`, `CommunityTeamMember`, `User) présentes dans le schéma existant.
- Avant : compte exact des doublons `GROUP BY communityId,userId HAVING count(*) > 1` (doit être zéro, sans les supprimer automatiquement); orphelins de `CommunityTeam.createdById`; choix explicite de capitaine pour les équipes existantes; politique d’initialisation de l’inactivité; index homonymes absents.
- Après : index unique valide, aucune paire dupliquée, FK valide, `captainId` initialisé selon la correspondance approuvée, `captainLastActivityAt` non nulle et règle de délai/passation testée sur PostgreSQL isolé.
- Dépendances de code : #396 et #408 reposent sur les règles/colonnes d’équipe de #370. La migration doit être planifiée avant la mise en service de ce code.

### 8. #406 — `20261105120000_tower_launch_channels_appeals_matchmaking`

**DDL**
- Ajoute à `TowerChallengeAttempt` : `proofCode VARCHAR(12)`, `rejectedAt`, `staffReportedAt), `archivedAt); ajoute un `CHECK` sur le format `TWR-[A-Z0-9]{8}`, un index unique `(communityId,proofCode)) et un index `(communityId,status,submittedAt,staffReportedAt,archivedAt)).
- Crée l’enum `TowerChallengeAppealStatus` (`OPEN`, `UPHELD`, `OVERTURNED`) et la table `TowerChallengeAppeal` avec `id`, `communityId`, `attemptId`, `authorUserId`, `reason`, `createdAt`, `dueAt`, `status`, `reviewerUserId`, `arbiterUserId), PK, contrôle du motif, FK vers `Community`, FK composite vers `TowerChallengeAttempt(id,communityId)`, FK de `arbiterUserId` vers `User.id`; ces FK sont `ON DELETE NO ACTION ON UPDATE CASCADE`. Le SQL n’ajoute pas de FK pour `authorUserId` ni `reviewerUserId`. Ajoute l’unicité `(attemptId,communityId)) et trois index de file.
- Ajoute `REWARD` à l’enum existant `UserNotificationCategory).
- Crée `UserNotificationChannel` (`IN_APP`, `WEB_PUSH`, `DISCORD_DM`, `DISCORD_MENTION`) et `UserNotificationChannelPreference` (`userId`, `category`, `channel`, `enabled` par défaut vrai, `updatedAt)); FK utilisateur en cascade, PK composite `(userId,category,channel)).
- Crée les enums `PartyType` (`CASUAL`, `COMPETITIVE`, `COOPERATIVE`) et `MicrophoneRequirement` (`REQUIRED`, `OPTIONAL`, `NONE`). Ajoute à `PlayerClassified` : `startsAt`, `durationMinutes`, `partyType`, `platform VARCHAR(40)`, `microphoneRequirement); contrôle `durationMinutes` entre 1 et 10080 si non nul.
- Aucun `DROP`, renommage ou mise à jour de lignes existantes dans le fichier.

**Classement :** ajout de tables/colonnes/enums/index/contraintes; pas de perte de données dans le sens avant. Après usage, rollback peut perdre les recours, préférences de canal, codes/preuves et filtres de recrutement stockés. L’enum `REWARD` ne peut pas être retiré directement; le type doit être reconstruit et les valeurs nouvelles absentes des données.

**Retour arrière candidat (script schématique exact pour les objets de cette migration; vérifier les dépendances du schéma cible avant usage) :**
```sql
BEGIN;
ALTER TABLE "PlayerClassified"
  DROP CONSTRAINT "PlayerClassified_durationMinutes_check";
ALTER TABLE "PlayerClassified"
  DROP COLUMN "startsAt",
  DROP COLUMN "durationMinutes",
  DROP COLUMN "partyType",
  DROP COLUMN "platform",
  DROP COLUMN "microphoneRequirement";
DROP TYPE "MicrophoneRequirement";
DROP TYPE "PartyType";

DROP TABLE "UserNotificationChannelPreference";
DROP TYPE "UserNotificationChannel";

DROP TABLE "TowerChallengeAppeal";
ALTER TABLE "TowerChallengeAttempt"
  DROP CONSTRAINT "TowerChallengeAttempt_proofCode_format_check";
DROP INDEX "TowerChallengeAttempt_communityId_proofCode_key";
DROP INDEX "TowerChallengeAttempt_communityId_status_submittedAt_staffReportedAt_archivedAt_idx";
ALTER TABLE "TowerChallengeAttempt"
  DROP COLUMN "proofCode",
  DROP COLUMN "rejectedAt",
  DROP COLUMN "staffReportedAt",
  DROP COLUMN "archivedAt";
DROP TYPE "TowerChallengeAppealStatus";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "UserNotificationPreference"
    WHERE "category"::text = 'REWARD'
  ) THEN
    RAISE EXCEPTION 'Rollback interdit : UserNotificationPreference utilise REWARD.';
  END IF;
END $$;
CREATE TYPE "UserNotificationCategory__rollback" AS ENUM
  ('SESSION', 'ROULETTE', 'TOURNAMENT', 'INSTANT_SESSION');
ALTER TABLE "UserNotificationPreference" ALTER COLUMN "category"
  TYPE "UserNotificationCategory__rollback"
  USING ("category"::text::"UserNotificationCategory__rollback");
DROP TYPE "UserNotificationCategory";
ALTER TYPE "UserNotificationCategory__rollback" RENAME TO "UserNotificationCategory";
COMMIT;
```
La migration ajoutant `REWARD` à un type existant, vérifier sur la cible qu’aucune autre colonne, vue, fonction, valeur par défaut ou objet hors schéma Prisma dépend du type avant de le reconstruire. Si une notification `REWARD` est nécessaire, le rollback doit être refusé ou une conversion métier doit être approuvée et documentée avant toute suppression.

**Dépendances / contrôles**
- Prérequis : `TowerChallengeAttempt`, `Community`, `User`, `PlayerClassified`, `UserNotificationPreference), leurs clés/index et l’enum de notification d’origine existent dans le schéma cible.
- Dépendances de code : #407 utilise les champs et modèles de preuve/recours; #408 utilise les filtres de `PlayerClassified). La migration est un prérequis de schéma à ces deux PR.
- #370 ne modifie pas les mêmes tables, mais doit respecter l’ordre chronologique des migrations; les deux fichiers ajoutent chacun des FK vers `User`, sans changement concurrent de cette table.
- Avant : vérifier noms/types/contraintes existants, lignes de `TowerChallengeAttempt` et `PlayerClassified`, collisions d’objets, versions exactes des enums, dépendances d’enum et absence d’index homonymes.
- Après : vérifier colonnes/types/checks/indexes/FK et table de recours; valider par SQL les formats de codes, unicité, motifs non vides, limites de durée; vérifier qu’aucune ligne historique n’a été modifiée. Pas d’essai Discord réel dans ces contrôles.

## Vérifications transversales avant toute autorisation

1. **Cible et état courant :** l’opérateur identifie hors chat l’environnement et la base exacts; contrôle en lecture seule `_prisma_migrations`, checksums, entrées échouées/incomplètes et objets existants. Comparer au commit précis de la branche et au schéma Prisma correspondant. Ce document ne confirme aucun état Neon/Production.
2. **Précontrôles de données :** exécuter uniquement des requêtes de lecture pour les doublons, orphelins, bornes de colonnes, tailles de tables, distributions et valeurs qui empêcheraient les contraintes/backfills. Aucune correction automatique ne fait partie des migrations listées.
3. **Sauvegarde :** disposer d’une sauvegarde fraîche appropriée et en avoir vérifié la restauration sur une cible isolée, avec contrôle de cohérence et estimation de durée. La seule existence d’un snapshot n’est pas une preuve de restauration.
4. **Répétition isolée :** rejouer les migrations exactes, dans l’ordre proposé, sur une copie isolée du schéma et de données représentatives; vérifier temps, verrous, DDL, backfills et scénarios de rollback; ne pas utiliser de données de Production comme base de test hors processus approuvé.
5. **Fenêtre et code :** confirmer les branches/commits concernés, compatibilité du code avec le schéma avant/après, stratégie de déploiement, flags restant éteints, plan de retour arrière et critères d’arrêt. Une CI verte ne prouve pas que la migration a été appliquée sur la cible.
6. **Après application autorisée :** relever les noms/checksums/horodatages en `_prisma_migrations); vérifier absence d’échec/en attente inattendue, tables/colonnes/index/FK/checks, invariants et compteurs avant/après, erreurs et durée; enregistrer la preuve sans données personnelles ni secrets.

## Questions d’autorisation — une réponse distincte par fichier

Pour chacune, la réponse doit nommer **le fichier exact**, **l’environnement/la base visés** et autoriser explicitement l’application après les précontrôles et la sauvegarde restaurée. Une autorisation générale ou l’accord sur une PR ne vaut pas autorisation de migration. Sans accord séparé, aucune application, connexion, snapshot ou changement Production n’est permis.

- Autorises-tu, après les contrôles requis, `20261019190000_separate_xp_balance` de #325 sur la cible explicitement désignée?
- Autorises-tu, après les contrôles requis, `20261020150000_session_voice_presence` de #325 sur cette cible?
- Autorises-tu, après les contrôles requis, `20261022120000_voice_presence_consent_coordination` de #325 sur cette cible?
- Autorises-tu, après les contrôles requis, `20261022130000_voice_presence_retention_gap_bounds` de #325 sur cette cible?
- Autorises-tu, après les contrôles requis, `20261022140000_voice_presence_gap_history` de #325 sur cette cible?
- Autorises-tu, après les contrôles requis, `20261022142500_shop_balance_purchase_reason` de #325 sur cette cible?
- Autorises-tu, après les contrôles requis, `20261104140000_tower_team_membership_policy` de #370 sur cette cible?
- Autorises-tu, après les contrôles requis, `20261105120000_tower_launch_channels_appeals_matchmaking` de #406 sur cette cible?

