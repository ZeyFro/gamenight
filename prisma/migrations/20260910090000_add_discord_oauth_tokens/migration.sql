-- Fix bug remonté : cron avatars Discord (pas de table Account Auth.js,
-- session JWT sans base) — persiste les jetons OAuth Discord de chaque
-- user pour que le cron puisse les réutiliser/rafraîchir hors session.
ALTER TABLE "User" ADD COLUMN "discordAccessToken" TEXT;
ALTER TABLE "User" ADD COLUMN "discordRefreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN "discordTokenExpiresAt" TIMESTAMP(3);
