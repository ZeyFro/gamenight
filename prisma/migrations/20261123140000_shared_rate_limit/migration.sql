-- Limitation de débit partagée entre les serveurs Vercel (contrôle de sécurité T2), pour les seules actions
-- sensibles (suppression et export de compte, reconnexion forcée, enregistrement des commandes Discord).
-- Additive : une nouvelle table, aucune donnée existante modifiée. Clé = action + identifiant opaque du compte.
CREATE TABLE "RateLimitWindow" (
    "key" VARCHAR(255) NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitWindow_pkey" PRIMARY KEY ("key", "windowStart")
);

CREATE INDEX "RateLimitWindow_windowStart_idx" ON "RateLimitWindow"("windowStart");
