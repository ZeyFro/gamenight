import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getGamePlaytimeMinutes, getPlayerAchievements, STEAM_ACTIVITY_CALL_TIMEOUT_MS } from "@/lib/steam";
import { canReceiveChallengeReward } from "@/lib/tower-challenge-rules";
import { lockProgress, rewardedTowerCompletions, withTower } from "@/lib/tower-challenges";
import { enqueueTowerChallengeEvent } from "@/lib/tower-challenge-announcements";
import { enqueueTowerAutoValidationEvent, towerAutoSlot, towerSteamConfig } from "@/lib/tower-steam-announcements";
import {
  canReportDoubt, evaluateAchievements, evaluatePlaytime, isDoubtWindowOver, measureSummary,
  TOWER_MEASURE_BATCH_SIZE, TOWER_MEASURE_CHECK_INTERVAL_MS, TOWER_MEASURE_DOUBT_WINDOW_MS, type MeasureEvaluation, type MeasureKind,
} from "@/lib/tower-steam-measure-rules";

const now = () => new Date(Date.now());
const id = z.string().min(1).max(191).regex(/^[a-zA-Z0-9_-]+$/);
const snowflake = z.string().regex(/^[0-9]{16,20}$/);

export interface TowerSteamSummary {
  enabled: boolean;
  checked: number;
  baselined: number;
  achieved: number;
  credited: number;
  fallbackToVote: number;
  failed: number;
  steamCalls: number;
}
const emptySummary = (enabled: boolean): TowerSteamSummary => ({ enabled, checked: 0, baselined: 0, achieved: 0, credited: 0, fallbackToVote: 0, failed: 0, steamCalls: 0 });

type MeasuredRow = {
  id: string; communityId: string; userId: string; assignedAt: Date; expiresAt: Date;
  measureKind: MeasureKind; measureAppId: number; measureTarget: number; measureAchievement: string | null; measureBaseline: number | null;
  user: { steamId64: string | null };
};
type Reading = { kind: "PRIVATE" } | { kind: "VALUE"; evaluation: MeasureEvaluation; current: number };

/** Une lecture Steam pour une tentative. Un profil privé (ou sans compte lié) n'est pas une erreur : repli sur la preuve et le vote. */
async function readMeasure(row: MeasuredRow): Promise<Reading> {
  const steamId64 = row.user.steamId64;
  if (!steamId64) return { kind: "PRIVATE" };
  const signal = AbortSignal.timeout(STEAM_ACTIVITY_CALL_TIMEOUT_MS);
  if (row.measureKind === "STEAM_PLAYTIME") {
    const playtime = await getGamePlaytimeMinutes(steamId64, row.measureAppId, { signal });
    if (!playtime.ok) return { kind: "PRIVATE" };
    return { kind: "VALUE", current: playtime.minutes, evaluation: evaluatePlaytime({ baseline: row.measureBaseline, current: playtime.minutes, target: row.measureTarget }) };
  }
  const achievements = await getPlayerAchievements(steamId64, row.measureAppId, { signal });
  if (!achievements.ok) return { kind: "PRIVATE" };
  const evaluation = evaluateAchievements({ achievements: achievements.achievements, assignedAt: row.assignedAt, target: row.measureTarget, apiName: row.measureAchievement });
  return { kind: "VALUE", current: evaluation.state === "NEEDS_BASELINE" ? 0 : evaluation.value, evaluation };
}

function inScope<T>(communityId: string, work: (scopedDb: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(tx => work(scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false })));
}

/**
 * Valeur de départ du temps de jeu, relevée juste après l'attribution (best effort, appelée par le bouton « Mon défi »).
 * Si Steam ne répond pas, le cron prend la première lecture comme départ : le joueur n'est alors jamais avantagé.
 */
export async function captureTowerMeasureBaseline(input: unknown): Promise<"CAPTURED" | "SKIPPED" | "PRIVATE" | "ERROR"> {
  const parsed = z.object({ communityId: id, userId: id, attemptId: id }).safeParse(input);
  if (!parsed.success || !towerSteamConfig()) return "SKIPPED";
  const { communityId, userId, attemptId } = parsed.data;
  const row = await inScope(communityId, scopedDb => scopedDb.towerChallengeAttempt.findFirst({
    where: { id: attemptId, communityId, userId, status: "ASSIGNED", measureKind: "STEAM_PLAYTIME", measureBaseline: null },
    select: { id: true, communityId: true, userId: true, assignedAt: true, expiresAt: true, measureKind: true, measureAppId: true, measureTarget: true,
      measureAchievement: true, measureBaseline: true, user: { select: { steamId64: true } } },
  }));
  if (!row?.measureKind || row.measureAppId === null || row.measureTarget === null) return "SKIPPED";
  try {
    const reading = await readMeasure(row as MeasuredRow);
    if (reading.kind === "PRIVATE") {
      await saveReading(row.communityId, row.id, { measureStatus: "PRIVATE", measureCheckedAt: now() });
      return "PRIVATE";
    }
    await saveReading(row.communityId, row.id, { measureBaseline: reading.current, measureBaselineAt: now(), measureCheckedAt: now(), measureValue: 0 });
    return "CAPTURED";
  } catch (error) {
    logger.warn("tower:steam-mesure", "Départ de mesure non relevé, le cron le relèvera.", { attemptId, errorType: error instanceof Error ? error.name : "inconnue" });
    return "ERROR";
  }
}

async function saveReading(communityId: string, attemptId: string, data: Prisma.TowerChallengeAttemptUncheckedUpdateManyInput) {
  await inScope(communityId, scopedDb => scopedDb.towerChallengeAttempt.updateMany({
    where: { id: attemptId, communityId, status: "ASSIGNED", autoValidatedAt: null }, data,
  }));
}

/** Mesure atteinte : ouvre la fenêtre de doute et publie le message public ; les étages ne sont pas encore crédités. */
async function markAchieved(row: MeasuredRow, value: number) {
  return withTower({ communityId: row.communityId, userId: row.userId }, async scopedDb => {
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeAttempt" WHERE id = ${row.id} AND "communityId" = ${row.communityId} FOR UPDATE`;
    const current = now();
    const updated = await scopedDb.towerChallengeAttempt.updateMany({
      where: { id: row.id, communityId: row.communityId, status: "ASSIGNED", autoValidatedAt: null, expiresAt: { gt: current } },
      data: { autoValidatedAt: current, measureStatus: "ACHIEVED", measureValue: value, measureCheckedAt: current },
    });
    if (!updated.count) return false;
    await enqueueTowerAutoValidationEvent(scopedDb, row.communityId, row.id, "pending");
    return true;
  });
}

/** Crédit des étages une fois la fenêtre de doute écoulée sans signalement : même plafond quotidien que les autres réussites. */
async function creditAutoValidated(communityId: string, userId: string, attemptId: string) {
  return withTower({ communityId, userId }, async scopedDb => {
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeAttempt" WHERE id = ${attemptId} AND "communityId" = ${communityId} FOR UPDATE`;
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { id: attemptId, communityId, userId, status: "ASSIGNED", teamId: null, doubtReportedAt: null },
      select: { rewardFloors: true, autoValidatedAt: true, measureKind: true, measureTarget: true, measureAchievement: true, measureValue: true },
    });
    const current = now();
    if (!attempt?.autoValidatedAt || !attempt.measureKind || attempt.measureTarget === null || !isDoubtWindowOver(attempt.autoValidatedAt, current)) return "NOT_DUE" as const;
    const actor = { communityId, userId };
    await lockProgress(scopedDb, actor);
    if (!canReceiveChallengeReward(await rewardedTowerCompletions(scopedDb, actor, current), current)) return "DAILY_LIMIT" as const;
    await scopedDb.towerChallengeProgress.update({ where: { communityId_userId: actor }, data: { floorsClimbed: { increment: BigInt(attempt.rewardFloors) } } });
    await scopedDb.towerChallengeAttempt.update({
      where: { id: attemptId },
      data: { status: "APPROVED", rewardedAt: current, submittedAt: attempt.autoValidatedAt,
        proofText: measureSummary({ kind: attempt.measureKind, value: attempt.measureValue ?? 0, target: attempt.measureTarget, achievement: attempt.measureAchievement }) },
    });
    await enqueueTowerAutoValidationEvent(scopedDb, communityId, attemptId, "validated");
    return "CREDITED" as const;
  });
}

/**
 * Passage du cron : crédite les validations dont la fenêtre de doute est écoulée, puis relit les mesures Steam
 * (au plus TOWER_MEASURE_BATCH_SIZE appels, jamais plus d'une lecture par tentative toutes les 10 minutes).
 * Aucune IA : seulement des comparaisons de valeurs fournies par l'API Steam officielle.
 */
export async function runTowerSteamAutovalidation(deadline: Date): Promise<TowerSteamSummary> {
  const config = towerSteamConfig();
  const summary = emptySummary(Boolean(config));
  if (!config || !process.env.STEAM_API_KEY || Date.now() >= deadline.getTime()) return summary;
  const community = await prisma.community.findFirst({
    where: { discordGuildId: config.guildId, status: "ACTIVE", towerChallengesEnabled: true }, select: { id: true },
  });
  if (!community) return summary;
  const communityId = community.id;

  const due = await inScope(communityId, scopedDb => scopedDb.towerChallengeAttempt.findMany({
    where: { communityId, status: "ASSIGNED", teamId: null, doubtReportedAt: null, measureKind: { not: null },
      autoValidatedAt: { lte: new Date(Date.now() - TOWER_MEASURE_DOUBT_WINDOW_MS) } },
    orderBy: [{ autoValidatedAt: "asc" }, { id: "asc" }], take: TOWER_MEASURE_BATCH_SIZE, select: { id: true, userId: true, autoValidatedAt: true },
  }));
  for (const attempt of due) {
    if (Date.now() >= deadline.getTime()) return summary;
    if (!attempt.autoValidatedAt || !isDoubtWindowOver(attempt.autoValidatedAt, now())) continue;
    try {
      if (await creditAutoValidated(communityId, attempt.userId, attempt.id) === "CREDITED") summary.credited++;
    } catch (error) {
      summary.failed++;
      logger.error("tower:steam-credit", error, { attemptId: attempt.id });
    }
  }

  const current = now();
  const rows = await inScope(communityId, scopedDb => scopedDb.towerChallengeAttempt.findMany({
    where: { communityId, status: "ASSIGNED", teamId: null, measureKind: { not: null }, measureStatus: { not: "PRIVATE" }, autoValidatedAt: null,
      expiresAt: { gt: current },
      OR: [{ measureCheckedAt: null }, { measureCheckedAt: { lt: new Date(current.getTime() - TOWER_MEASURE_CHECK_INTERVAL_MS) } }] },
    orderBy: [{ measureCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }], take: TOWER_MEASURE_BATCH_SIZE,
    select: { id: true, communityId: true, userId: true, assignedAt: true, expiresAt: true, measureKind: true, measureAppId: true, measureTarget: true,
      measureAchievement: true, measureBaseline: true, user: { select: { steamId64: true } } },
  }));
  for (const candidate of rows) {
    if (Date.now() >= deadline.getTime()) break;
    if (!candidate.measureKind || candidate.measureAppId === null || candidate.measureTarget === null) continue;
    const row = candidate as MeasuredRow;
    summary.checked++;
    try {
      if (row.user.steamId64) summary.steamCalls++;
      const reading = await readMeasure(row);
      if (reading.kind === "PRIVATE") {
        // Profil Steam privé ou non lié : plus de lecture automatique, le joueur dépose une preuve et la communauté vote.
        await saveReading(communityId, row.id, { measureStatus: "PRIVATE", measureCheckedAt: now() });
        summary.fallbackToVote++;
      } else if (reading.evaluation.state === "NEEDS_BASELINE") {
        await saveReading(communityId, row.id, { measureBaseline: reading.current, measureBaselineAt: now(), measureCheckedAt: now(), measureValue: 0 });
        summary.baselined++;
      } else if (reading.evaluation.state === "ACHIEVED") {
        if (await markAchieved(row, reading.evaluation.value) === true) summary.achieved++;
        else await saveReading(communityId, row.id, { measureCheckedAt: now() });
      } else {
        await saveReading(communityId, row.id, { measureCheckedAt: now(), measureValue: reading.evaluation.value });
      }
    } catch (error) {
      summary.failed++;
      logger.error("tower:steam-mesure", error, { attemptId: row.id });
      // Recul : une erreur Steam ne doit pas faire relire la même tentative à chaque passage.
      await saveReading(communityId, row.id, { measureCheckedAt: now() });
    }
  }
  return summary;
}

const doubtSchema = z.object({ communityId: id, userId: id, attemptId: id, channelId: snowflake, messageId: snowflake });

/**
 * « Signaler un doute » : un membre éligible fait passer la validation automatique au vote communautaire.
 * Le défi redevient une preuve classique (message public « Preuve à juger », 3 votants minimum, majorité stricte).
 */
export async function reportTowerChallengeDoubt(input: unknown) {
  const parsed = doubtSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  const { communityId, userId, attemptId, channelId, messageId } = parsed.data;
  const config = towerSteamConfig();
  if (!config || channelId !== config.channelId) return { status: "UNAVAILABLE" } as const;
  return withTower({ communityId, userId }, async scopedDb => {
    await scopedDb.$queryRaw`SELECT id FROM "TowerChallengeAttempt" WHERE id = ${attemptId} AND "communityId" = ${communityId} FOR UPDATE`;
    const attempt = await scopedDb.towerChallengeAttempt.findFirst({
      where: { id: attemptId, communityId, status: "ASSIGNED", teamId: null, measureKind: { not: null } },
      select: { userId: true, autoValidatedAt: true, doubtReportedAt: true, measureKind: true, measureTarget: true, measureAchievement: true, measureValue: true },
    });
    if (!attempt?.measureKind || attempt.measureTarget === null) return { status: "UNAVAILABLE" } as const;
    const reporter = await scopedDb.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { status: true, joinedAt: true } });
    const current = now();
    const allowed = canReportDoubt({ authorId: attempt.userId, reporterId: userId, reporterStatus: reporter?.status, reporterJoinedAt: reporter?.joinedAt,
      autoValidatedAt: attempt.autoValidatedAt, doubtReportedAt: attempt.doubtReportedAt, now: current });
    if (!allowed.ok) return { status: allowed.reason } as const;
    // Le bouton doit appartenir au message public de CETTE tentative, jamais à un autre message du bot.
    const sent = await scopedDb.notificationDelivery.findFirst({
      where: { targetSlot: towerAutoSlot(config.guildId, attemptId), operation: "SEND", status: "SENT", discordMessageId: messageId }, select: { id: true },
    });
    if (!sent) return { status: "UNAVAILABLE" } as const;
    await scopedDb.towerChallengeAttempt.update({
      where: { id: attemptId },
      data: { status: "SUBMITTED", submittedAt: current, publicationConsent: false, doubtReportedAt: current, doubtReportedByUserId: userId,
        proofChannelId: channelId, proofMessageId: messageId,
        proofText: measureSummary({ kind: attempt.measureKind, value: attempt.measureValue ?? 0, target: attempt.measureTarget, achievement: attempt.measureAchievement }) },
    });
    await enqueueTowerAutoValidationEvent(scopedDb, communityId, attemptId, "doubt");
    await enqueueTowerChallengeEvent(scopedDb, communityId, attemptId, "proof");
    return { status: "DOUBT_RECORDED" } as const;
  });
}
