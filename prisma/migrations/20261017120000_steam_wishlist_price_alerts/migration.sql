ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WISHLIST_PRICE_DROP';

ALTER TABLE "Community"
  ADD COLUMN "steamPriceAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "steamPriceAlertThreshold" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "steamPriceAlertScannedAt" TIMESTAMP(3);

ALTER TABLE "GameWishlist"
  ADD COLUMN "priceAlertCheckedAt" TIMESTAMP(3),
  ADD COLUMN "priceAlertNotifiedAt" TIMESTAMP(3);

INSERT INTO "CronLock" ("name", "lockedAt", "token")
VALUES ('wishlist-price-alerts', NULL, NULL)
ON CONFLICT ("name") DO NOTHING;
