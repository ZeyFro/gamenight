import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkSessionsCreatedBadges } from "@/lib/badges";
import { announceRouletteCancelled, announceRouletteReminder, announceRouletteResult } from "@/lib/discord-roulette";
import { createRouletteResultSession } from "@/lib/sessions";
import { logger } from "@/lib/logger";
import type { Roulette } from "@prisma/client";

const REMINDER_BEFORE_DEADLINE_MS = 60 * 60 * 1000;

export function isRouletteProposalOpen(roulette: Pick<Roulette, "status" | "deadline">): boolean {
  return roulette.status === "OPEN" && wallClockNow() < roulette.deadline;
}

/**
 * Réclame atomiquement le droit de tirer une roulette — même mécanique que
 * `claimSessionClose` (src/lib/sessions.ts) : un seul `updateMany`
 * conditionné sur `status: "OPEN"`, dont Postgres garantit l'exécution
 * atomique. Évite un double tirage si le cron et un chargement de page
 * paresseux (`spinRouletteIfDue`, appelé depuis `/roulette/[id]`)
 * tombent sur la même roulette en même temps.
 */
async function claimRouletteSpin(rouletteId: string): Promise<boolean> {
  const result = await prisma.roulette.updateMany({
    where: { id: rouletteId, status: "OPEN" },
    data: { status: "SPINNING" },
  });
  return result.count === 1;
}

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
export async function spinRoulette(rouletteId: string): Promise<void> {
  if (!(await claimRouletteSpin(rouletteId))) return;

  const roulette = await prisma.roulette.findUniqueOrThrow({
    where: { id: rouletteId },
    include: { entries: true },
  });

  const participantIds = [...new Set(roulette.entries.map((e) => e.userId))];

  if (participantIds.length < 2) {
    await prisma.roulette.update({ where: { id: rouletteId }, data: { status: "DONE" } });
    await announceRouletteCancelled(roulette);
    logger.info("roulette", `Roulette ${rouletteId} annulée — moins de 2 participants.`);
    return;
  }

  const winnerEntry = roulette.entries[Math.floor(Math.random() * roulette.entries.length)];

  const { session, announceViaBot } = await createRouletteResultSession({
    date: roulette.scheduledAt,
    decidedGameId: winnerEntry.gameId,
    decidedTime: roulette.scheduledAt,
    createdById: roulette.createdById,
    notifiedUserIds: participantIds,
  });

  const proposal = await prisma.proposal.create({
    data: { sessionId: session.id, gameId: winnerEntry.gameId, proposedById: roulette.createdById },
  });
  await prisma.vote.createMany({
    data: participantIds.map((userId) => ({ proposalId: proposal.id, userId })),
  });

  await prisma.roulette.update({
    where: { id: rouletteId },
    data: { status: "DONE", resultGameId: winnerEntry.gameId, resultSessionId: session.id },
  });

  await awardXp(roulette.createdById, "CREATE_SESSION", session.id, XP_AMOUNTS.CREATE_SESSION);
  await checkSessionsCreatedBadges(roulette.createdById);

  // Jamais les deux transports à la fois — voir `createRouletteResultSession`
  // (l'enqueue bot a déjà réussi, atomiquement avec la création de la
  // session, si `announceViaBot` est vrai) et le commentaire de fichier de
  // `session-lifecycle.ts` (même garde pour `createSession`).
  if (!announceViaBot) {
    const game = await prisma.game.findUnique({
      where: { id: winnerEntry.gameId },
      select: { name: true, coverUrl: true },
    });
    await announceRouletteResult(
      roulette,
      game?.name ?? "?",
      game?.coverUrl ?? null,
      participantIds,
      session.id
    );
  }

  logger.info("roulette", `Roulette ${rouletteId} tirée — jeu gagnant ${winnerEntry.gameId}.`, { announceViaBot });
}

/** Déclenchement paresseux (chargement de page) — même contrat que `closeSessionIfDue`. */
export async function spinRouletteIfDue(rouletteId: string): Promise<void> {
  const roulette = await prisma.roulette.findUnique({
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
  const roulette = await prisma.roulette.findUnique({
    where: { id: rouletteId },
    include: { entries: { select: { userId: true } } },
  });
  if (!roulette || roulette.status !== "OPEN" || roulette.reminderSent) return;

  const now = wallClockNow();
  const reminderAt = new Date(roulette.deadline.getTime() - REMINDER_BEFORE_DEADLINE_MS);
  if (now < reminderAt || now >= roulette.deadline) return;

  const claimed = await prisma.roulette.updateMany({
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
  const openRoulettes = await prisma.roulette.findMany({
    where: { status: "OPEN" },
    select: { id: true },
  });

  for (const { id } of openRoulettes) {
    await sendRouletteReminderIfDue(id);
    await spinRouletteIfDue(id);
  }

  return { checked: openRoulettes.length };
}
