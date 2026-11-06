-- Retour arrière de *_separate_xp_balance : supprime "CommunityMemberStats"."xpBalance" et sa contrainte.
-- Refuse si un solde a divergé de xpTotal (achats au solde, recalage) : exporter et arbitrer d'abord, voir
-- docs/XP-MIGRATIONS-ROLLBACK.md. Verrou ACCESS EXCLUSIVE bref (pas de réécriture de table).
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CommunityMemberStats" WHERE "xpBalance" <> "xpTotal") THEN
    RAISE EXCEPTION 'Rollback interdit : % ligne(s) avec xpBalance <> xpTotal; exporter et arbitrer les soldes.',
      (SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" <> "xpTotal");
  END IF;
END $$;
ALTER TABLE "CommunityMemberStats" DROP CONSTRAINT "CommunityMemberStats_xpBalance_nonnegative";
ALTER TABLE "CommunityMemberStats" DROP COLUMN "xpBalance";
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%\_separate_xp_balance';
COMMIT;
