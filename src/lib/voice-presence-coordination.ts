import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";

export type VoicePresenceEndMode = "FINALIZE" | "PURGE";

export const VOICE_PRESENCE_LEASE_MS = 45_000;
const VOICE_PRESENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export async function requestSessionVoicePresenceStop(
  tx: Prisma.TransactionClient,
  sessionId: string,
  mode: VoicePresenceEndMode,
  stopAt: Date,
) {
  await tx.$queryRaw`SELECT "sessionId" FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
  const existing = await tx.sessionVoicePresenceControl.findUnique({ where: { sessionId }, select: { sessionId: true } });
  const status = mode === "PURGE" ? "PURGE_REQUESTED" : "STOP_REQUESTED";
  if (existing) {
    await tx.sessionVoicePresenceControl.update({
      where: { sessionId },
      data: { status, stopAt, ...(mode === "PURGE" ? { gapDetected: false, gapStartedAt: null, lastGapAt: null } : {}) },
    });
  } else {
    await tx.sessionVoicePresenceControl.create({ data: { sessionId, status, stopAt } });
  }

  if (mode === "PURGE") {
    await tx.sessionVoicePresenceInterval.deleteMany({ where: { sessionId } });
    await tx.sessionVoicePresenceConsent.deleteMany({ where: { sessionId } });
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
    }[]>`
      SELECT "generation", status, "leaseOwner", "leaseExpiresAt", "heartbeatAt", "gapDetected"
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
    await tx.sessionVoicePresenceControl.update({
      where: { sessionId },
      data: {
        leaseOwner: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        heartbeatAt: now,
        generation,
        gapDetected,
        ...(takeover ? {
          gapStartedAt: control.heartbeatAt ?? control.leaseExpiresAt ?? now,
          lastGapAt: null,
        } : {}),
      },
    });
    return { claimed: true as const, generation, gapDetected };
  });
}

export async function releaseSessionVoicePresenceLease(
  sessionId: string,
  workerId: string,
  generation: number,
  now: Date,
  db: typeof prisma = prisma,
) {
  return db.$queryRaw<{ sessionId: string }[]>`
    UPDATE "SessionVoicePresenceControl"
    SET "leaseOwner" = NULL,
        "leaseExpiresAt" = NULL,
        "heartbeatAt" = ${now},
        "gapDetected" = CASE WHEN status = 'ACTIVE' THEN true ELSE "gapDetected" END,
        "gapStartedAt" = CASE WHEN status = 'ACTIVE' THEN COALESCE("heartbeatAt", "leaseExpiresAt", ${now}) ELSE "gapStartedAt" END,
        "lastGapAt" = CASE WHEN status = 'ACTIVE' THEN NULL ELSE "lastGapAt" END
    WHERE "sessionId" = ${sessionId}
      AND status IN ('ACTIVE', 'STOP_REQUESTED', 'PURGE_REQUESTED')
      AND "leaseOwner" = ${workerId}
      AND generation = ${generation}
    RETURNING "sessionId"
  `;
}

export async function markSessionVoicePresenceGap(
  sessionId: string,
  workerId: string,
  generation: number,
  at: Date,
  db: typeof prisma = prisma,
) {
  return db.$queryRaw<{ sessionId: string }[]>`
    UPDATE "SessionVoicePresenceControl"
    SET "gapDetected" = true,
        "gapStartedAt" = CASE
          WHEN "gapDetected" AND "lastGapAt" IS NULL THEN COALESCE("gapStartedAt", "heartbeatAt", "leaseExpiresAt", ${at})
          ELSE COALESCE("heartbeatAt", "leaseExpiresAt", ${at})
        END,
        "lastGapAt" = NULL,
        "heartbeatAt" = ${at}
    WHERE "sessionId" = ${sessionId}
      AND "leaseOwner" = ${workerId}
      AND generation = ${generation}
      AND status IN ('ACTIVE', 'STOP_REQUESTED')
    RETURNING "sessionId"
  `;
}

/** Record the first fresh Gateway state after a gap; it never creates duration. */
export async function markSessionVoicePresenceGapRecovered(
  sessionId: string,
  workerId: string,
  generation: number,
  at: Date,
  db: typeof prisma = prisma,
) {
  return db.$queryRaw<{ sessionId: string }[]>`
    UPDATE "SessionVoicePresenceControl"
    SET "lastGapAt" = ${at}, "heartbeatAt" = ${at}
    WHERE "sessionId" = ${sessionId}
      AND "leaseOwner" = ${workerId}
      AND generation = ${generation}
      AND status IN ('ACTIVE', 'STOP_REQUESTED')
      AND "gapDetected" = true
      AND "lastGapAt" IS NULL
    RETURNING "sessionId"
  `;
}

export async function finalizeSessionVoicePresenceCommand(sessionId: string, db: typeof prisma = prisma) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "sessionId" FROM "SessionVoicePresenceControl" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
    const control = await tx.sessionVoicePresenceControl.findUnique({ where: { sessionId } });
    if (!control) return false;

    if (control.status === "PURGE_REQUESTED") {
      await tx.sessionVoicePresenceInterval.deleteMany({ where: { sessionId } });
      await tx.sessionVoicePresenceConsent.deleteMany({ where: { sessionId } });
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
    await tx.sessionVoicePresenceControl.update({
      where: { sessionId },
      data: { status: "FINALIZED", leaseOwner: null, leaseExpiresAt: null },
    });
    return true;
  });
}
