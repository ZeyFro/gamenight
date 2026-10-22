import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";

export type VoicePresenceEndMode = "FINALIZE" | "PURGE";

export const VOICE_PRESENCE_LEASE_MS = 45_000;
const VOICE_PRESENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

async function findOpenVoicePresenceGap(tx: Prisma.TransactionClient, sessionId: string) {
  return tx.sessionVoicePresenceGap.findFirst({
    where: { sessionId, resumedAt: null },
    orderBy: { startedAt: "asc" },
  });
}

async function ensureOpenVoicePresenceGap(
  tx: Prisma.TransactionClient,
  input: { sessionId: string; generation: number; startedAt: Date; expiresAt?: Date | null },
) {
  const existing = await findOpenVoicePresenceGap(tx, input.sessionId);
  if (existing) return existing;
  return tx.sessionVoicePresenceGap.create({
    data: {
      sessionId: input.sessionId,
      generation: input.generation,
      startedAt: input.startedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    },
  });
}

/** Fence a collector when consent is gone while retaining any unresolved gap. */
export async function fenceSessionVoicePresenceLeasePreservingGap(
  tx: Prisma.TransactionClient,
  sessionId: string,
  now: Date,
) {
  await tx.$queryRaw`SELECT "sessionId" FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
  const control = await tx.sessionVoicePresenceControl.findUnique({ where: { sessionId } });
  if (!control || control.status !== "ACTIVE") return false;

  const openGap = await findOpenVoicePresenceGap(tx, sessionId);
  const gapStartedAt = openGap?.startedAt
    ?? (control.gapDetected && control.lastGapAt === null ? control.gapStartedAt : null);
  if (gapStartedAt) {
    await ensureOpenVoicePresenceGap(tx, {
      sessionId,
      generation: control.generation,
      startedAt: gapStartedAt,
      expiresAt: control.stopAt ? new Date(control.stopAt.getTime() + VOICE_PRESENCE_RETENTION_MS) : null,
    });
  }

  await tx.sessionVoicePresenceControl.update({
    where: { sessionId },
    data: {
      leaseOwner: null,
      leaseExpiresAt: null,
      generation: { increment: 1 },
      heartbeatAt: now,
      gapDetected: gapStartedAt !== null,
      gapStartedAt,
      lastGapAt: null,
    },
  });
  return true;
}

export async function requestSessionVoicePresenceStop(
  tx: Prisma.TransactionClient,
  sessionId: string,
  mode: VoicePresenceEndMode,
  stopAt: Date,
) {
  await tx.$queryRaw`SELECT "sessionId" FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
  const existing = await tx.sessionVoicePresenceControl.findUnique({
    where: { sessionId },
    select: { sessionId: true, leaseOwner: true, leaseExpiresAt: true },
  });

  if (mode === "PURGE") {
    await tx.sessionVoicePresenceInterval.deleteMany({ where: { sessionId } });
    await tx.sessionVoicePresenceConsent.deleteMany({ where: { sessionId } });
    await tx.sessionVoicePresenceGap.deleteMany({ where: { sessionId } });

    if (existing) {
      const leaseIsLive = existing.leaseOwner !== null
        && existing.leaseExpiresAt !== null
        && existing.leaseExpiresAt > stopAt;
      if (leaseIsLive) {
        await tx.sessionVoicePresenceControl.update({
          where: { sessionId },
          data: { status: "PURGE_REQUESTED", stopAt, gapDetected: false, gapStartedAt: null, lastGapAt: null },
        });
      } else {
        // No worker needs to acknowledge this command; removing the control
        // row avoids an uncollectable cancellation tombstone.
        await tx.sessionVoicePresenceControl.delete({ where: { sessionId } });
      }
    }
    return;
  }

  if (existing) {
    await tx.sessionVoicePresenceControl.update({
      where: { sessionId },
      data: { status: "STOP_REQUESTED", stopAt },
    });
  } else {
    await tx.sessionVoicePresenceControl.create({ data: { sessionId, status: "STOP_REQUESTED", stopAt } });
  }
}

export async function claimSessionVoicePresenceLease(
  sessionId: string,
  workerId: string,
  now: Date,
  leaseMs = VOICE_PRESENCE_LEASE_MS,
  db: typeof prisma = prisma,
) {
  if (!workerId || !Number.isSafeInteger(leaseMs) || leaseMs < 5_000) throw new Error("Invalid voice presence lease request");

  return db.$transaction(async tx => {
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Session"
      WHERE id = ${sessionId} AND status = 'SCHEDULED' AND date <= ${now}
      FOR UPDATE
    `;
    if (!sessions.length) return { claimed: false as const };

    // Consent can change after the worker loaded its target list. Withdrawal
    // locks this same Session row before deleting consent, so this check and
    // the lease claim are ordered against revocation.
    const consents = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SessionVoicePresenceConsent"
      WHERE "sessionId" = ${sessionId}
        AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      LIMIT 1
      FOR UPDATE
    `;
    if (!consents.length) return { claimed: false as const };

    await tx.sessionVoicePresenceControl.createMany({
      data: [{ sessionId, status: "ACTIVE" }],
      skipDuplicates: true,
    });
    const controls = await tx.$queryRaw<{
      generation: number;
      status: string;
      leaseOwner: string | null;
      leaseExpiresAt: Date | null;
      heartbeatAt: Date | null;
      gapDetected: boolean;
      gapStartedAt: Date | null;
      lastGapAt: Date | null;
    }[]>`
      SELECT "generation", status, "leaseOwner", "leaseExpiresAt", "heartbeatAt", "gapDetected", "gapStartedAt", "lastGapAt"
      FROM "SessionVoicePresenceControl"
      WHERE "sessionId" = ${sessionId}
      FOR UPDATE
    `;
    const control = controls[0];
    if (!control || control.status !== "ACTIVE") return { claimed: false as const };

    const leaseIsLive = control.leaseOwner !== null && control.leaseExpiresAt !== null && control.leaseExpiresAt > now;
    if (leaseIsLive && control.leaseOwner !== workerId) return { claimed: false as const };

    const renewedSameLease = control.leaseOwner === workerId && leaseIsLive;
    const takeover = control.leaseOwner !== null && !renewedSameLease;
    const generation = control.generation + (renewedSameLease ? 0 : 1);
    const gapDetected = control.gapDetected || takeover;
    const takeoverGapStartedAt = control.gapDetected && control.lastGapAt === null
      ? control.gapStartedAt ?? control.heartbeatAt ?? control.leaseExpiresAt ?? now
      : control.heartbeatAt ?? control.leaseExpiresAt ?? now;
    if (takeover) {
      await ensureOpenVoicePresenceGap(tx, {
        sessionId,
        generation,
        startedAt: takeoverGapStartedAt,
      });
    }
    await tx.sessionVoicePresenceControl.update({
      where: { sessionId },
      data: {
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        heartbeatAt: now,
        generation,
        gapDetected,
        ...(takeover ? {
          gapStartedAt: takeoverGapStartedAt,
          lastGapAt: null,
        } : {}),
      },
    });
    return { claimed: true as const, generation, gapDetected };
  });
}

/** Final authorization immediately before the runtime constructs a Gateway collector. */
export async function validateSessionVoicePresenceLease(
  sessionId: string,
  workerId: string,
  generation: number,
  now: Date,
  db: typeof prisma = prisma,
) {
  return db.$transaction(async tx => {
    const sessions = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Session"
      WHERE id = ${sessionId} AND status = 'SCHEDULED' AND date <= ${now}
      FOR UPDATE
    `;
    if (!sessions.length) return false;

    const consents = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SessionVoicePresenceConsent"
      WHERE "sessionId" = ${sessionId}
        AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      LIMIT 1
      FOR SHARE
    `;
    const controls = await tx.$queryRaw<{
      status: string;
      generation: number;
      leaseOwner: string | null;
      leaseExpiresAt: Date | null;
    }[]>`
      SELECT status::text AS status, "generation", "leaseOwner", "leaseExpiresAt"
      FROM "SessionVoicePresenceControl"
      WHERE "sessionId" = ${sessionId}
      FOR UPDATE
    `;
    const control = controls[0];
    if (!control) return false;

    const matchesLease = control.status === "ACTIVE"
      && control.leaseOwner === workerId
      && control.generation === generation
      && control.leaseExpiresAt !== null
      && control.leaseExpiresAt > now;
    if (consents.length && matchesLease) return true;

    if (!consents.length && matchesLease) {
      // Consent can expire between target discovery and collector creation.
      await fenceSessionVoicePresenceLeasePreservingGap(tx, sessionId, now);
    }
    return false;
  });
}

export async function releaseSessionVoicePresenceLease(
  sessionId: string,
  workerId: string,
  generation: number,
  now: Date,
  db: typeof prisma = prisma,
) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "sessionId" FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
    const control = await tx.sessionVoicePresenceControl.findUnique({ where: { sessionId } });
    if (!control || !["ACTIVE", "STOP_REQUESTED", "PURGE_REQUESTED"].includes(control.status)
      || control.leaseOwner !== workerId || control.generation !== generation) return [];

    if (control.status === "ACTIVE") {
      const gapStartedAt = control.gapDetected && control.lastGapAt === null
        ? control.gapStartedAt ?? control.heartbeatAt ?? control.leaseExpiresAt ?? now
        : control.heartbeatAt ?? control.leaseExpiresAt ?? now;
      await ensureOpenVoicePresenceGap(tx, { sessionId, generation, startedAt: gapStartedAt });
      await tx.sessionVoicePresenceControl.update({
        where: { sessionId },
        data: {
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
          gapDetected: true,
          gapStartedAt,
          lastGapAt: null,
        },
      });
    } else {
      await tx.sessionVoicePresenceControl.update({
        where: { sessionId },
        data: { leaseOwner: null, leaseExpiresAt: null, heartbeatAt: now },
      });
    }
    return [{ sessionId }];
  });
}

export async function markSessionVoicePresenceGap(
  sessionId: string,
  workerId: string,
  generation: number,
  at: Date,
  db: typeof prisma = prisma,
) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "sessionId" FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
    const control = await tx.sessionVoicePresenceControl.findUnique({ where: { sessionId } });
    if (!control || !["ACTIVE", "STOP_REQUESTED"].includes(control.status)
      || control.leaseOwner !== workerId || control.generation !== generation) return [];

    const openGap = await findOpenVoicePresenceGap(tx, sessionId);
    const gapStartedAt = control.gapDetected && control.lastGapAt === null
      ? openGap?.startedAt ?? control.gapStartedAt ?? control.heartbeatAt ?? control.leaseExpiresAt ?? at
      : control.heartbeatAt ?? control.leaseExpiresAt ?? at;
    const expiresAt = control.stopAt ? new Date(control.stopAt.getTime() + VOICE_PRESENCE_RETENTION_MS) : null;
    await ensureOpenVoicePresenceGap(tx, { sessionId, generation, startedAt: gapStartedAt, expiresAt });
    await tx.sessionVoicePresenceControl.update({
      where: { sessionId },
      data: { gapDetected: true, gapStartedAt, lastGapAt: null, heartbeatAt: at },
    });
    return [{ sessionId }];
  });
}

/** Record the first fresh Gateway state after a gap; it never creates duration. */
export async function markSessionVoicePresenceGapRecovered(
  sessionId: string,
  workerId: string,
  generation: number,
  at: Date,
  db: typeof prisma = prisma,
) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "sessionId" FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
    const control = await tx.sessionVoicePresenceControl.findUnique({ where: { sessionId } });
    if (!control || !["ACTIVE", "STOP_REQUESTED"].includes(control.status)
      || control.leaseOwner !== workerId || control.generation !== generation
      || !control.leaseExpiresAt || control.leaseExpiresAt <= at
      || !control.gapDetected || control.lastGapAt !== null) return [];

    const openGap = await findOpenVoicePresenceGap(tx, sessionId);
    if (openGap) {
      await tx.sessionVoicePresenceGap.update({ where: { id: openGap.id }, data: { resumedAt: at } });
    } else if (control.gapStartedAt) {
      await tx.sessionVoicePresenceGap.create({
        data: {
          sessionId,
          generation,
          startedAt: control.gapStartedAt,
          resumedAt: at,
          ...(control.stopAt ? { expiresAt: new Date(control.stopAt.getTime() + VOICE_PRESENCE_RETENTION_MS) } : {}),
        },
      });
    }
    await tx.sessionVoicePresenceControl.update({
      where: { sessionId },
      data: { lastGapAt: at, heartbeatAt: at },
    });
    return [{ sessionId }];
  });
}

export async function finalizeSessionVoicePresenceCommand(sessionId: string, db: typeof prisma = prisma) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "sessionId" FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
    const control = await tx.sessionVoicePresenceControl.findUnique({ where: { sessionId } });
    if (!control) return false;

    if (control.status === "PURGE_REQUESTED") {
      await tx.sessionVoicePresenceInterval.deleteMany({ where: { sessionId } });
      await tx.sessionVoicePresenceConsent.deleteMany({ where: { sessionId } });
      await tx.sessionVoicePresenceGap.deleteMany({ where: { sessionId } });
      await tx.sessionVoicePresenceControl.update({
        where: { sessionId },
        data: {
          status: "PURGED",
          leaseOwner: null,
          leaseExpiresAt: null,
          gapDetected: false,
          gapStartedAt: null,
          lastGapAt: null,
        },
      });
      return true;
    }
    if (control.status !== "STOP_REQUESTED") return false;
    const expiresAt = new Date((control.stopAt ?? wallClockNow()).getTime() + VOICE_PRESENCE_RETENTION_MS);
    await tx.sessionVoicePresenceConsent.updateMany({
      where: { sessionId },
      data: { expiresAt },
    });
    await tx.sessionVoicePresenceInterval.updateMany({
      where: { sessionId },
      data: { expiresAt },
    });
    await tx.sessionVoicePresenceGap.updateMany({
      where: { sessionId },
      data: { expiresAt },
    });
    await tx.sessionVoicePresenceControl.update({
      where: { sessionId },
      data: { status: "FINALIZED", leaseOwner: null, leaseExpiresAt: null },
    });
    return true;
  });
}
