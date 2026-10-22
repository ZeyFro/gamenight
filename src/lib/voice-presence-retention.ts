import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";

const DEFAULT_BATCH_SIZE = 500;
const VOICE_PRESENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export async function purgeExpiredVoicePresenceBatch(opts: {
  now?: Date;
  limit?: number;
  dryRun: boolean;
}) {
  const now = opts.now ?? wallClockNow();
  const limit = opts.limit ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Voice presence retention limit must be positive");

  const intervals = await prisma.sessionVoicePresenceInterval.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const consents = await prisma.sessionVoicePresenceConsent.findMany({
    where: { expiresAt: { lte: now } },
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
         AND session.status = 'DONE'
         AND control.status IN ('STOP_REQUESTED', 'FINALIZED')
         AND control."stopAt" IS NOT NULL
         AND control."stopAt" <= ${new Date(now.getTime() - VOICE_PRESENCE_RETENTION_MS)}
       )
    ORDER BY COALESCE(gap."expiresAt", control."stopAt" + INTERVAL '30 days') ASC
    LIMIT ${limit}
  `;
  const controls = await prisma.sessionVoicePresenceControl.findMany({
    where: {
      OR: [
        { status: "PURGED" },
        { status: "FINALIZED", stopAt: { lte: new Date(now.getTime() - VOICE_PRESENCE_RETENTION_MS) } },
        {
          status: "PURGE_REQUESTED",
          session: { is: { status: "CANCELLED" } },
          OR: [
            { leaseOwner: null },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: now } },
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
      where: { sessionId: { in: controls.map(row => row.sessionId) }, status: { in: ["PURGED", "FINALIZED", "PURGE_REQUESTED"] } },
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
