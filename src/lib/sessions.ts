import { prisma } from "@/lib/prisma";
import { isAvailableAt } from "@/lib/availability";
import { sameUtcDate, wallClockNow } from "@/lib/wallclock";
import { announceSessionResult } from "@/lib/discord-announce";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { openSuperlativeVotingWindow } from "@/lib/superlative-voting";
import { checkSessionsParticipatedBadges } from "@/lib/badges";
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
  /** `null` : session clôturée sans tenter d'annonce Discord (0 votant, cf. `closeSession`). */
  discord: PostToDiscordResult | null;
}

/**
 * Réclame atomiquement le droit de clôturer une session : un seul
 * `updateMany` conditionné sur `status: "VOTING"`, dont Postgres garantit
 * l'exécution atomique. Si deux appels concurrents à `closeSession` (deux
 * pages chargées en même temps, ou le cron `/api/cron/close-sessions` qui
 * chevauche un déclenchement paresseux `closeSessionIfDue`) tentent de
 * clôturer la même session, un seul verra `count === 1` — l'autre trouve
 * déjà `status !== "VOTING"` (l'update du premier a déjà committé) et
 * doit abandonner sans poster une deuxième annonce Discord.
 *
 * Root cause du bug remonté en prod (embed "Joueurs"/"Qui vient"
 * incohérent) : `closeSessionIfDue` est appelée sans garde-fou de
 * concurrence depuis `/`, `/sessions` et `/sessions/[id]`, à chaque
 * chargement de page, par n'importe qui. Dès qu'une session devient due
 * pendant que plusieurs personnes ont l'app ouverte (typiquement l'heure
 * pile d'une soirée), plusieurs exécutions de `closeSession` peuvent
 * partir en parallèle avant qu'aucune n'ait eu le temps d'écrire le
 * nouveau statut — chacune poste alors sa propre annonce Discord, deux
 * messages quasi identiques adjacents dans le salon (pas un seul embed
 * intérieurement incohérent : `winner.votes.length` et les mentions de
 * "Qui vient" viennent tous les deux de la même liste `winner.votes`,
 * donc ne peuvent jamais diverger AU SEIN d'un même message — vérifié en
 * relisant `announceSessionResult`). Ce garde-fou élimine la possibilité
 * même d'une double annonce, quelle que soit la source du déclenchement.
 */
async function claimSessionClose(
  sessionId: string,
  data: { status: "CANCELLED" } | { status: "SCHEDULED"; decidedGameId: string; decidedTime: Date }
): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, status: "VOTING" },
    data,
  });
  return result.count === 1;
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
 *
 * Idempotent/concurrence-safe : voir `claimSessionClose`. Un appel qui
 * perd la course renvoie `null`, exactement comme si la session n'était
 * déjà plus `VOTING` au tout début de la fonction — même contrat pour
 * l'appelant (`closeSessionIfDue`, le nouveau cron, ou la clôture
 * manuelle créateur) dans les deux cas.
 *
 * Cas "0 votant" (bug remonté en prod, cycle de vie des soirées) : si
 * aucune proposition jouable n'a reçu le moindre vote, on annule plutôt
 * que de valider et annoncer une soirée que personne n'a explicitement
 * choisie — même traitement que "aucune proposition jouable", mais SANS
 * annonce Discord (décision produit : pas de bruit dans le salon pour une
 * clôture qui ne reflète l'intérêt de personne). `discord: null` dans le
 * résultat distingue ce cas du "aucune proposition jouable", qui reste
 * annoncé ("❌ Soirée annulée").
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
    if (!(await claimSessionClose(sessionId, { status: "CANCELLED" }))) return null;
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
    if (!(await claimSessionClose(sessionId, { status: "CANCELLED" }))) return null;
    return { discord: await announceSessionResult(session, null, false) };
  }

  const winner = jouableProposals.reduce((best, proposal) =>
    proposal.votes.length > best.votes.length ? proposal : best
  );

  if (winner.votes.length === 0) {
    if (!(await claimSessionClose(sessionId, { status: "CANCELLED" }))) return null;
    return { discord: null };
  }

  const tie =
    jouableProposals.filter((p) => p.votes.length === winner.votes.length)
      .length > 1;

  const claimed = await claimSessionClose(sessionId, {
    status: "SCHEDULED",
    decidedGameId: winner.gameId,
    decidedTime: session.date,
  });
  if (!claimed) return null;

  // XP participation (Axe 1) — même définition de "présent" que celle
  // utilisée par l'écran de saisie des résultats (PR 3/9) : les users qui
  // ont voté pour la proposition gagnante. sourceId = session.id, un seul
  // crédit par session même si `closeSession` est rappelé (ne devrait pas
  // arriver, la session n'est plus VOTING après ce point, mais la
  // contrainte unique d'`awardXp` protège de toute façon).
  for (const vote of winner.votes) {
    await awardXp(vote.userId, "PARTICIPATE", sessionId, XP_AMOUNTS.PARTICIPATE);
    await checkSessionsParticipatedBadges(vote.userId);
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
  const result = await prisma.session.updateMany({
    where: { id: sessionId, status: "SCHEDULED" },
    data: { status: "DONE" },
  });
  if (result.count === 0) return;

  // PR 5/9 — ouvre la fenêtre de vote de superlatifs entre potes dès que
  // la session passe DONE (voir src/lib/superlative-voting.ts).
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { decidedGameId: true },
  });
  await openSuperlativeVotingWindow(sessionId, session?.decidedGameId ?? null);
}

/**
 * Délai de grâce avant qu'une soirée `SCHEDULED` passe automatiquement
 * `DONE` — laisse le temps à la soirée d'avoir réellement lieu avant de
 * la considérer terminée (une soirée qui commence à 20h n'est pas "finie"
 * à 20h01). Valeur produit, facile à ajuster.
 */
const SCHEDULED_TO_DONE_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Bug prod (cycle de vie des soirées, fin août 2026) : `SCHEDULED → DONE`
 * n'avait jusqu'ici aucun déclenchement automatique, seulement le bouton
 * "Marquer comme terminée" (créateur, manuel). Une soirée décidée restait
 * donc indéfiniment "Prévue" — visible pour toujours dans "À venir" et
 * capable de rafler "Prochaine soirée" sur `/` (qui prend la plus
 * ancienne session `VOTING`/`SCHEDULED`) tant que personne ne cliquait le
 * bouton.
 *
 * Cette fonction trouve TOUTES les sessions `SCHEDULED` dont l'heure de
 * début dépasse `SCHEDULED_TO_DONE_GRACE_MS`, sans aucune borne sur leur
 * ancienneté — un premier passage après déploiement rattrape donc tout le
 * backlog déjà accumulé, pas seulement les sessions récentes. Réutilise
 * `markSessionDone` (idempotent, ouvre la fenêtre de vote de superlatifs)
 * pour chacune — pas de logique dupliquée. Appelée par le cron
 * `/api/cron/close-sessions`, TOUJOURS après la clôture des sessions
 * `VOTING` (une soirée à 0 votant passe `CANCELLED` dans ce même run,
 * donc ne peut plus jamais apparaître dans la requête `SCHEDULED`
 * ci-dessous — l'ordre des deux passes garantit cet invariant).
 */
export async function closeOverdueScheduledSessions(): Promise<string[]> {
  const cutoff = new Date(wallClockNow().getTime() - SCHEDULED_TO_DONE_GRACE_MS);
  const overdue = await prisma.session.findMany({
    where: { status: "SCHEDULED", date: { lte: cutoff } },
    select: { id: true },
  });

  for (const session of overdue) {
    await markSessionDone(session.id);
  }

  return overdue.map((s) => s.id);
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
