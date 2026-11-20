-- Personnalisation du profil (PROFILE_CUSTOMIZATION_ENABLED). Migration additive : une enum et trois tables,
-- aucune table existante modifiée. Données de présentation uniquement ; aucun paiement. À appliquer après #416.
CREATE TYPE "ProfileEntitlementSource" AS ENUM ('EARNED', 'BOOSTER', 'GRANT', 'PREMIUM');

CREATE TABLE "ProfileEntitlement" (
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "source" "ProfileEntitlementSource" NOT NULL,
    "reason" VARCHAR(120),
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileEntitlement_pkey" PRIMARY KEY ("communityId","userId","key","source")
);

CREATE TABLE "ProfileCustomization" (
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nameStyleId" VARCHAR(64),
    "cardThemeId" VARCHAR(64),
    "frameFxId" VARCHAR(64),
    "bannerFxId" VARCHAR(64),
    "effectId" VARCHAR(64),
    "titleId" VARCHAR(64),
    "entranceId" VARCHAR(64),
    "showcaseBadgeIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileCustomization_pkey" PRIMARY KEY ("communityId","userId")
);

CREATE TABLE "UserProfileEffectsPreference" (
    "userId" TEXT NOT NULL,
    "effectsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfileEffectsPreference_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "ProfileEntitlement_communityId_key_idx" ON "ProfileEntitlement"("communityId", "key");
CREATE INDEX "ProfileEntitlement_userId_idx" ON "ProfileEntitlement"("userId");

ALTER TABLE "ProfileEntitlement" ADD CONSTRAINT "ProfileEntitlement_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileEntitlement" ADD CONSTRAINT "ProfileEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileCustomization" ADD CONSTRAINT "ProfileCustomization_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileCustomization" ADD CONSTRAINT "ProfileCustomization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProfileEffectsPreference" ADD CONSTRAINT "UserProfileEffectsPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
