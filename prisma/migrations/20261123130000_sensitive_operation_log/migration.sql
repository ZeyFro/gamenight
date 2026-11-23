-- Cahier §19.1 : journal des opérations sensibles (actions d'administration).
-- Additive : une nouvelle table, aucune table existante modifiée. Sans donnée personnelle en clair :
-- identifiant opaque de l'auteur, nom de l'action, cible technique et résultat (jamais de texte saisi).
CREATE TABLE "SensitiveOperationLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" VARCHAR(64) NOT NULL,
    "communityRef" TEXT,
    "target" VARCHAR(191),
    "outcome" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveOperationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SensitiveOperationLog_createdAt_idx" ON "SensitiveOperationLog"("createdAt");

CREATE INDEX "SensitiveOperationLog_action_createdAt_idx" ON "SensitiveOperationLog"("action", "createdAt");
