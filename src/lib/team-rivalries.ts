import { getScopedPrisma } from "@/lib/community-scoped-client";
import { isMemberOfCommunity } from "@/lib/community-isolation";
import { getCommunityTeamsCommunityId } from "@/lib/community-teams";
import { createNotification } from "@/lib/notifications";
import {
  CHALLENGE_PROPOSAL_TTL_MS,
  OPEN_STATUSES,
  captainIdOf,
  challengeInputSchema,
  computeRecord,
  confirmDecision,
  outcomeSchema,
  proposalDecision,
  reportDecision,
  respondDecision,
  teamRivalriesEnabled,
  type ChallengeOutcome,
} from "@/lib/team-rivalries-rules";

/**
 * Rivalités entre équipes (flag `TEAM_RIVALRIES_ENABLED`). Seuls les capitaines agissent : le capitaine d'une
 * équipe propose, le capitaine adverse accepte ou refuse ; le résultat est déclaré par un capitaine puis
 * confirmé par l'autre (contestation : le résultat est rejeté et peut être redéclaré). Notifications
 * in-app seulement ; aucun Discord, aucun XP, aucun étage.
 */
export type RivalryResult = { ok: true } | { ok: false; reason: string };

export async function getRivalriesCommunityId(userId: string): Promise<string | null> {
  if (!teamRivalriesEnabled()) return null;
  return getCommunityTeamsCommunityId(userId);
}

async function loadTeam(scopedDb: Awaited<ReturnType<typeof getScopedPrisma>>, communityId: string, teamId: string) {
  return scopedDb.communityTeam.findFirst({ where: { id: teamId, communityId }, select: { id: true, name: true, createdById: true, captainId: true } });
}

async function isCaptain(userId: string, communityId: string, team: { captainId: string | null; createdById: string }): Promise<boolean> {
  return captainIdOf(team) === userId && (await isMemberOfCommunity(userId, communityId));
}

export async function proposeChallenge(
  userId: string,
  communityId: string,
  raw: { challengerTeamId: unknown; opponentTeamId: unknown; gameName?: unknown; message?: unknown },
  now: Date = new Date(),
): Promise<RivalryResult> {
  if (!teamRivalriesEnabled()) return { ok: false, reason: "disabled" };
  const parsed = challengeInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const { challengerTeamId, opponentTeamId, gameName, message } = parsed.data;
  const scopedDb = await getScopedPrisma(userId);
  const [challenger, opponent] = await Promise.all([loadTeam(scopedDb, communityId, challengerTeamId), loadTeam(scopedDb, communityId, opponentTeamId)]);
  if (!challenger || !opponent) return { ok: false, reason: "missing" };
  if (!(await isCaptain(userId, communityId, challenger))) return { ok: false, reason: "forbidden" };
  const [pairOpen, openForChallenger, openForOpponent] = await Promise.all([
    scopedDb.teamChallenge.count({
      where: {
        communityId, status: { in: [...OPEN_STATUSES] },
        OR: [{ challengerTeamId, opponentTeamId }, { challengerTeamId: opponentTeamId, opponentTeamId: challengerTeamId }],
      },
    }),
    scopedDb.teamChallenge.count({ where: { communityId, status: { in: [...OPEN_STATUSES] }, OR: [{ challengerTeamId }, { opponentTeamId: challengerTeamId }] } }),
    scopedDb.teamChallenge.count({ where: { communityId, status: { in: [...OPEN_STATUSES] }, OR: [{ challengerTeamId: opponentTeamId }, { opponentTeamId }] } }),
  ]);
  const verdict = proposalDecision({ challengerTeamId, opponentTeamId, pairHasOpenChallenge: pairOpen > 0, openForChallenger, openForOpponent });
  if (verdict !== "ok") return { ok: false, reason: verdict };
  await scopedDb.teamChallenge.create({
    data: {
      communityId, challengerTeamId, opponentTeamId, proposedById: userId,
      gameName: gameName ?? null, message: message ?? null, expiresAt: new Date(now.getTime() + CHALLENGE_PROPOSAL_TTL_MS),
    },
  });
  await createNotification({ communityId, userId: captainIdOf(opponent), type: "REMINDER", title: "Défi d'une autre équipe", message: `${challenger.name} défie ${opponent.name}. Réponds depuis la fiche de ton équipe.` });
  return { ok: true };
}

async function loadChallenge(scopedDb: Awaited<ReturnType<typeof getScopedPrisma>>, communityId: string, challengeId: string) {
  return scopedDb.teamChallenge.findFirst({
    where: { id: challengeId, communityId },
    select: {
      id: true, status: true, expiresAt: true, challengerTeamId: true, opponentTeamId: true, reportedByTeamId: true, reportedOutcome: true,
      challengerTeam: { select: { id: true, name: true, createdById: true, captainId: true } },
      opponentTeam: { select: { id: true, name: true, createdById: true, captainId: true } },
    },
  });
}

/** Le capitaine ADVERSE accepte ou refuse ; le proposant ne peut jamais accepter son propre défi. */
export async function respondToChallenge(userId: string, communityId: string, challengeId: string, decision: "ACCEPT" | "DECLINE", now: Date = new Date()): Promise<RivalryResult> {
  if (!teamRivalriesEnabled()) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(userId);
  const challenge = await loadChallenge(scopedDb, communityId, challengeId);
  if (!challenge) return { ok: false, reason: "missing" };
  if (!(await isCaptain(userId, communityId, challenge.opponentTeam))) return { ok: false, reason: "forbidden" };
  const verdict = respondDecision(challenge, now);
  if (verdict !== "ok") return { ok: false, reason: verdict };
  const updated = await scopedDb.teamChallenge.updateMany({
    where: { id: challenge.id, status: "PROPOSED", expiresAt: { gt: now } },
    data: { status: decision === "ACCEPT" ? "ACCEPTED" : "DECLINED", respondedAt: now, respondedById: userId },
  });
  if (updated.count !== 1) return { ok: false, reason: "not_proposed" };
  await createNotification({
    communityId, userId: captainIdOf(challenge.challengerTeam), type: "REMINDER",
    title: decision === "ACCEPT" ? "Défi accepté" : "Défi refusé",
    message: `${challenge.opponentTeam.name} a ${decision === "ACCEPT" ? "accepté" : "refusé"} le défi de ${challenge.challengerTeam.name}.`,
  });
  return { ok: true };
}

/** Annulation par le capitaine de l'équipe qui a proposé, avant tout résultat déclaré. */
export async function cancelChallenge(userId: string, communityId: string, challengeId: string): Promise<RivalryResult> {
  if (!teamRivalriesEnabled()) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(userId);
  const challenge = await loadChallenge(scopedDb, communityId, challengeId);
  if (!challenge) return { ok: false, reason: "missing" };
  if (!(await isCaptain(userId, communityId, challenge.challengerTeam))) return { ok: false, reason: "forbidden" };
  const updated = await scopedDb.teamChallenge.updateMany({ where: { id: challenge.id, status: { in: ["PROPOSED", "ACCEPTED"] } }, data: { status: "CANCELLED" } });
  return updated.count === 1 ? { ok: true } : { ok: false, reason: "not_cancellable" };
}

/** Un capitaine (des deux équipes) déclare le résultat d'un défi accepté ; il reste à confirmer par l'autre. */
export async function reportChallengeResult(userId: string, communityId: string, challengeId: string, rawOutcome: unknown, now: Date = new Date()): Promise<RivalryResult> {
  if (!teamRivalriesEnabled()) return { ok: false, reason: "disabled" };
  const outcome = outcomeSchema.safeParse(rawOutcome);
  if (!outcome.success) return { ok: false, reason: "invalid" };
  const scopedDb = await getScopedPrisma(userId);
  const challenge = await loadChallenge(scopedDb, communityId, challengeId);
  if (!challenge) return { ok: false, reason: "missing" };
  const asChallenger = await isCaptain(userId, communityId, challenge.challengerTeam);
  const asOpponent = !asChallenger && (await isCaptain(userId, communityId, challenge.opponentTeam));
  if (!asChallenger && !asOpponent) return { ok: false, reason: "forbidden" };
  if (reportDecision(challenge) !== "ok") return { ok: false, reason: "not_accepted" };
  const reporterTeam = asChallenger ? challenge.challengerTeam : challenge.opponentTeam;
  const otherTeam = asChallenger ? challenge.opponentTeam : challenge.challengerTeam;
  const updated = await scopedDb.teamChallenge.updateMany({
    where: { id: challenge.id, status: "ACCEPTED" },
    data: { status: "RESULT_REPORTED", reportedOutcome: outcome.data as ChallengeOutcome, reportedByTeamId: reporterTeam.id, reportedById: userId, reportedAt: now },
  });
  if (updated.count !== 1) return { ok: false, reason: "not_accepted" };
  await createNotification({ communityId, userId: captainIdOf(otherTeam), type: "REMINDER", title: "Résultat à confirmer", message: `${reporterTeam.name} a déclaré le résultat de votre défi. Confirme-le ou conteste-le.` });
  return { ok: true };
}

/** Le capitaine de l'autre équipe confirme (défi terminé) ou conteste (résultat rejeté, à redéclarer). */
export async function answerChallengeResult(userId: string, communityId: string, challengeId: string, answer: "CONFIRM" | "DISPUTE", now: Date = new Date()): Promise<RivalryResult> {
  if (!teamRivalriesEnabled()) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(userId);
  const challenge = await loadChallenge(scopedDb, communityId, challengeId);
  if (!challenge) return { ok: false, reason: "missing" };
  const asChallenger = await isCaptain(userId, communityId, challenge.challengerTeam);
  const asOpponent = !asChallenger && (await isCaptain(userId, communityId, challenge.opponentTeam));
  if (!asChallenger && !asOpponent) return { ok: false, reason: "forbidden" };
  const actorTeam = asChallenger ? challenge.challengerTeam : challenge.opponentTeam;
  const reporterTeam = asChallenger ? challenge.opponentTeam : challenge.challengerTeam;
  const verdict = confirmDecision(challenge, actorTeam.id);
  if (verdict !== "ok") return { ok: false, reason: verdict };
  if (answer === "CONFIRM") {
    const updated = await scopedDb.teamChallenge.updateMany({
      where: { id: challenge.id, status: "RESULT_REPORTED", reportedByTeamId: { not: actorTeam.id } },
      data: { status: "COMPLETED", outcome: challenge.reportedOutcome, completedAt: now },
    });
    if (updated.count !== 1) return { ok: false, reason: "not_reported" };
  } else {
    const updated = await scopedDb.teamChallenge.updateMany({
      where: { id: challenge.id, status: "RESULT_REPORTED", reportedByTeamId: { not: actorTeam.id } },
      data: { status: "ACCEPTED", reportedOutcome: null, reportedByTeamId: null, reportedById: null, reportedAt: null, disputeCount: { increment: 1 } },
    });
    if (updated.count !== 1) return { ok: false, reason: "not_reported" };
  }
  await createNotification({
    communityId, userId: captainIdOf(reporterTeam), type: "REMINDER",
    title: answer === "CONFIRM" ? "Résultat confirmé" : "Résultat contesté",
    message: answer === "CONFIRM" ? `${actorTeam.name} a confirmé le résultat du défi.` : `${actorTeam.name} conteste le résultat : déclarez-le à nouveau d'un commun accord.`,
  });
  return { ok: true };
}

export interface TeamRivalryView {
  team: { id: string; name: string };
  isCaptain: boolean;
  record: { played: number; wins: number; losses: number; draws: number };
  opponents: Array<{ id: string; name: string }>;
  history: Array<{
    id: string; status: string; outcome: string | null; reportedOutcome: string | null; gameName: string | null; message: string | null;
    createdAt: Date; completedAt: Date | null; role: "challenger" | "opponent"; opponentName: string; opponentTeamId: string;
    reportedByMe: boolean; disputeCount: number; canRespond: boolean; canCancel: boolean; canReport: boolean; canAnswer: boolean;
  }>;
}

/** Fiche de rivalités d'une équipe : bilan confirmé, historique, actions possibles pour le lecteur. */
export async function getTeamRivalries(userId: string, communityId: string, teamId: string, now: Date = new Date()): Promise<TeamRivalryView | null> {
  if (!teamRivalriesEnabled()) return null;
  const scopedDb = await getScopedPrisma(userId);
  const team = await loadTeam(scopedDb, communityId, teamId);
  if (!team) return null;
  // Propositions échues : fermées à la lecture (aucun cron dédié).
  await scopedDb.teamChallenge.updateMany({
    where: { communityId, status: "PROPOSED", expiresAt: { lte: now }, OR: [{ challengerTeamId: teamId }, { opponentTeamId: teamId }] },
    data: { status: "EXPIRED" },
  });
  const rows = await scopedDb.teamChallenge.findMany({
    where: { communityId, OR: [{ challengerTeamId: teamId }, { opponentTeamId: teamId }] },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, status: true, outcome: true, reportedOutcome: true, reportedByTeamId: true, gameName: true, message: true, createdAt: true, completedAt: true,
      disputeCount: true, challengerTeamId: true, opponentTeamId: true,
      challengerTeam: { select: { id: true, name: true } }, opponentTeam: { select: { id: true, name: true } },
    },
  });
  const viewerIsCaptain = await isCaptain(userId, communityId, team);
  const others = await scopedDb.communityTeam.findMany({ where: { communityId, id: { not: teamId }, members: { some: {} } }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } });
  return {
    team: { id: team.id, name: team.name },
    isCaptain: viewerIsCaptain,
    record: computeRecord(rows.map((row) => ({ status: row.status, outcome: row.outcome, challengerTeamId: row.challengerTeamId, opponentTeamId: row.opponentTeamId })), teamId),
    opponents: others,
    history: rows.map((row) => {
      const role = row.challengerTeamId === teamId ? "challenger" : "opponent";
      const opponent = role === "challenger" ? row.opponentTeam : row.challengerTeam;
      const reportedByMe = row.reportedByTeamId === teamId;
      return {
        id: row.id, status: row.status, outcome: row.outcome, reportedOutcome: row.reportedOutcome, gameName: row.gameName, message: row.message,
        createdAt: row.createdAt, completedAt: row.completedAt, role, opponentName: opponent.name, opponentTeamId: opponent.id,
        reportedByMe, disputeCount: row.disputeCount,
        canRespond: viewerIsCaptain && role === "opponent" && row.status === "PROPOSED",
        canCancel: viewerIsCaptain && role === "challenger" && (row.status === "PROPOSED" || row.status === "ACCEPTED"),
        canReport: viewerIsCaptain && row.status === "ACCEPTED",
        canAnswer: viewerIsCaptain && row.status === "RESULT_REPORTED" && !reportedByMe,
      };
    }),
  };
}
