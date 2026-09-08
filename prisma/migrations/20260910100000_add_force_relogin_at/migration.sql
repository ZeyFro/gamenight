-- Feature "forcer la reconnexion globale" (/admin) — marqueur posé sur tous
-- les users pour invalider les sessions JWT actives (pas de table Session
-- en base à révoquer, voir commentaire sur `discordAccessToken` ci-dessus).
ALTER TABLE "User" ADD COLUMN "forceReloginAt" TIMESTAMP(3);
