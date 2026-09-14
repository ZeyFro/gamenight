import { Prisma } from "@prisma/client";
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
 * Perdant d'un match à partir du gagnant déclaré — pure, extraite de
 * `declareWinner` (PR "Atomicité saisons + tournois") pour rester
 * testable sans Prisma.
 */
export function computeMatchLoser(
  winnerId: string,
  player1Id: string | null,
  player2Id: string | null
): string | null {
  return winnerId === player1Id ? player2Id : player1Id;
}

/**
 * Emplacement du round suivant vers lequel un gagnant avance — pure,
 * extraite d'`advanceWinner`. `position` pair → `player1Id` du match
 * `floor(position/2)` du round suivant, impair → `player2Id` (2 matchs
 * du round N convergent vers 1 match `position/2` du round N+1).
 */
export function computeNextSlot(
  round: number,
  position: number
): { nextRound: number; nextPosition: number; field: "player1Id" | "player2Id" } {
  return {
    nextRound: round + 1,
    nextPosition: Math.floor(position / 2),
    field: position % 2 === 0 ? "player1Id" : "player2Id",
  };
}

/**
 * Fait avancer le gagnant d'un match vers le round suivant, DANS la
 * transaction du claim de l'appelant (`declareWinner`, ou la résolution
 * des byes dans `generateBracket`) — TOUS les matchs de tous les rounds
 * existent déjà dès `generateBracket` (créés avec des joueurs `null`),
 * cette fonction ne fait que les remplir au fur et à mesure.
 *
 * Si `nextRound` n'existe pas (`round >= totalRounds`), `round` était la
 * finale : marque le tournoi `DONE` + `championId` (pure écriture DB,
 * toujours via `tx`, jamais d'effet externe ici) et renvoie
 * `tournamentFinalized: true` — c'est à l'appelant de déclencher les
 * effets post-commit (XP/badges/Discord, voir
 * `announceTournamentFinalization`) une fois SA transaction committée.
 */
async function advanceWinner(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  round: number,
  position: number,
  winnerId: string,
  totalRounds: number
): Promise<{ tournamentFinalized: boolean }> {
  if (round >= totalRounds) {
    await tx.tournament.update({
      where: { id: tournamentId },
      data: { status: "DONE", championId: winnerId },
    });
    return { tournamentFinalized: true };
  }

  const { nextRound, nextPosition, field } = computeNextSlot(round, position);

  await tx.tournamentMatch.update({
    where: { tournamentId_round_position: { tournamentId, round: nextRound, position: nextPosition } },
    data: { [field]: winnerId },
  });
  return { tournamentFinalized: false };
}

interface LockedTournamentRow {
  id: string;
  status: string;
  maxPlayers: number;
}

/**
 * Cœur de `generateBracket` — pris en paramètre `tx` pour pouvoir être
 * appelé soit par le wrapper public `generateBracket` (sa propre
 * transaction, cas du lancement par le créateur), soit DIRECTEMENT par
 * `registerForTournamentAction` quand l'inscription en cours remplit la
 * dernière place (réutilise la transaction déjà ouverte par l'appelant —
 * cette fonction ne fait jamais `prisma.$transaction` elle-même, jamais
 * de seconde transaction imbriquée).
 *
 * Fix bug remonté (concurrence tournois, round 2 — inscription/
 * désinscription concurrentes à un lancement anticipé) — verrouille
 * D'ABORD la ligne `Tournament` (`SELECT ... FOR UPDATE`), AVANT de lire
 * le moindre `TournamentParticipant`. L'ancienne version lisait les
 * participants hors transaction, bien avant que le claim sur `status` ne
 * prenne le moindre verrou : une désinscription atterrissant dans cette
 * fenêtre supprimait une ligne que la transaction tentait ensuite de
 * mettre à jour (`update` sur un id disparu → exception → rollback
 * complet, y compris le `status` déjà basculé — visible comme une erreur
 * serveur côté créateur). Le verrou est maintenant pris avant toute
 * lecture, et `registerForTournamentAction`/`unregisterFromTournamentAction`
 * verrouillent la MÊME ligne en premier (voir ces deux fonctions,
 * src/app/tournois/actions.ts) — Postgres les sérialise : aucune des
 * trois transactions ne peut plus s'intercaler dans la fenêtre d'une
 * autre. Une seule ligne `Tournament` est jamais verrouillée par
 * transaction (jamais deux à la fois) : pas d'ordre de verrouillage
 * concurrent possible entre elles, donc pas de deadlock.
 *
 * Le claim précédent (`updateMany` conditionné sur `status`) est
 * remplacé par un `update` simple : sous ce verrou, le statut vient
 * d'être relu et personne d'autre ne peut l'avoir changé entre-temps — le
 * conditionner à nouveau n'apporterait rien.
 */
export async function buildBracketInTransaction(
  tx: Prisma.TransactionClient,
  tournamentId: string
): Promise<void> {
  const locked = await tx.$queryRaw<LockedTournamentRow[]>`
    SELECT id, status, "maxPlayers" FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE
  `;
  const tournament = locked[0];
  if (!tournament || tournament.status !== "REGISTRATION") return;

  const participants = await tx.tournamentParticipant.findMany({ where: { tournamentId } });

  const bracketSize = bracketSizeFor(tournament.maxPlayers);
  const totalRounds = totalRoundsFor(bracketSize);
  const matchCount = bracketSize / 2;
  // Lancement anticipé (avant que toutes les places soient prises) avec
  // trop peu de participants pour remplir au moins un joueur par match —
  // no-op plutôt qu'un bracket avec des matchs entièrement vides.
  if (participants.length < matchCount) return;

  const shuffled = shuffle(participants);

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

  await tx.tournament.update({ where: { id: tournamentId }, data: { status: "IN_PROGRESS" } });

  await Promise.all(
    shuffled.map((p, i) => tx.tournamentParticipant.update({ where: { id: p.id }, data: { seed: i + 1 } }))
  );

  await tx.tournamentMatch.createMany({
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
    await tx.tournamentMatch.createMany({
      data: Array.from({ length: matchesInRound }, (_, position) => ({
        tournamentId,
        round,
        position,
      })),
    });
  }

  // Byes : un seul joueur sur les deux slots du match → avance sans jouer,
  // résolu immédiatement (jamais affiché comme un vrai match à jouer côté UI).
  for (const m of round1Matches) {
    const winner =
      m.player1Id && !m.player2Id ? m.player1Id : !m.player1Id && m.player2Id ? m.player2Id : null;
    if (!winner) continue;
    await tx.tournamentMatch.update({
      where: { tournamentId_round_position: { tournamentId, round: 1, position: m.position } },
      data: { winnerId: winner, completedAt: wallClockNow() },
    });
    // `tournamentFinalized` volontairement ignoré : structurellement
    // inatteignable ici (totalRounds vaut toujours 2 ou 3, donc round 1
    // < totalRounds systématiquement — voir docstring ci-dessus).
    await advanceWinner(tx, tournamentId, 1, m.position, winner, totalRounds);
  }
}

/**
 * Génère le bracket complet au lancement d'un tournoi (inscriptions
 * pleines, ou le créateur clique "Lancer maintenant") : seed aléatoire
 * (pas de classement XP, cf. spec), création de TOUS les matchs de TOUS
 * les rounds d'un coup (round 1 avec les joueurs tirés, les suivants
 * avec des slots vides à remplir plus tard), résolution immédiate des
 * "byes" (moins de participants que de slots — le joueur seul avance
 * sans jouer). Wrapper public — ouvre sa propre transaction autour de
 * `buildBracketInTransaction` ; voir cette fonction pour le détail du
 * verrouillage et l'historique des deux bugs de concurrence corrigés.
 * Aucun effet externe ici (jamais de Discord/XP dans cette fonction).
 */
export async function generateBracket(tournamentId: string): Promise<void> {
  await prisma.$transaction((tx) => buildBracketInTransaction(tx, tournamentId));
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
 *
 * Fix bug remonté (atomicité tournois, PR "Atomicité saisons +
 * tournois") — l'ancien code faisait un `update` inconditionnel par id :
 * deux appels concurrents sur le MÊME match (double clic, ou les deux
 * joueurs qui déclarent chacun leur propre victoire à quelques secondes
 * d'écart — aucun rate-limit ne protège contre ça en pratique) réussissaient
 * TOUS LES DEUX, le dernier à committer l'emportant silencieusement :
 * pouvait marquer les DEUX joueurs éliminés (chaque appel élimine "son"
 * perdant) et faire avancer un gagnant arbitraire vers le round suivant,
 * sans la moindre erreur ni log. Le claim ci-dessous (`updateMany`
 * conditionné sur `completedAt: null`, même pattern que
 * `claimSessionClose`, `src/lib/sessions.ts`) garantit qu'un seul appel
 * gagne la course ; l'autre trouve `count !== 1` et s'arrête sans avoir
 * touché ni le perdant ni le round suivant ni l'XP.
 *
 * Élimination du perdant + avancement vers le round suivant (ou clôture
 * du tournoi si c'était la finale) vivent dans la MÊME transaction que le
 * claim : un crash en cours de route ne peut plus laisser un match
 * "tranché" sans que son perdant soit marqué éliminé, ou sans que le
 * gagnant ait avancé.
 *
 * Effets post-commit (XP, badges, annonce Discord) : déclenchés
 * uniquement si la transaction a réellement clôturé le tournoi
 * (`tournamentFinalized`), APRÈS que la transaction ait committé, jamais
 * à l'intérieur — voir `announceTournamentFinalization`.
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
  // Raccourci : évite d'ouvrir une transaction pour un clic manifestement
  // périmé (page pas rafraîchie). Ne garantit rien à lui seul contre la
  // course — la vraie protection est le claim transactionnel plus bas.
  if (match.completedAt) return { ok: false, tournamentDone: false };
  if (winnerId !== match.player1Id && winnerId !== match.player2Id) {
    return { ok: false, tournamentDone: false };
  }

  const isCreator = match.tournament.createdById === actorUserId;
  const isPlayer = actorUserId === match.player1Id || actorUserId === match.player2Id;
  if (!isCreator && !isPlayer) return { ok: false, tournamentDone: false };

  const loserId = computeMatchLoser(winnerId, match.player1Id, match.player2Id);
  const totalRounds = totalRoundsFor(bracketSizeFor(match.tournament.maxPlayers));

  let claimed = false;
  let tournamentFinalized = false;

  await prisma.$transaction(async (tx) => {
    const claim = await tx.tournamentMatch.updateMany({
      where: { id: matchId, completedAt: null },
      data: { winnerId, completedAt: wallClockNow() },
    });
    if (claim.count !== 1) return; // course perdue — le match a déjà été tranché

    claimed = true;

    if (loserId) {
      await tx.tournamentParticipant.updateMany({
        where: { tournamentId: match.tournamentId, userId: loserId },
        data: { eliminatedAt: wallClockNow() },
      });
    }

    const result = await advanceWinner(
      tx,
      match.tournamentId,
      match.round,
      match.position,
      winnerId,
      totalRounds
    );
    tournamentFinalized = result.tournamentFinalized;
  });

  if (!claimed) return { ok: false, tournamentDone: false };

  if (tournamentFinalized) {
    await announceTournamentFinalization(match.tournamentId, winnerId);
  }

  return { ok: true, tournamentDone: tournamentFinalized };
}

/**
 * Effets post-commit de la clôture d'un tournoi — XP (1er 200, 2e 100,
 * demi-finalistes 50 chacun — les perdants du round juste avant la
 * finale, `totalRounds - 1`, généralise à tout bracket : pour un
 * 4-bracket ce round EST déjà le round 1, donc ses 2 perdants sont
 * directement les "demi-finalistes"), badges, annonce Discord.
 *
 * Appelée par `declareWinner` UNIQUEMENT après que sa transaction ait
 * committé `Tournament.status = DONE` + `championId` (PR "Atomicité
 * saisons + tournois" — avant ce fix, ces effets vivaient DANS la même
 * séquence que l'écriture DB, jamais explicitement séparés). Best-effort,
 * enveloppée dans son propre try/catch : un échec ici (Discord down,
 * etc.) ne doit jamais faire passer `declareWinner` pour un échec — le
 * match et la clôture du tournoi sont déjà actés en base à ce stade.
 * Chaque `awardXp` reste individuellement atomique/idempotent (PR
 * "Atomicité XP").
 */
async function announceTournamentFinalization(tournamentId: string, championId: string): Promise<void> {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { game: true, matches: true },
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
  } catch (error) {
    logger.error("tournaments", error, { tournamentId, championId, effect: "finalization" });
  }
}
