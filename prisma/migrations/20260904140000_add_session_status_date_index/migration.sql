-- Infra (Sprint 5 suite, I4) — audit des index existants : UserGame.userId
-- (@@id composite), Notification.userId+read, AvailabilityOverride.userId+date
-- (@@unique composite) et XpEvent.userId sont déjà couverts par des index
-- existants (voir prisma/schema.prisma). ChatMessage.createdAt est déjà
-- mieux couvert par l'index composite (sessionId, createdAt) posé au
-- Sprint 5 PR-B. Seul Session (status + date) n'avait encore aucun index.

-- CreateIndex
CREATE INDEX "Session_status_date_idx" ON "Session"("status", "date");
