import { prisma } from "@/lib/prisma";
import { toWallClock } from "@/lib/wallclock";
import { VOICE_PRESENCE_RETENTION_MS, voiceCollectionRetentionSessionDate } from "./voice-presence-policy";

const DEFAULT_BATCH_SIZE = 500;

/**
 * Les quatre tables vocales existent-elles ? Requête sur le catalogue seulement (jamais sur les tables) : permet de
 * purger les données déjà collectées même si le drapeau de collecte a été remis à `false`, tout en restant inoffensif
 * tant que les migrations vocales ne sont pas appliquées.
 */
export async function voicePresenceTablesExist(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT (
      to_regclass('"SessionVoicePresenceInterval"') IS NOT NULL
      AND to_regclass('"SessionVoicePresenceConsent"') IS NOT NULL
      AND to_regclass('"SessionVoicePresenceControl"') IS NOT NULL
      AND to_regclass('"SessionVoicePresenceGap"') IS NOT NULL
    ) AS present
  `;
  return rows[0]?.present === true;
}

export async function purgeExpiredVoicePresenceBatch(opts: {
  now?: Date;
  limit?: number;
  /** Horloge des baux (heure murale) ; défaut : `now` converti. */
  leaseNow?: Date;
  dryRun: boolean;
}) {
  // Les échéances (stopAt, expiresAt) sont des instants réels ; seuls les baux sont en heure murale.
  const now = opts.now ?? new Date();
  const wallNow = opts.leaseNow ?? toWallClock(now);
  const limit = opts.limit ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Voice presence retention limit must be positive");

  // Borne dure de collecte (D7) : une soirée restée SCHEDULED sans clôture n'est plus collectée 12 h après sa date ;
  // ses accords, lacunes et contrôle sans échéance (expiresAt NULL) expirent 30 jours après cette borne.
  const staleSessionDate = voiceCollectionRetentionSessionDate(wallNow);
  const staleScheduled = { is: { status: "SCHEDULED" as const, date: { lte: staleSessionDate } } };

  const intervals = await prisma.sessionVoicePresenceInterval.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const consents = await prisma.sessionVoicePresenceConsent.findMany({
    where: { OR: [{ expiresAt: { lte: now } }, { expiresAt: null, session: staleScheduled }] },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const gaps = await prisma.$queryRaw<{ id: string }[]>`
    SELECT gap."id"
    FROM "SessionVoicePresenceGap" AS gap
    LEFT JOIN "SessionVoicePresenceControl" AS control ON control."sessionId" = gap."sessionId"
    LEFT JOIN "Session" AS session ON session."id" = gap."sessionId"
    WHERE gap."expiresAt" <= ${now}
       OR (
         gap."expiresAt" IS NULL
         AND session.status = 'SCHEDULED'
         AND session."date" <= ${staleSessionDate}
       )
       OR (
         gap."expiresAt" IS NULL
         AND session.status = 'DONE'
         AND control.status IN ('STOP_REQUESTED', 'FINALIZED')
         AND control."stopAt" IS NOT NULL
         AND control."stopAt" <= ${new Date(now.getTime() - VOICE_PRESENCE_RETENTION_MS)}
       )
    ORDER BY COALESCE(gap."expiresAt", control."stopAt" + INTERVAL '30 days', session."date" + INTERVAL '30 days 12 hours') ASC
    LIMIT ${limit}
  `;
  const controls = await prisma.sessionVoicePresenceControl.findMany({
    where: {
      OR: [
        { status: "PURGED" },
        { status: "FINALIZED", stopAt: { lte: new Date(now.getTime() - VOICE_PRESENCE_RETENTION_MS) } },
        {
          status: "ACTIVE",
          session: staleScheduled,
          OR: [
            { leaseOwner: null },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: wallNow } },
          ],
        },
        {
          status: "PURGE_REQUESTED",
          session: { is: { status: "CANCELLED" } },
          OR: [
            { leaseOwner: null },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: wallNow } },
          ],
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { sessionId: true },
  });

  if (opts.dryRun) {
    return {
      expiredIntervals: intervals.length,
      expiredConsents: consents.length,
      expiredGaps: gaps.length,
      expiredControls: controls.length,
      intervalsDeleted: 0,
      consentsDeleted: 0,
      gapsDeleted: 0,
      controlsDeleted: 0,
    };
  }

  const intervalDelete = intervals.length
    ? await prisma.sessionVoicePresenceInterval.deleteMany({ where: { id: { in: intervals.map(row => row.id) } } })
    : { count: 0 };
  const consentDelete = consents.length
    ? await prisma.sessionVoicePresenceConsent.deleteMany({ where: { id: { in: consents.map(row => row.id) } } })
    : { count: 0 };
  const gapDelete = gaps.length
    ? await prisma.sessionVoicePresenceGap.deleteMany({ where: { id: { in: gaps.map(row => row.id) } } })
    : { count: 0 };
  const controlDelete = controls.length
    ? await prisma.sessionVoicePresenceControl.deleteMany({
      where: { sessionId: { in: controls.map(row => row.sessionId) }, status: { in: ["PURGED", "FINALIZED", "PURGE_REQUESTED", "ACTIVE"] } },
    })
    : { count: 0 };

  return {
    expiredIntervals: intervals.length,
    expiredConsents: consents.length,
    expiredGaps: gaps.length,
    expiredControls: controls.length,
    intervalsDeleted: intervalDelete.count,
    consentsDeleted: consentDelete.count,
    gapsDeleted: gapDelete.count,
    controlsDeleted: controlDelete.count,
  };
}
