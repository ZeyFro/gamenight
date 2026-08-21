import { prisma } from "@/lib/prisma";
import { isAvailableAt } from "@/lib/availability";
import { sameUtcDate, wallClockNow } from "@/lib/wallclock";
import type { Game, User } from "@prisma/client";

/**
 * Clôture une session VOTING : le jeu gagnant est la proposition la plus
 * votée (égalité → la plus ancienne proposition, cf. tri par createdAt).
 * Sans proposition, la session est automatiquement annulée. Un seul jeu
 * gagnant par soirée — cohérent avec le champ unique `decidedGameId` du
 * schéma et avec le roadmap v2 (§7), qui traite la file de jeux multiples
 * comme un sujet à part entière.
 */
export async function closeSession(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      proposals: { include: { votes: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!session || session.status !== "VOTING") return;

  if (session.proposals.length === 0) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "CANCELLED" },
    });
    return;
  }

  const winner = session.proposals.reduce((best, proposal) =>
    proposal.votes.length > best.votes.length ? proposal : best
  );

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "SCHEDULED",
      decidedGameId: winner.gameId,
      decidedTime: session.date,
    },
  });
}

/** Clôture "auto" paresseuse : appelée à la lecture, pas de cron (F7). */
export async function closeSessionIfDue(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true },
  });
  if (!session || session.status !== "VOTING") return;
  if (session.date > wallClockNow()) return;
  await closeSession(sessionId);
}

export async function cancelSession(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "CANCELLED" },
  });
}

export async function markSessionDone(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, status: "SCHEDULED" },
    data: { status: "DONE" },
  });
}

export interface ProposalAvailability {
  owners: User[];
  availableOwners: User[];
  jouable: boolean;
}

/**
 * Pour une session et une liste de gameId proposés, calcule par jeu qui le
 * possède (UserGame.owned=true) et qui, parmi ces possesseurs, est dispo à
 * la date/heure de la session (WeeklyAvailability croisée avec
 * AvailabilityOverride). "Jouable" = nombre de dispos-possesseurs dans la
 * fourchette [minPlayers, maxPlayers] du jeu (spec §6 F5).
 */
export async function getProposalAvailability(
  sessionDate: Date,
  games: Pick<Game, "id" | "minPlayers" | "maxPlayers">[]
): Promise<Map<string, ProposalAvailability>> {
  const gameIds = games.map((g) => g.id);
  if (gameIds.length === 0) return new Map();

  const ownerRows = await prisma.userGame.findMany({
    where: { gameId: { in: gameIds }, owned: true },
    include: {
      user: {
        include: { weeklyAvailability: true, availabilityOverrides: true },
      },
    },
  });

  const result = new Map<string, ProposalAvailability>();

  for (const game of games) {
    const owners = ownerRows
      .filter((row) => row.gameId === game.id)
      .map((row) => row.user);

    const availableOwners = owners.filter((owner) => {
      const override = owner.availabilityOverrides.find((o) =>
        sameUtcDate(o.date, sessionDate)
      );
      return isAvailableAt(sessionDate, owner.weeklyAvailability, override);
    });

    const min = game.minPlayers ?? 1;
    const max = game.maxPlayers;
    const jouable =
      availableOwners.length >= min &&
      (max === null || availableOwners.length <= max);

    result.set(game.id, { owners, availableOwners, jouable });
  }

  return result;
}
