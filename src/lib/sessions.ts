import { prisma } from "@/lib/prisma";
import { isAvailableAt } from "@/lib/availability";
import { sameUtcDate, wallClockNow } from "@/lib/wallclock";
import type { Game, Session, User } from "@prisma/client";

/**
 * Le vote ferme à `votingDeadline` si elle est définie, sinon à l'heure de
 * la session (comportement historique, pour les sessions créées avant
 * l'ajout de la deadline).
 */
export function votingClosesAt(
  session: Pick<Session, "date" | "votingDeadline">
): Date {
  return session.votingDeadline ?? session.date;
}

export function isVotingOpen(
  session: Pick<Session, "status" | "date" | "votingDeadline">
): boolean {
  return (
    session.status === "VOTING" && wallClockNow() < votingClosesAt(session)
  );
}

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

/**
 * Clôture "auto" paresseuse : appelée à la lecture, pas de cron (F7).
 * Se déclenche dès que la deadline de vote (ou, à défaut, l'heure de la
 * session) est franchie.
 */
export async function closeSessionIfDue(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true, votingDeadline: true },
  });
  if (!session || session.status !== "VOTING") return;
  if (votingClosesAt(session) > wallClockNow()) return;
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

    // 2 par défaut si non renseigné (cohérent avec l'ajout manuel et
    // l'import Steam) — évite qu'un jeu importé sans minPlayers connu
    // (ex. Steam avant enrichissement) s'affiche comme jouable à 1 joueur.
    const min = game.minPlayers ?? 2;
    const max = game.maxPlayers;
    const jouable =
      availableOwners.length >= min &&
      (max === null || availableOwners.length <= max);

    result.set(game.id, { owners, availableOwners, jouable });
  }

  return result;
}
