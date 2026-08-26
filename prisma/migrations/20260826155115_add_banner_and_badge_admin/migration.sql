-- Bannière de profil (PR 8/9) — additive, pas de backfill nécessaire.
ALTER TABLE "User" ADD COLUMN "bannerUrl" TEXT;

-- Audit trail + actif sur Badge (PR 8/9, /admin/badges) — même schéma
-- que la migration "add_audit_trail" (PR 5/9) : colonnes d'abord
-- nullables, le temps de backfiller les 15 lignes déjà seedées par PR
-- 7/9 (repli au compte le plus ancien du groupe, même logique que
-- GameStatType/Superlative en leur temps), puis rendues obligatoires.
-- `active` a un DEFAULT donc ne pose aucun problème sur les lignes
-- existantes (backfillées à `true`, ce qu'elles sont déjà implicitement).
ALTER TABLE "Badge" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Badge" ADD COLUMN "modifiedById" TEXT;
ALTER TABLE "Badge" ADD COLUMN "modifiedAt" TIMESTAMP(3);

UPDATE "Badge"
SET "modifiedById" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1),
    "modifiedAt" = "createdAt";

ALTER TABLE "Badge" ALTER COLUMN "modifiedById" SET NOT NULL;
ALTER TABLE "Badge" ALTER COLUMN "modifiedAt" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_modifiedById_fkey" FOREIGN KEY ("modifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
