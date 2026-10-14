-- Préférences de sollicitations personnelles par catégorie.
-- Les deux catégories ci-dessous étaient historiquement gouvernées par
-- User.silenceReminders : le backfill en conserve donc exactement le sens.
-- Les catégories sans rapport ne sont volontairement pas créées ici.
CREATE TYPE "UserNotificationCategory" AS ENUM ('SESSION', 'ROULETTE');

CREATE TABLE "UserNotificationPreference" (
    "userId" TEXT NOT NULL,
    "category" "UserNotificationCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("userId", "category")
);

ALTER TABLE "UserNotificationPreference"
ADD CONSTRAINT "UserNotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "UserNotificationPreference" ("userId", "category", "enabled", "updatedAt")
SELECT "id", categories.category, NOT "silenceReminders", CURRENT_TIMESTAMP
FROM "User"
CROSS JOIN unnest(enum_range(NULL::"UserNotificationCategory")) AS categories(category);
