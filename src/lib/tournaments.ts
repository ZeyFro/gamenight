import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkTournamentBadges } from "@/lib/badges";
import { postToDiscord, ACCENT_COLOR } from "@/lib/discord";
import { logger } from "@/lib/logger";

/**
 * Sprint 5 (FEATURE 1, Tournois Bracket) — taille de bracket réelle pour
 * un `maxPlayers` donné (limité à {4, 6, 8} côté formulaire) : prochaine
 * puissance de 2 ≥ maxPlayers. 6 joueurs tournent donc sur une structure
 * à 8 slots avec 2 "byes" (slots vides résolus immédiatement au tirage).
 */
export function bracketSizeFor(maxPlayers: number): number {
  let size = 1;
  while (size < maxPlayers) size *= 2;
  return size;
}

/** Nombre de rounds pour une taille de bracket donnée (4 → 2, 8 → 3). */
export function totalRoundsFor(bracketSize: number): number {
  return Math.log2(bracketSize);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Fait avancer le gagnant d'un match vers le match du round suivant
 * (`nextRound = round + 1`, `nextPosition = floor(position / 2)`, posé
 * en `player1` si `position` est pair, `player2` sinon) — TOUS les
 * matchs de tous les rounds existent déjà dès `generateBracket` (créés
 * avec des joueurs `null`), cette fonction ne fait que les remplir au
 * fur et à mesure. Si `nextRound` n'existe pas, `round` était la finale
 * → `finalizeTournament`.
 */
async function advanceWinner(
  tournamentId: string,
  round: number,
  position: number,
  winnerId: string,
  totalRounds: number
): Promise<void> {
  if (round >= totalRounds) {
    await finalizeTournament(tournamentId, winnerId);
    return;
  }

  const nextRound = round + 1;
  const nextPosition = Math.floor(position / 2);
  const field = position % 2 === 0 ? "player1Id" : "player2Id";

  await prisma.tournamentMatch.update({
    where: { tournamentId_round_position: { tournamentId, round: nextRound, position: nextPosition } },
    data: { [field]: winnerId },
  });
}

/**
 * Génère le bracket complet au lancement d'un tournoi (inscriptions
 * pleines, ou le créateur clique "Lancer maintenant") : seed aléatoire
 * (pas de classement XP, cf. spec), création de TOUS les matchs de TOUS
 * les rounds d'un coup (round 1 avec les joueurs tirés, les suivants
 * avec des slots vides à remplir plus tard), résolution immédiate des
 * "byes" (moins de participants que de slots — le joueur seul avance
 * sans jouer).
 */
export async function generateBracket(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { participants: true },
  });
  if (!tournament || tournament.status !== "REGISTRATION") return;

  const bracketSize = bracketSizeFor(tournament.maxPlayers);
  const totalRounds = totalRoundsFor(bracketSize);
  const matchCount = bracketSize / 2;
  // Lancement anticipé (avant que toutes les places soient prises) avec
  // trop peu de participants pour remplir au moins un joueur par match —
  // no-op plutôt qu'un bracket avec des matchs entièrement vides.
  if (tournament.participants.length < matchCount) return;

  const shuffled = shuffle(tournament.participants);

  await Promise.all(
    shuffled.map((p, i) =>
      prisma.tournamentParticipant.update({ where: { id: p.id }, data: { seed: i + 1 } })
    )
  );

  // Remplit d'abord TOUS les `player1` (garanti par le garde-fou
  // ci-dessus), puis les `player2` dans la limite des participants
  // restants — répartit les "byes" sur plusieurs matchs plutôt que de les
  // regrouper en fin de liste (qui viderait complètement les derniers
  // matchs, ex. 6 joueurs sur un bracket à 8 slots avec un remplissage
  // séquentiel naïf).
  const round1Matches: { position: number; player1Id: string | null; player2Id: string | null }[] =
    [];
  for (let i = 0; i < matchCount; i++) {
    const player1 = shuffled[i]?.userId ?? null;
    const player2Index = matchCount + i;
    const player2 = shuffled[player2Index]?.userId ?? null;
    round1Matches.push({ position: i, player1Id: player1, player2Id: player2 });
  }

  await prisma.tournamentMatch.createMany({
    data: round1Matches.map((m) => ({
      tournamentId,
      round: 1,
      position: m.position,
      player1Id: m.player1Id,
      player2Id: m.player2Id,
    })),
  });

  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = bracketSize / 2 ** round;
    await prisma.tournamentMatch.createMany({
      data: Array.from({ length: matchesInRound }, (_, position) => ({
        tournamentId,
        round,
        position,
      })),
    });
  }

  await prisma.tournament.update({ where: { id: tournamentId }, data: { status: "IN_PROGRESS" } });

  // Byes : un seul joueur sur les deux slots du match → avance sans jouer,
  // résolu immédiatement (jamais affiché comme un vrai match à jouer côté UI).
  for (const m of round1Matches) {
    const winner =
      m.player1Id && !m.player2Id ? m.player1Id : !m.player1Id && m.player2Id ? m.player2Id : null;
    if (!winner) continue;
    await prisma.tournamentMatch.update({
      where: { tournamentId_round_position: { tournamentId, round: 1, position: m.position } },
      data: { winnerId: winner, completedAt: wallClockNow() },
    });
    await advanceWinner(tournamentId, 1, m.position, winner, totalRounds);
  }
}

/** Home ("🏆 Tournoi en cours", cf. spec) — le tournoi actif le plus récent, tous statuts hors `DONE`. */
export async function getActiveTournament(): Promise<{ id: string; name: string; gameName: string } | null> {
  const tournament = await prisma.tournament.findFirst({
    where: { status: { in: ["REGISTRATION", "IN_PROGRESS"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, game: { select: { name: true } } },
  });
  return tournament ? { id: tournament.id, name: tournament.name, gameName: tournament.game.name } : null;
}

export interface DeclareWinnerResult {
  ok: boolean;
  tournamentDone: boolean;
}

/**
 * Déclare le vainqueur d'un match — réservé au créateur du tournoi ou à
 * l'un des deux joueurs du match (cf. spec). Marque le perdant "éliminé"
 * (`TournamentParticipant.eliminatedAt`, purement informatif pour
 * l'affichage) et fait avancer le gagnant au round suivant.
 */
export async function declareWinner(
  matchId: string,
  winnerId: string,
  actorUserId: string
): Promise<DeclareWinnerResult> {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    include: { tournament: true },
  });
  if (!match || match.tournament.status !== "IN_PROGRESS") return { ok: false, tournamentDone: false };
  if (match.completedAt) return { ok: false, tournamentDone: false };
  if (winnerId !== match.player1Id && winnerId !== match.player2Id) {
    return { ok: false, tournamentDone: false };
  }

  const isCreator = match.tournament.createdById === actorUserId;
  const isPlayer = actorUserId === match.player1Id || actorUserId === match.player2Id;
  if (!isCreator && !isPlayer) return { ok: false, tournamentDone: false };

  const loserId = winnerId === match.player1Id ? match.player2Id : match.player1Id;

  await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: { winnerId, completedAt: wallClockNow() },
  });
  if (loserId) {
    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId: match.tournamentId, userId: loserId },
      data: { eliminatedAt: wallClockNow() },
    });
  }

  const totalRounds = totalRoundsFor(bracketSizeFor(match.tournament.maxPlayers));
  await advanceWinner(match.tournamentId, match.round, match.position, winnerId, totalRounds);

  const updated = await prisma.tournament.findUnique({
    where: { id: match.tournamentId },
    select: { status: true },
  });

  return { ok: true, tournamentDone: updated?.status === "DONE" };
}

/**
 * Clôture le tournoi : XP (1er 200, 2e 100, demi-finalistes 50 chacun —
 * les perdants du round juste avant la finale, `totalRounds - 1`,
 * généralise à tout bracket : pour un 4-bracket ce round EST déjà le
 * round 1, donc ses 2 perdants sont directement les "demi-finalistes"),
 * badges, annonce Discord.
 */
async function finalizeTournament(tournamentId: string, championId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { game: true, matches: true, champion: true },
  });
  if (!tournament) return;

  const totalRounds = totalRoundsFor(bracketSizeFor(tournament.maxPlayers));
  const finalMatch = tournament.matches.find((m) => m.round === totalRounds);
  const runnerUpId =
    finalMatch && finalMatch.winnerId
      ? finalMatch.player1Id === finalMatch.winnerId
        ? finalMatch.player2Id
        : finalMatch.player1Id
      : null;

  const semifinalRound = totalRounds - 1;
  const semifinalLoserIds = tournament.matches
    .filter((m) => m.round === semifinalRound && m.winnerId)
    .map((m) => (m.player1Id === m.winnerId ? m.player2Id : m.player1Id))
    .filter((id): id is string => id !== null);

  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { status: "DONE", championId },
  });

  await awardXp(championId, "TOURNAMENT_RESULT", `${tournamentId}:1st`, XP_AMOUNTS.TOURNAMENT_1ST);
  if (runnerUpId) {
    await awardXp(
      runnerUpId,
      "TOURNAMENT_RESULT",
      `${tournamentId}:2nd`,
      XP_AMOUNTS.TOURNAMENT_2ND
    );
  }
  for (const loserId of semifinalLoserIds) {
    await awardXp(
      loserId,
      "TOURNAMENT_RESULT",
      `${tournamentId}:semi:${loserId}`,
      XP_AMOUNTS.TOURNAMENT_SEMIFINALIST
    );
  }

  const participantIds = await prisma.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { userId: true },
  });
  for (const p of participantIds) {
    await checkTournamentBadges(p.userId);
  }

  const champion = await prisma.user.findUnique({ where: { id: championId } });
  if (champion) {
    const result = await postToDiscord({
      title: `🏆 ${champion.discordName} remporte le tournoi ${tournament.name} !`,
      description: `Sur ${tournament.game.name} — GG à tous les participants !`,
      color: ACCENT_COLOR,
    });
    if (!result.ok) {
      logger.warn("tournaments", "Notif Discord fin de tournoi non envoyée.", { tournamentId });
    }
  }
}
