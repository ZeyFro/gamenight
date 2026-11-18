-- La progression actuelle est conservée ; seuls les prochains achats consomment le solde.
ALTER TABLE "CommunityMemberStats" ADD COLUMN "xpBalance" INTEGER NOT NULL DEFAULT 0;
UPDATE "CommunityMemberStats" SET "xpBalance" = "xpTotal";
ALTER TABLE "CommunityMemberStats" ADD CONSTRAINT "CommunityMemberStats_xpBalance_nonnegative" CHECK ("xpBalance" >= 0);
