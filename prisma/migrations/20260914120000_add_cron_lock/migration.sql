-- Fix bug remonté (F7, rappels Discord en double) — verrou global du cron
-- `reminders` : au plus une exécution envoie des rappels à la fois, même si
-- deux exécutions du cron externe se chevauchent. La ligne singleton
-- ("reminders") est créée ICI, dans la migration, PAS par le seed
-- quotidien/décorrélé (`runSeedReconciliation`, appelé uniquement par
-- `POST /api/backfill/seed-reconcile`) : `prisma migrate deploy` s'exécute
-- de façon synchrone dans `npm run build`, avant `next build` et avant que
-- le nouveau déploiement ne serve le moindre trafic (cutover atomique
-- Vercel) — la ligne existe donc forcément avant le premier appel possible
-- à la route. Voir `src/lib/cron-lock.ts` pour l'acquisition/libération
-- (comparaison sur `token`, bail TTL) et `src/app/api/cron/reminders/route.ts`
-- pour le comportement "fail closed" si cette ligne venait à manquer.

-- CreateTable
CREATE TABLE "CronLock" (
    "name" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "token" TEXT,

    CONSTRAINT "CronLock_pkey" PRIMARY KEY ("name")
);

-- Seed : ligne singleton du verrou "reminders", non verrouillée au départ.
INSERT INTO "CronLock" ("name", "lockedAt", "token")
VALUES ('reminders', NULL, NULL)
ON CONFLICT ("name") DO NOTHING;
