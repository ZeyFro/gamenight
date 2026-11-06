# Retour arrière des 6 migrations du lot XP + vocal (#325)

Protocole, pas une autorisation : aucun retour arrière n'est exécuté par le dépôt, par le build ni par un script applicatif. Procédure d'ensemble : `docs/XP-PROCEDURE-PRODUCTION.md`. SQL : `scripts/rollback-xp-lot/NN_*.down.sql`. Répétition locale : `scripts/rehearse-xp-rollback.sh`.

Les noms ci-dessous sont ceux d'avant le renommage de la phase 4 ; les scripts retrouvent leur ligne `_prisma_migrations` par suffixe, ils restent valables après renommage.

## Choisir le retour arrière

| Situation | Action préférée |
|---|---|
| Avant déploiement du nouveau code, aucune écriture applicative depuis le snapshot | **Restaurer le snapshot Neon** (branche de restauration, `finalize` seulement après vérification) : plus simple et sans perte |
| Migration en échec en cours de lot (`db-migrate.mjs` sortie 3) | Ne pas relancer. Lire `_prisma_migrations` (ligne `finished_at IS NULL`), puis restauration du snapshot. `migrate resolve` seulement après revue de l'état exact |
| Lot appliqué, code déployé, écritures déjà reçues | SQL ci-dessous, ordre inverse, **après retour de l'application au code de `main`** (le code de `main` ne lit aucun objet du lot ; le nouveau code, lui, en dépend) |
| Doute | Maintenance maintenue, pas de retour arrière improvisé |

## Règles communes

1. Ordre imposé : **06 → 05 → 04 → 03 → 02 → 01** (05 dépend de 03 et 04 ; 03 modifie la table de 02). Chaque fichier vérifie ses prérequis et refuse sinon.
2. Un fichier = une transaction. Un refus (`Rollback interdit : …`) annule tout, sans effet.
3. Chaque fichier supprime lui-même sa ligne `_prisma_migrations` (par suffixe). Après le dernier, `node scripts/db-migrate.mjs --expect=<les 6 noms>` doit de nouveau proposer les 6 migrations (preuve de réconciliation).
4. Données vocales (02 à 05) : **exporter d'abord** (`\copy … TO …` des tables concernées, en local sécurisé, données personnelles), puis accepter la perte dans la MÊME session avec `SET gamenight.allow_voice_data_loss = 'on';`. Sans cela, refus dès qu'une ligne existe.
5. Aucun retour arrière ne se fait à chaud : écritures coupées (barrière), workers vocaux arrêtés, crons en pause, `pg_stat_activity` vérifié.

## Par migration

| # | Migration | Effet du retour arrière | Condition d'arrêt (lecture seule, à lancer avant) | Perte possible | Mesuré en répétition |
|---|---|---|---|---|---|
| 06 | `shop_balance_purchase_reason` | Reconstruit l'enum `XpReason` sans `SHOP_BALANCE_PURCHASE` (libellés relus dans l'ordre) | `SELECT count(*) FROM "XpEvent" WHERE reason::text = 'SHOP_BALANCE_PURCHASE';` doit valoir 0 ; une seule colonne utilise `XpReason` | aucune (refus si achat au solde) | refus avec achat ; OK sans |
| 05 | `voice_presence_gap_history` | Supprime `SessionVoicePresenceGap` | `SELECT count(*) FROM "SessionVoicePresenceGap";` | historique des lacunes | refus avec ligne ; OK avec autorisation |
| 04 | `voice_presence_retention_gap_bounds` | Supprime `SessionVoicePresenceControl.gapStartedAt` | `SELECT count(*) FROM "SessionVoicePresenceControl" WHERE "gapStartedAt" IS NOT NULL;` | dates de début de lacune | couvert par S1 |
| 03 | `voice_presence_consent_coordination` | Supprime consentements, contrôle, enum, colonnes `consentId`/`endedAt`/`expiresAt` | 05 et 04 déjà annulées ; comptes de `…Consent`, `…Control`, `…Interval` | consentements, contrôles, échéances de rétention | refus tant que 04/05 présentes |
| 02 | `session_voice_presence` | Supprime `SessionVoicePresenceInterval` | 03 annulée ; `SELECT count(*) FROM "SessionVoicePresenceInterval";` | durées de présence collectées | couvert par S1 |
| 01 | `separate_xp_balance` | Supprime la contrainte puis la colonne `xpBalance` | `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" <> "xpTotal";` doit valoir 0 | aucune (refus si soldes divergés) | refus avec solde divergé ; verrou bref |

### Cas 01 : soldes divergés (code nouveau déjà utilisé)

Le retour arrière refuse : `xpBalance` contient des achats qui n'existent pas dans `xpTotal`. Ne jamais recopier `xpBalance = xpTotal` ni `xpTotal = xpBalance` en masse. Arbitrage à faire joueur par joueur avec le propriétaire (exporter `communityId, userId, xpTotal, xpBalance` des lignes divergentes ; choisir restitution, annulation ou maintien du nouveau code). En attendant, le correctif applicatif est préférable au retour arrière.

### Cas 06 : achats au solde existants

Le retour arrière refuse tant qu'un `XpEvent` porte `SHOP_BALANCE_PURCHASE`. Ces événements sont le seul registre des achats débités sur `xpBalance` : ne pas les supprimer ni les convertir sans décision du propriétaire.

## Vérifications après retour arrière

```sql
-- aucune des 6 lignes ne subsiste
SELECT migration_name FROM _prisma_migrations WHERE migration_name ~ '(separate_xp_balance|session_voice_presence|voice_presence_|shop_balance_purchase_reason)$';
-- objets absents
SELECT to_regclass('"SessionVoicePresenceInterval"'), to_regclass('"SessionVoicePresenceConsent"'),
       to_regclass('"SessionVoicePresenceControl"'), to_regclass('"SessionVoicePresenceGap"');
SELECT column_name FROM information_schema.columns WHERE table_name = 'CommunityMemberStats' AND column_name = 'xpBalance';
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'XpReason' AND enumlabel = 'SHOP_BALANCE_PURCHASE';
```

Tout doit être vide / NULL. Puis `xp-lot-invariants.mjs --phase=before` doit de nouveau passer (même empreinte que le précontrôle si aucune écriture n'a eu lieu).

## Ce qui a été répété localement (6 novembre, base jetable 127.0.0.1)

`scripts/rehearse-xp-rollback.sh` : (S1) lot appliqué puis 06→01 : schéma `pg_dump -s` identique à la baseline de `main`, données XP inchangées, 6 lignes `_prisma_migrations` supprimées ; (S2) lot rejoué après retour arrière ; (S3) refus sur achat au solde, lacunes, ordre non respecté, solde divergé, et acceptation avec `allow_voice_data_loss`. Résultat : 9 contrôles OK. Non vérifié : comportement sur Neon (versions, extensions), volume Production.
