-- Suppression de compte (ACCOUNT_DELETION_ENABLED) : une nouvelle table de journal, aucune table existante modifiée.
-- Additive, sans donnée personnelle (identifiant opaque + compteurs). Appliquée automatiquement après fusion dans main
-- par `migrate-production.yml` (docs/MIGRATIONS.md), jamais au build. Sans elle, la suppression refuse (rien n'est écrit).
CREATE TABLE "AccountDeletionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountDeletionLog_userId_idx" ON "AccountDeletionLog"("userId");

CREATE INDEX "AccountDeletionLog_createdAt_idx" ON "AccountDeletionLog"("createdAt");
