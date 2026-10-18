ALTER TABLE "Community"
  ADD COLUMN "groupPurchasePlansEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GameWishlist"
  ADD COLUMN "groupPurchaseTargetDate" TIMESTAMP(3),
  ADD COLUMN "groupPurchaseNote" VARCHAR(300);
