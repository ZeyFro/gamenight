import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";

const DEFAULT_BATCH_SIZE = 500;

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

  if (opts.dryRun) {
    return {
      expiredIntervals: intervals.length,
      expiredConsents: consents.length,
      intervalsDeleted: 0,
      consentsDeleted: 0,
    };
  }

  const intervalDelete = intervals.length
    ? await prisma.sessionVoicePresenceInterval.deleteMany({ where: { id: { in: intervals.map(row => row.id) } } })
    : { count: 0 };
  const consentDelete = consents.length
    ? await prisma.sessionVoicePresenceConsent.deleteMany({ where: { id: { in: consents.map(row => row.id) } } })
    : { count: 0 };

  return {
    expiredIntervals: intervals.length,
    expiredConsents: consents.length,
    intervalsDeleted: intervalDelete.count,
    consentsDeleted: consentDelete.count,
  };
}
