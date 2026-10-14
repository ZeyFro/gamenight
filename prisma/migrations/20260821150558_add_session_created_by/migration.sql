-- AlterTable : colonne d'abord nullable, le temps de backfiller les
-- sessions existantes (elles n'avaient jusqu'ici aucune notion de
-- créateur, cf. F5).
ALTER TABLE "Session" ADD COLUMN "createdById" TEXT;

-- Backfill — choix assumé : le membre du groupe le plus récemment arrivé
-- mais déjà présent avant la création de la session (meilleure estimation
-- possible après coup, faute d'avoir enregistré qui a cliqué "Créer" à
-- l'époque) ; à défaut (aucun utilisateur connu avant cette session), le
-- compte le plus ancien du groupe.
UPDATE "Session" s
SET "createdById" = COALESCE(
  (SELECT u."id" FROM "User" u WHERE u."createdAt" <= s."createdAt" ORDER BY u."createdAt" DESC LIMIT 1),
  (SELECT u."id" FROM "User" u ORDER BY u."createdAt" ASC LIMIT 1)
);

-- Rendre la colonne obligatoire maintenant que toutes les lignes existantes
-- sont backfillées (toute nouvelle session passera par createSession, qui
-- renseigne createdById dès la création).
ALTER TABLE "Session" ALTER COLUMN "createdById" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
