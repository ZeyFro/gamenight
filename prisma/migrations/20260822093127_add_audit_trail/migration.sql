-- Audit trail (avant PR 5/9 du chantier XP) — colonnes d'abord nullables,
-- le temps de backfiller les lignes existantes (MessageTemplate a déjà
-- des lignes seedées ; GameStatType/Superlative ont déjà les lignes
-- seedées par PR 4/9), puis rendues obligatoires.

-- MessageTemplate : backfillé à son propre createdById/createdAt — pour
-- une ligne existante, "dernière modif" = "création" tant que personne
-- n'y a retouché depuis l'ajout de ce suivi.
ALTER TABLE "MessageTemplate" ADD COLUMN "modifiedById" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "modifiedAt" TIMESTAMP(3);

UPDATE "MessageTemplate" SET "modifiedById" = "createdById", "modifiedAt" = "createdAt";

ALTER TABLE "MessageTemplate" ALTER COLUMN "modifiedById" SET NOT NULL;
ALTER TABLE "MessageTemplate" ALTER COLUMN "modifiedAt" SET NOT NULL;

-- GameStatType/Superlative : pas de notion d'auteur avant cet ajout,
-- backfillées au compte le plus ancien du groupe (même repli que
-- prisma/seed.mjs pour l'auteur des messages par défaut) ; forcément déjà
-- présent puisque des GameStatType existent (seedées par PR 4/9, qui
-- suppose elle-même déjà un user en base).
ALTER TABLE "GameStatType" ADD COLUMN "modifiedById" TEXT;
ALTER TABLE "GameStatType" ADD COLUMN "modifiedAt" TIMESTAMP(3);

UPDATE "GameStatType"
SET "modifiedById" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1),
    "modifiedAt" = "createdAt";

ALTER TABLE "GameStatType" ALTER COLUMN "modifiedById" SET NOT NULL;
ALTER TABLE "GameStatType" ALTER COLUMN "modifiedAt" SET NOT NULL;

ALTER TABLE "Superlative" ADD COLUMN "modifiedById" TEXT;
ALTER TABLE "Superlative" ADD COLUMN "modifiedAt" TIMESTAMP(3);

UPDATE "Superlative"
SET "modifiedById" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1),
    "modifiedAt" = "createdAt";

ALTER TABLE "Superlative" ALTER COLUMN "modifiedById" SET NOT NULL;
ALTER TABLE "Superlative" ALTER COLUMN "modifiedAt" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_modifiedById_fkey" FOREIGN KEY ("modifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameStatType" ADD CONSTRAINT "GameStatType_modifiedById_fkey" FOREIGN KEY ("modifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Superlative" ADD CONSTRAINT "Superlative_modifiedById_fkey" FOREIGN KEY ("modifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
