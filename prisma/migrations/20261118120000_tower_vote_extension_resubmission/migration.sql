-- Décision 17/11/2026 : sans quorum à 24 h, prolongation unique de 24 h puis rejet sans pénalité,
-- avec une seule resoumission. Additive : colonnes facultatives ou à valeur par défaut.
ALTER TABLE "TowerChallengeAttempt"
  ADD COLUMN "voteExtendedAt" TIMESTAMP(3),
  ADD COLUMN "quorumResubmissions" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "resubmitUntil" TIMESTAMP(3),
  ADD CONSTRAINT "TowerChallengeAttempt_quorumResubmissions_check"
    CHECK ("quorumResubmissions" BETWEEN 0 AND 1);
