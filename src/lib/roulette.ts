import { scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { cronCommunityScope, communityMemberUserWhere } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkSessionsCreatedBadges } from "@/lib/badges";
import { announceRouletteCancelled, announceRouletteReminder, announceRouletteResult } from "@/lib/discord-roulette";
import { enqueueRouletteDirectMessageEdits } from "@/lib/roulette-dm";
import { createRouletteResultSession } from "@/lib/sessions";
import { logger } from "@/lib/logger";
import { isRoulettePlayerFilterEnabled, pickRouletteCandidate } from "@/lib/roulette-draw";
import type { Prisma, Roulette } from "@prisma/client";

const REMINDER_BEFORE_DEADLINE_MS = 60 * 60 * 1000;

export function isRouletteProposalOpen(roulette: Pick<Roulette, "status" | "deadline">): boolean {
  return roulette.status === "OPEN" && wallClockNow() < roulette.deadline;
}

/**
 * Le verrou de ligne sérialise cron et chargement paresseux ; le tirage,
 * la soirée et les intentions de livraison partagent la transaction.
 */

/**
 * Calcule le gagnant et crée la session — même invariant final que le
 * mode instant (`createSessionFromRouletteAction`, src/app/roulette/actions.ts) :
 * `Session` directement `SCHEDULED` avec `decidedGameId` déjà posé, PLUS
 * un `Proposal`/`Vote` par participant ayant réellement proposé (jamais
 * les invités qui n'ont rien proposé) — ça fait fonctionner sans aucune
 * modification tout ce qui lit "les votants du jeu gagnant" ailleurs.
 *
 * Moins de 2 participants distincts ayant proposé → annulation silencieuse
 * (`status: DONE`, `resultGameId: null`), même philosophie que "0 votant"
 * sur une session classique (`closeSession`).
 */
export async function spinRoulette(
  rouletteId: string,
  rng: () => number = Math.random
): Promise<{ playerFilterFallback: boolean } | null> {
  const scope = await cronCommunityScope();
  const outcome = await prisma.$transaction(async (tx) => {
    const scopedDb = scopedTransactionPrisma(tx, scope);
    // Le tirage, sa soirée et les éditions sont un seul commit. Un crash ne
    // laisse plus SPINNING sans résultat ; concurrence cron/page sérialisée.
    await tx.$queryRaw`SELECT id FROM "Roulette" WHERE id = ${rouletteId} FOR UPDATE`;
    const roulette = await scopedDb.roulette.findUnique({ where: { id: rouletteId }, include: { entries: { include: { game: { select: { minPlayers: true, maxPlayers: true } } } } } });
    if (!roulette || roulette.status !== "OPEN") return null;
    const { entries, participantIds } = await eligibleRouletteEntries(tx, roulette);
    if (participantIds.length < 2) {
      await scopedDb.roulette.update({ where: { id: rouletteId }, data: { status: "DONE" } });
      await enqueueRouletteDirectMessageEdits(rouletteId, tx);
      return { roulette, result: null, participantIds, fallback: false };
    }
    const { chosen: winner, fallback } = pickRouletteCandidate(
      entries.map((e) => ({ ...e, ...e.game })),
      { playerCount: participantIds.length, filterEnabled: isRoulettePlayerFilterEnabled(), rng }
    );
    if (!winner) throw new Error("spinRoulette : aucune entrée à tirer.");
    const result = await createRouletteResultSession({
      transaction: tx, creationKey: `roulette-result-${rouletteId}`, sourceRouletteId: rouletteId,
      communityId: roulette.communityId, date: roulette.scheduledAt,
      decidedGameId: winner.gameId, decidedTime: roulette.scheduledAt,
      createdById: roulette.createdById, notifiedUserIds: participantIds,
    });
    await scopedDb.roulette.update({ where: { id: rouletteId }, data: { status: "DONE", resultGameId: result.session.decidedGameId, resultSessionId: result.session.id } });
    await enqueueRouletteDirectMessageEdits(rouletteId, tx);
    return { roulette, result, participantIds, fallback };
  }, { timeout: 15_000 });
  if (!outcome) return null;
  const { roulette, result, participantIds, fallback } = outcome;
  if (!result) { await announceRouletteCancelled(roulette); return { playerFilterFallback: false }; }
  await awardXp(roulette.createdById, roulette.communityId, "CREATE_SESSION", result.session.id, XP_AMOUNTS.CREATE_SESSION);
  await checkSessionsCreatedBadges(roulette.createdById, roulette.communityId);
  if (!result.announceViaBot && !result.replayed) {
    const game = await prisma.game.findUnique({ where: { id: result.session.decidedGameId! }, select: { name: true, coverUrl: true } });
    await announceRouletteResult(roulette, game?.name ?? "?", game?.coverUrl ?? null, participantIds, result.session.id);
  }
  logger.info("roulette", "Roulette tirée.", { rouletteId, announceViaBot: result.announceViaBot, playerFilterFallback: fallback });
  return { playerFilterFallback: fallback };
}

/** Entrées des participants encore membres de la communauté de la roulette (isolation) et leurs ids distincts. */
export async function eligibleRouletteEntries<E extends { userId: string }>(
  tx: Prisma.TransactionClient,
  roulette: { communityId: string | null; entries: E[] }
): Promise<{ entries: E[]; participantIds: string[] }> {
  const members = await tx.user.findMany({
    where: { id: { in: roulette.entries.map((e) => e.userId) }, ...(await communityMemberUserWhere(roulette.communityId)) }, select: { id: true },
  });
  const eligible = new Set(members.map((m) => m.id));
  const entries = roulette.entries.filter((e) => eligible.has(e.userId));
  return { entries, participantIds: [...new Set(entries.map((e) => e.userId))] };
}

/** Déclenchement paresseux (chargement de page) — même contrat que `closeSessionIfDue`. */
export async function spinRouletteIfDue(rouletteId: string): Promise<void> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const roulette = await scopedDb.roulette.findUnique({
    where: { id: rouletteId },
    select: { status: true, deadline: true },
  });
  if (!roulette || roulette.status !== "OPEN") return;
  if (roulette.deadline > wallClockNow()) return;
  await spinRoulette(rouletteId);
}

/**
 * Rappel Discord (deadline − 1h) aux participants invités qui n'ont pas
 * encore proposé leurs 2 jeux. `reminderSent` réclamé atomiquement (même
 * mécanique que le tirage ci-dessus) pour n'envoyer le rappel qu'une seule
 * fois, quel que soit le nombre de déclenchements concurrents (cron +
 * pages ouvertes).
 */
export async function sendRouletteReminderIfDue(rouletteId: string): Promise<void> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const roulette = await scopedDb.roulette.findUnique({
    where: { id: rouletteId },
    include: { entries: { select: { userId: true } } },
  });
  if (!roulette || roulette.status !== "OPEN" || roulette.reminderSent) return;

  const now = wallClockNow();
  const reminderAt = new Date(roulette.deadline.getTime() - REMINDER_BEFORE_DEADLINE_MS);
  if (now < reminderAt || now >= roulette.deadline) return;

  const claimed = await scopedDb.roulette.updateMany({
    where: { id: rouletteId, reminderSent: false },
    data: { reminderSent: true },
  });
  if (claimed.count !== 1) return;

  const invited = resolveNotifiedUserIds(roulette.notifiedUserIds) ?? [];
  const proposedCounts = new Map<string, number>();
  for (const e of roulette.entries) {
    proposedCounts.set(e.userId, (proposedCounts.get(e.userId) ?? 0) + 1);
  }
  const missingIds = invited.filter((id) => (proposedCounts.get(id) ?? 0) < 2);

  if (missingIds.length > 0) {
    await announceRouletteReminder(roulette, missingIds);
  }
}

/** Traite toutes les roulettes `OPEN` — rappel puis tirage si dû, dans cet ordre (cf. cron `/api/cron/close-sessions`). */
export async function processOpenRoulettes(): Promise<{ checked: number }> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const openRoulettes = await scopedDb.roulette.findMany({
    where: { status: "OPEN" },
    select: { id: true },
  });

  for (const { id } of openRoulettes) {
    await sendRouletteReminderIfDue(id);
    await spinRouletteIfDue(id);
  }

  return { checked: openRoulettes.length };
}
