import { prisma } from "@/lib/prisma";
import { isAvailableAt } from "@/lib/availability";
import { sameUtcDate, wallClockNow } from "@/lib/wallclock";
import { announceSessionResult } from "@/lib/discord-announce";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import type { PostToDiscordResult } from "@/lib/discord";
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

export interface CloseSessionResult {
  discord: PostToDiscordResult;
}

/**
 * Clôture une session VOTING et poste le résultat dans Discord (F6).
 *
 * Le jeu gagnant est la proposition **jouable** (cf. `getProposalAvailability`)
 * la plus votée (égalité → la plus ancienne proposition, cf. tri par
 * createdAt). Sans proposition jouable — y compris s'il y a des
 * propositions mais qu'aucune n'a assez de joueurs dispos-possesseurs —
 * la session est annulée plutôt que planifiée avec un jeu injouable : on
 * revient ici sur le choix initial de F5 ("les votes restent souverains
 * même si pas jouable"), qui n'avait pas de conséquence visible ailleurs
 * que le badge ; poster un résultat Discord pour un jeu que personne ne
 * peut effectivement jouer serait trompeur pour le groupe.
 *
 * Un seul jeu gagnant par soirée — cohérent avec le champ unique
 * `decidedGameId` du schéma et avec le roadmap v2 (§7), qui traite la
 * file de jeux multiples comme un sujet à part entière.
 */
export async function closeSession(
  sessionId: string
): Promise<CloseSessionResult | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      proposals: {
        include: { game: true, votes: { include: { user: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!session || session.status !== "VOTING") return null;

  if (session.proposals.length === 0) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "CANCELLED" },
    });
    return { discord: await announceSessionResult(session, null, false) };
  }

  const availability = await getProposalAvailability(
    session.date,
    session.proposals.map((p) => p.game)
  );
  const jouableProposals = session.proposals.filter(
    (p) => availability.get(p.gameId)?.jouable
  );

  if (jouableProposals.length === 0) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: "CANCELLED" },
    });
    return { discord: await announceSessionResult(session, null, false) };
  }

  const winner = jouableProposals.reduce((best, proposal) =>
    proposal.votes.length > best.votes.length ? proposal : best
  );
  const tie =
    jouableProposals.filter((p) => p.votes.length === winner.votes.length)
      .length > 1;

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "SCHEDULED",
      decidedGameId: winner.gameId,
      decidedTime: session.date,
    },
  });

  // XP participation (Axe 1) — même définition de "présent" que celle
  // utilisée par l'écran de saisie des résultats (PR 3/9) : les users qui
  // ont voté pour la proposition gagnante. sourceId = session.id, un seul
  // crédit par session même si `closeSession` est rappelé (ne devrait pas
  // arriver, la session n'est plus VOTING après ce point, mais la
  // contrainte unique d'`awardXp` protège de toute façon).
  for (const vote of winner.votes) {
    await awardXp(vote.userId, "PARTICIPATE", sessionId, XP_AMOUNTS.PARTICIPATE);
  }

  return {
    discord: await announceSessionResult(session, winner, tie),
  };
}

/**
 * Clôture "auto" paresseuse : appelée à la lecture, pas de cron (F7).
 * Se déclenche dès que la deadline de vote (ou, à défaut, l'heure de la
 * session) est franchie. Le résultat Discord n'est pas remonté à un
 * utilisateur particulier ici (déclenché en arrière-plan par n'importe
 * quelle page chargée) : un échec est simplement loggué par
 * `postToDiscord`.
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

/** Bonus F6 : renvoyer l'annonce Discord d'une session déjà clôturée. */
export async function resendSessionAnnouncement(
  sessionId: string
): Promise<PostToDiscordResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      proposals: {
        include: { game: true, votes: { include: { user: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!session) return { ok: false, error: "session_introuvable" };

  if (session.status === "CANCELLED") {
    return announceSessionResult(session, null, false);
  }

  if (
    (session.status === "SCHEDULED" || session.status === "DONE") &&
    session.decidedGameId
  ) {
    const winner = session.proposals.find(
      (p) => p.gameId === session.decidedGameId
    );
    if (!winner) return { ok: false, error: "gagnant_introuvable" };

    const maxVotes = Math.max(
      ...session.proposals.map((p) => p.votes.length)
    );
    const tie =
      winner.votes.length === maxVotes &&
      session.proposals.filter((p) => p.votes.length === maxVotes).length > 1;

    return announceSessionResult(session, winner, tie);
  }

  return { ok: false, error: "session_pas_encore_cloturee" };
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
