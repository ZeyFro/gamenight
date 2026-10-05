import { prisma } from "@/lib/prisma";
import { isAvailableAt } from "@/lib/availability";
import { sameUtcDate, wallClockNow } from "@/lib/wallclock";
import { getWeekStart } from "@/lib/calendar-dates";
import { announceSessionResult } from "@/lib/discord-announce";
import {
  enqueueSessionAnnounceUpdate,
  enqueueSessionCreationDeliveries,
  enqueueSessionInviteSyncForNewInvite,
  enqueueSessionResultThreadSummary,
  enqueueSessionDateChange,
  enqueueSessionValidated,
} from "@/lib/session-announce";
import { isSessionAnnounceViaBotEnabledFor, pickCreationCommunityId } from "@/lib/community-channels";
import { isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { inviteToSession } from "@/lib/session-access";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { openSuperlativeVotingWindow } from "@/lib/superlative-voting";
import { checkSessionsParticipatedBadges } from "@/lib/badges";
import { checkGroupAchievements } from "@/lib/group-achievements";
import { getDefaultCommunityId } from "@/lib/default-community";
import { logger } from "@/lib/logger";
import { closeThreadOnEndSafely } from "@/lib/thread-close-on-end";
import { isWithinHistoryWindow } from "@/lib/history-visibility";
import type { PostToDiscordResult } from "@/lib/discord";
import type { Game, GroupAchievement, Session, SessionStatus, User } from "@prisma/client";

/**
 * Bug remonté (production, après activation de `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`)
 * — crée une session DÉJÀ DÉCIDÉE (jeu et créneau connus d'avance, jamais
 * de phase VOTING) et enqueue son intention de notification bot DANS LA
 * MÊME transaction SQL, exactement le même contrat que `createSession`
 * (session-lifecycle.ts) et `updateSessionSchedule` ci-dessus. Chemin
 * PARTAGÉ par les deux créations Roulette (instantanée,
 * `createSessionFromRouletteAction` dans src/app/roulette/actions.ts, et
 * asynchrone, `spinRoulette` dans src/lib/roulette.ts) — jusqu'ici, ces
 * DEUX call sites créaient la session par un `prisma.session.create` NU,
 * sans jamais lire `isSessionAnnounceViaBotEnabled()` ni poser
 * `announceViaBot` : la colonne retombait donc TOUJOURS sur son défaut de
 * schéma (`false`), quelle que soit la configuration du chantier bot, et
 * les deux appelants continuaient d'appeler INCONDITIONNELLEMENT le
 * webhook legacy (`announceRouletteResult`/`announceSessionResult`) —
 * jamais les deux transports à la fois pour une session normale, mais ICI
 * le webhook partait TOUJOURS, même bot activé. Extrait en un seul
 * morceau de code testable plutôt que dupliqué (même raisonnement que
 * `updateSessionSchedule`) : les deux appelants restent seuls responsables
 * de LEURS propres données (jeu gagnant, participants) et de LEUR propre
 * annonce webhook.
 *
 * Correctif (diagnostic ping Discord, 26/09) — le `Proposal`/`Vote` du jeu
 * gagnant sont désormais créés ICI, DANS CETTE MÊME transaction, plutôt
 * que par l'appelant juste après (comportement d'origine, documenté à tort
 * ci-dessus comme "non-critique"). Sans ça, le SEND initial de l'annonce
 * (occurrence FIXE, jamais retenté — voir `enqueueSessionCreationDeliveries`)
 * pouvait être traité par le cron entre le commit de cette transaction et
 * la création séparée du `Proposal`/`Vote` : `resolveAnnounceRendering`
 * (branche SCHEDULED/DONE) ne trouve alors aucun gagnant et retombe sur un
 * rendu neutre SANS mention, envoyé définitivement. `proposalId` retourné
 * pour l'appelant qui en a besoin (chemin webhook, annonce du résultat).
 */
export async function createRouletteResultSession(data: {
  date: Date;
  decidedGameId: string;
  decidedTime: Date;
  createdById: string;
  notifiedUserIds: string[];
}): Promise<{ session: Session; announceViaBot: boolean; proposalId: string }> {
  // Multi-communautés (PR3) : `null` tant que `COMMUNITY_CHANNELS_ENABLED` est éteint.
  const communityId = await pickCreationCommunityId(data.createdById);
  // Sous isolation (PR4), sans aucune communauté la soirée serait rattachée à
  // `default` sans que le créateur en soit membre : on refuse.
  if (isCommunityIsolationEnabled() && communityId === null) {
    throw new Error("createRouletteResultSession : le créateur n'appartient à aucune communauté active.");
  }
  const announceViaBot = await isSessionAnnounceViaBotEnabledFor(communityId);
  logger.info("sessions", "Décision de transport à la création (session issue d'une roulette).", {
    announceViaBot,
  });

  const { session, proposalId } = await prisma.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: { ...data, status: "SCHEDULED", createdViaRoulette: true, announceViaBot, communityId },
    });
    // Confidentialité des soirées — mêmes garanties que `createSession`
    // (session-lifecycle.ts) : `SessionInvite` posée pour EXACTEMENT
    // `data.notifiedUserIds` (les participants réels de la roulette),
    // DANS LA MÊME transaction que la création de la session.
    const createdInviteIds: string[] = [];
    for (const guestId of data.notifiedUserIds) {
      const invite = await inviteToSession(created.id, data.createdById, guestId, tx);
      if (invite) createdInviteIds.push(invite.id);
    }
    if (announceViaBot) {
      await enqueueSessionCreationDeliveries(created.id, tx);
      // Même correctif que `createSession` (session-lifecycle.ts) : un
      // participant Roulette n'était jusqu'ici jamais synchronisé vers le
      // fil Discord tant qu'il n'était pas réinvité manuellement — voir le
      // commentaire de `enqueueSessionInviteSyncForNewInvite`,
      // session-announce.ts.
      for (const inviteId of createdInviteIds) {
        await enqueueSessionInviteSyncForNewInvite(created.id, inviteId, tx);
      }
    }
    const proposal = await tx.proposal.create({
      data: { sessionId: created.id, gameId: data.decidedGameId, proposedById: data.createdById },
    });
    await tx.vote.createMany({
      data: data.notifiedUserIds.map((userId) => ({ proposalId: proposal.id, userId })),
    });
    return { session: created, proposalId: proposal.id };
  });

  return { session, announceViaBot, proposalId };
}

/**
 * Cycle de vie de l'historique (V2, bug remonté en test réel) — masque de
 * la LISTE `/sessions` (onglet historique) et `/roulette` (onglet
 * historique), jamais de la base ni du contrôle d'accès (voir
 * `history-visibility.ts`). Une soirée `VOTING`/`SCHEDULED` (encore
 * active) reste TOUJOURS visible, quel que soit son âge — seules `DONE`/
 * `CANCELLED` peuvent sortir de la liste, et seulement après la fenêtre.
 *
 * Point de départ RÉEL utilisé : `date` (le créneau de la soirée),
 * repli PRUDENT documenté faute de colonne dédiée `closedAt`/`cancelledAt`
 * sur `Session` (contrairement à `Tournament.cancelledAt`, voir
 * `tournaments.ts`) — jamais `updatedAt` (proscrit explicitement : une
 * simple modification tardive, sans rapport avec la fin réelle, ferait
 * réapparaître ou disparaître une soirée à tort), jamais une date
 * inventée. Pour `DONE`, `date` est le créneau RÉELLEMENT joué (la
 * soirée a eu lieu à cette date) — fidèle. Pour `CANCELLED`, `date` est
 * le créneau qui AURAIT eu lieu, pas l'instant de l'annulation elle-même
 * (qui peut être bien plus tôt) — la fenêtre démarre donc plus TARD que
 * l'annulation réelle, jamais plus tôt : direction prudente délibérée
 * (ne masque jamais trop tôt, au pire un peu trop tard), au prix d'une
 * précision imparfaite pour les annulations très en amont — limite
 * assumée, documentée ici plutôt que résolue en ajoutant une colonne
 * hors du périmètre de ce correctif.
 */
export function isSessionVisibleInHistory(
  session: Pick<Session, "status" | "date">,
  now: Date = wallClockNow()
): boolean {
  if (session.status !== "DONE" && session.status !== "CANCELLED") return true;
  return isWithinHistoryWindow(session.date, now);
}

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
 * Modifie le créneau d'une session ET enqueue son édition d'annonce bot
 * DANS LA MÊME transaction SQL (revue ciblée de #99, même raisonnement
 * que `cancelSession`/`closeSession` plus bas) — mutualisé avec
 * `editSessionAction` (session-lifecycle.ts, qui reste seule responsable
 * de la validation/autorisation/redirection) pour que cette partie
 * atomique mutation+notification soit un morceau de code UNIQUE,
 * directement testable, plutôt que dupliquée entre les deux fichiers. Un
 * crash entre les deux écritures laisserait sinon le créneau mis à jour
 * en base sans jamais éditer l'annonce Discord, qui resterait affichée
 * avec l'ANCIEN créneau indéfiniment, en silence.
 */
export async function updateSessionSchedule(
  sessionId: string,
  data: { date: Date; votingDeadline: Date | null; decidedTime?: Date },
  announceViaBot: boolean
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.session.findUnique({ where: { id: sessionId }, select: { date: true } });
    await tx.session.update({ where: { id: sessionId }, data });
    if (announceViaBot) {
      // L'annonce et le MP d'invitation sont ÉDITÉS (une édition ne notifie
      // personne) ; un changement de DATE y ajoute un message avec mention
      // dans le fil et un nouveau MP « Date modifiée ».
      await enqueueSessionAnnounceUpdate(sessionId, tx);
      if (before && before.date.getTime() !== data.date.getTime()) {
        await enqueueSessionDateChange(sessionId, tx);
      }
    }
  });
}

export interface CloseSessionResult {
  /** `null` : session clôturée sans tenter d'annonce Discord (0 votant, cf. `closeSession`). */
  discord: PostToDiscordResult | null;
}

/**
 * Réclame ATOMIQUEMENT le droit de clôturer une session ET enqueue son
 * intention de notification bot DANS LA MÊME transaction SQL (revue
 * ciblée de #99, suite à `createSession`/`editSessionAction`) : un seul
 * `updateMany` conditionné sur `status: "VOTING"` (Postgres garantit son
 * atomicité), suivi de l'enqueue SI cette session est passée sur le
 * chemin bot — les deux commitent ensemble ou rollback ensemble. Un
 * crash entre les deux aurait sinon laissé une clôture déjà actée en
 * base sans jamais éditer l'annonce Discord, qui resterait affichée avec
 * l'ANCIEN état (toujours "en cours de vote") indéfiniment, en silence.
 *
 * Concurrence — même garde-fou que l'ancien `claimSessionClose` (root
 * cause du bug prod "Joueurs"/"Qui vient" incohérent, cf. historique de ce
 * fichier) : si deux appels concurrents à `closeSession` (deux pages
 * chargées en même temps, ou le cron `/api/cron/close-sessions` qui
 * chevauche un déclenchement paresseux `closeSessionIfDue`) tentent de
 * clôturer la même session, un seul verra `claimed: true` — l'autre
 * trouve déjà `status !== "VOTING"` et abandonne sans poster une deuxième
 * annonce Discord (ni enqueue une deuxième livraison bot).
 *
 * `winner` détermine, EN PLUS de l'EDIT de l'annonce, si un résumé de
 * résultat est aussi enqueue dans le fil (jamais pour une annulation).
 * Aucun appel Discord ici (webhook OU bot) — seulement des écritures :
 * le webhook reste appelé par l'appelant, HORS de cette transaction, et
 * le chemin bot ne fait jamais qu'enqueue une intention, jamais un appel
 * réseau (voir le commentaire de fichier de `notification-delivery.ts`
 * sur l'interdiction d'appel Discord dans une transaction SQL).
 */
async function claimSessionCloseWithAnnounce(
  sessionId: string,
  announceViaBot: boolean,
  data: { status: "CANCELLED" } | { status: "SCHEDULED"; decidedGameId: string; decidedTime: Date },
  winner: Parameters<typeof announceSessionResult>[1]
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.session.updateMany({
      where: { id: sessionId, status: "VOTING" },
      data,
    });
    if (result.count !== 1) return false;
    if (announceViaBot) {
      await enqueueSessionAnnounceUpdate(sessionId, tx);
      if (winner) {
        await enqueueSessionResultThreadSummary(sessionId, tx);
        await enqueueSessionValidated(sessionId, tx);
      }
    }
    return true;
  });
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
 * Idempotent/concurrence-safe : voir `claimSessionCloseWithAnnounce`. Un
 * appel qui perd la course renvoie `null`, exactement comme si la session
 * n'était déjà plus `VOTING` au tout début de la fonction — même contrat
 * pour l'appelant (`closeSessionIfDue`, le nouveau cron, ou la clôture
 * manuelle créateur) dans les deux cas.
 *
 * Cas "0 votant" (bug remonté en prod, cycle de vie des soirées) : si
 * aucune proposition jouable n'a reçu le moindre vote, on annule plutôt
 * que de valider et annoncer une soirée que personne n'a explicitement
 * choisie — même traitement que "aucune proposition jouable", mais SANS
 * annonce Discord (décision produit : pas de bruit dans le salon pour une
 * clôture qui ne reflète l'intérêt de personne). `discord: null` dans le
 * résultat distingue ce cas du "aucune proposition jouable", qui reste
 * annoncé ("❌ Soirée annulée"). Sans annonce, RIEN à enqueue non plus —
 * ce seul cas garde un simple claim atomique, sans transaction couplée à
 * une notification (il n'y en a aucune ici, webhook ou bot).
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
  const announceViaBot = session.announceViaBot;

  if (session.proposals.length === 0) {
    return closeAsCancelled(sessionId, announceViaBot, session);
  }

  const availability = await getProposalAvailability(
    session.date,
    session.proposals.map((p) => p.game)
  );
  const jouableProposals = session.proposals.filter(
    (p) => availability.get(p.gameId)?.jouable
  );

  if (jouableProposals.length === 0) {
    return closeAsCancelled(sessionId, announceViaBot, session);
  }

  const winner = jouableProposals.reduce((best, proposal) =>
    proposal.votes.length > best.votes.length ? proposal : best
  );

  if (winner.votes.length === 0) {
    const result = await prisma.session.updateMany({
      where: { id: sessionId, status: "VOTING" },
      data: { status: "CANCELLED" },
    });
    if (result.count !== 1) return null;
    await closeThreadOnEndSafely("session", sessionId);
    return { discord: null };
  }

  const tie =
    jouableProposals.filter((p) => p.votes.length === winner.votes.length)
      .length > 1;

  // Réclame la clôture ET enqueue son intention de notification bot
  // ENSEMBLE (revue ciblée de #99) — voir `claimSessionCloseWithAnnounce`.
  const claimed = await claimSessionCloseWithAnnounce(
    sessionId,
    announceViaBot,
    { status: "SCHEDULED", decidedGameId: winner.gameId, decidedTime: session.date },
    winner
  );
  if (!claimed) return null;

  // XP participation (Axe 1) — même définition de "présent" que celle
  // utilisée par l'écran de saisie des résultats (PR 3/9) : les users qui
  // ont voté pour la proposition gagnante. sourceId = session.id, un seul
  // crédit par session même si `closeSession` est rappelé (ne devrait pas
  // arriver, la session n'est plus VOTING après ce point, mais la
  // contrainte unique d'`awardXp` protège de toute façon). Volontairement
  // HORS de la transaction ci-dessus (revue ciblée de #99) : XP/badges
  // gardent le même schéma séquentiel non transactionnel qu'ailleurs dans
  // l'app, jamais déplacés dans la transaction de clôture/notification —
  // seule la clôture ET l'intention de notification bot doivent être
  // atomiques ensemble, pas ces effets de bord indépendants.
  for (const vote of winner.votes) {
    await awardXp(vote.userId, "PARTICIPATE", sessionId, XP_AMOUNTS.PARTICIPATE);
    await checkSessionsParticipatedBadges(vote.userId);
  }

  const discord = announceViaBot
    ? { ok: true as const }
    : await announceSessionResult(session, winner, tie);
  return { discord };
}

/** Annulation partagée par les deux branches "aucune proposition
 * jouable" de `closeSession` — claim + enqueue bot atomiques, webhook
 * hors transaction (voir `claimSessionCloseWithAnnounce`). */
async function closeAsCancelled(
  sessionId: string,
  announceViaBot: boolean,
  session: Pick<Session, "id" | "createdById" | "date" | "notifiedUserIds">
): Promise<CloseSessionResult | null> {
  const claimed = await claimSessionCloseWithAnnounce(sessionId, announceViaBot, { status: "CANCELLED" }, null);
  if (!claimed) return null;
  await closeThreadOnEndSafely("session", sessionId);
  const discord = announceViaBot ? { ok: true as const } : await announceSessionResult(session, null, false);
  return { discord };
}

export type DrawSessionGameOutcome =
  | { kind: "not_found" }
  | { kind: "not_creator" }
  | { kind: "not_voting"; status: SessionStatus; decidedGameId: string | null }
  | { kind: "no_eligible_game" }
  | { kind: "drawn"; winnerGameId: string; candidateGameIds: string[] };

/**
 * V2 — tirage au sort d'un jeu RATTACHÉ à une soirée déjà créée
 * (`VOTING`), en remplacement du parcours cassé "soirée → roulette" (qui
 * renvoyait vers le formulaire générique de création d'une roulette,
 * obligeant à ressaisir la date et resélectionner les invités, au risque
 * de créer une DEUXIÈME soirée). Ne crée JAMAIS de nouvelle `Session` :
 * transforme la MÊME ligne, exactement comme `closeSession` (même
 * id/URL, mêmes invitations/historique, mêmes propositions/votes/chat
 * déjà écrits, mêmes références Discord).
 *
 * Différence avec `closeSession` : le gagnant n'est PAS le plus voté
 * parmi les propositions jouables, mais tiré UNIFORMÉMENT au hasard
 * parmi elles — le reste (état "jouable", claim atomique, enqueue
 * Discord, XP) réutilise EXACTEMENT les mêmes briques
 * (`getProposalAvailability`, `enqueueSessionAnnounceUpdate`,
 * `enqueueSessionResultThreadSummary`, `awardXp`/
 * `checkSessionsParticipatedBadges`) plutôt que d'en récrire une version
 * parallèle incomplète.
 *
 * Éligibilité — RÉUTILISE `getProposalAvailability` (même fonction que
 * `closeSession`, déjà affichée sur `/sessions/[id]` sous la forme du
 * badge "JOUABLE"/"PAS ASSEZ DE JOUEURS") : un jeu est éligible s'il a
 * assez de PROPRIÉTAIRES DISPONIBLES à la date de la soirée (possession
 * ET disponibilité réelle, jamais "tous les invités supposés présents"
 * ni un simple compte d'invitations). Ceci est DÉLIBÉRÉMENT indépendant
 * de :
 *   - qui est INVITÉ à la soirée (`SessionInvite`) — l'éligibilité d'un
 *     jeu ne dépend jamais de la liste d'invités, seulement de qui le
 *     possède et est dispo, exactement comme pour un vote classique ;
 *   - qui a VOTÉ pour la proposition — un jeu jouable peut être tiré
 *     même sans le moindre vote (contrairement à `closeSession`, dont
 *     le "0 votant" annule la soirée : ce garde-fou n'a de sens QUE pour
 *     un classement par votes, pas pour un tirage aléatoire).
 *
 * Résultat SERVEUR uniquement — cette fonction ne prend AUCUNE
 * préférence de jeu en entrée, jamais un `gameId` fourni par l'appelant :
 * le résultat n'existe qu'après avoir été calculé ET commité ici.
 * L'animation côté client (voir `DrawSessionGameDialog`) ne fait
 * qu'illustrer un résultat déjà décidé, jamais l'inverse.
 *
 * Concurrence — même verrou que `closeSession` (`updateMany` conditionné
 * sur `status: "VOTING"`) : double clic, deux onglets, clôture manuelle
 * ou automatique concurrente ne peuvent JAMAIS committer deux fois — un
 * seul appel gagne, les autres trouvent `status !== "VOTING"` et
 * renvoient l'état ACTUEL plutôt que d'écraser quoi que ce soit. Vérifie
 * EN PLUS, DANS LA MÊME TRANSACTION que le claim, que la proposition
 * tirée existe TOUJOURS (protection contre un retrait de proposition
 * survenu entre le calcul du tirage et son commit — jamais démontré
 * ailleurs dans ce fichier, ajouté spécifiquement ici car ce tirage,
 * contrairement à `closeSession`, peut committer un gagnant qui n'a
 * reçu AUCUN vote, donc sans le signal "quelqu'un tient à ce jeu" que
 * fournirait un vote existant).
 *
 * `createdViaRoulette` n'est JAMAIS modifié ici — ce champ décrit
 * l'ORIGINE de création de la soirée (formulaire classique vs résultat
 * de roue), jamais son mode de décision du jeu ; une soirée créée
 * classiquement dont le jeu est ensuite tiré au sort reste une soirée
 * créée classiquement. Conséquence directe : `resolveEligibleMentions`
 * (session-announce.ts) continue de lire la catégorie de préférence
 * "SESSION", jamais "ROULETTE", pour les mentions de l'annonce éditée —
 * aucune bascule de catégorie de notification à gérer ici.
 */
export async function drawSessionGame(
  sessionId: string,
  actorId: string
): Promise<DrawSessionGameOutcome> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      proposals: {
        include: { game: true, votes: { include: { user: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!session) return { kind: "not_found" };
  if (session.createdById !== actorId) return { kind: "not_creator" };
  if (session.status !== "VOTING") {
    return { kind: "not_voting", status: session.status, decidedGameId: session.decidedGameId };
  }

  const availability = await getProposalAvailability(
    session.date,
    session.proposals.map((p) => p.game)
  );
  const jouableProposals = session.proposals.filter((p) => availability.get(p.gameId)?.jouable);
  if (jouableProposals.length === 0) return { kind: "no_eligible_game" };

  const winner = jouableProposals[Math.floor(Math.random() * jouableProposals.length)];
  const candidateGameIds = jouableProposals.map((p) => p.gameId);
  const announceViaBot = session.announceViaBot;

  const committed = await prisma.$transaction(async (tx) => {
    // Protection contre un retrait de proposition survenu APRÈS le
    // tirage ci-dessus mais AVANT ce commit (voir le commentaire de
    // fonction) — jamais un jeu retiré entre-temps annoncé comme retenu.
    const stillProposed = await tx.proposal.findUnique({
      where: { sessionId_gameId: { sessionId, gameId: winner.gameId } },
      select: { id: true },
    });
    if (!stillProposed) return false;

    const claim = await tx.session.updateMany({
      where: { id: sessionId, status: "VOTING" },
      data: { status: "SCHEDULED", decidedGameId: winner.gameId, decidedTime: session.date },
    });
    if (claim.count !== 1) return false;

    if (announceViaBot) {
      await enqueueSessionAnnounceUpdate(sessionId, tx);
      await enqueueSessionResultThreadSummary(sessionId, tx);
      await enqueueSessionValidated(sessionId, tx);
    }
    return true;
  });

  if (!committed) {
    const fresh = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, decidedGameId: true },
    });
    // Ligne disparue entre-temps (suppression concurrente) — traité
    // comme "plus rien à décider ici", jamais une erreur non gérée.
    if (!fresh) return { kind: "not_found" };
    return { kind: "not_voting", status: fresh.status, decidedGameId: fresh.decidedGameId };
  }

  // XP participation — même définition que `closeSession` : les VRAIS
  // votants de la proposition retenue, jamais fabriqués (contrairement à
  // `spinRoulette`/`createSessionFromRouletteAction`, qui créent des
  // votes synthétiques pour une proposition qui n'existait pas avant —
  // ici la proposition et ses votes réels existaient déjà). Peut être
  // une liste vide (jeu tiré sans le moindre vote) — aucun XP à
  // attribuer dans ce cas, jamais une erreur.
  for (const vote of winner.votes) {
    await awardXp(vote.userId, "PARTICIPATE", sessionId, XP_AMOUNTS.PARTICIPATE);
    await checkSessionsParticipatedBadges(vote.userId);
  }

  return { kind: "drawn", winnerGameId: winner.gameId, candidateGameIds };
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

/**
 * Annulation manuelle (créateur) — historiquement AUCUNE annonce Discord
 * (contrairement à la clôture F6) : décision produit inchangée, une
 * annulation manuelle reste silencieuse côté webhook. Chemin bot : seule
 * exception délibérée — l'annonce principale reste affichée en permanence
 * dans #🎮-soirées (jamais republiée/supprimée), donc une annulation DOIT
 * l'éditer pour refléter l'état réel plutôt que de laisser un message
 * "Soirée" visiblement obsolète au public du salon.
 */
export async function cancelSession(sessionId: string): Promise<void> {
  // Mutation ET enqueue bot dans LA MÊME transaction — même raisonnement
  // que `createSession`/`editSessionAction`/`closeSession` (revue ciblée
  // de #99) : un crash entre les deux laisserait la session annulée en
  // base sans jamais éditer l'annonce Discord, qui resterait affichée
  // "en cours de vote" indéfiniment, en silence.
  await prisma.$transaction(async (tx) => {
    const updated = await tx.session.update({
      where: { id: sessionId },
      data: { status: "CANCELLED" },
      select: { announceViaBot: true },
    });
    if (updated.announceViaBot) {
      await enqueueSessionAnnounceUpdate(sessionId, tx);
    }
  });
  await closeThreadOnEndSafely("session", sessionId);
}

export async function markSessionDone(
  sessionId: string
): Promise<{ unlockedAchievements: GroupAchievement[] }> {
  // Chantier nettoyage réel du stockage (V2, suite) — la transition de
  // statut ET l'incrément des compteurs durables de "Stats du groupe"
  // (Home, `GroupSessionStats`/`GroupGameStat`) ET la ligne durable du
  // trophée "Réguliers" (`GroupActiveWeek`) sont posés dans LA MÊME
  // transaction : le `updateMany` conditionnel sur `status: "SCHEDULED"`
  // sérialise déjà les appels concurrents à `markSessionDone` pour une
  // même soirée (verrou de ligne Postgres, un seul appelant obtient
  // `count: 1`) — aucun de ces trois écrits ne peut donc jamais s'exécuter
  // deux fois pour la même soirée, ni être posé alors que la transition
  // elle-même a échoué/roll-back. Jamais retouchés par la purge
  // (`retention.ts`) : aucune re-dérivation depuis des lignes `Session`
  // vivantes après coup, donc aucun double comptage possible entre
  // soirées encore présentes et soirées déjà purgées.
  // Multi-communautés (PR9) : ces compteurs sont ceux de la communauté de la soirée
  // (`null` = communauté par défaut). Écritures dérivées d'une ligne existante :
  // elles héritent de la soirée, jamais de l'acteur (accès direct assumé, `tx`).
  const defaultCommunityId = await getDefaultCommunityId();
  const decided = await prisma.$transaction(async (tx) => {
    const result = await tx.session.updateMany({
      where: { id: sessionId, status: "SCHEDULED" },
      data: { status: "DONE" },
    });
    if (result.count === 0) return null;

    const updated = await tx.session.findUnique({
      where: { id: sessionId },
      select: { decidedGameId: true, date: true, announceViaBot: true, communityId: true },
    });
    const communityId = updated?.communityId ?? defaultCommunityId;
    // Fin de session : annonce et MP d'invitation ÉDITÉS (statut terminé), sans nouveau message.
    if (updated?.announceViaBot) await enqueueSessionAnnounceUpdate(sessionId, tx);

    await tx.groupSessionStats.upsert({
      where: { communityId },
      create: { communityId, totalSessionsPlayed: 1 },
      update: { totalSessionsPlayed: { increment: 1 } },
    });
    if (updated?.decidedGameId) {
      await tx.groupGameStat.upsert({
        where: { communityId_gameId: { communityId, gameId: updated.decidedGameId } },
        create: { communityId, gameId: updated.decidedGameId, playCount: 1 },
        update: { playCount: { increment: 1 } },
      });
    }
    if (updated?.date) {
      // Upsert idempotent — plusieurs soirées la même semaine calendaire
      // ne créent qu'UNE ligne (`update: {}`, jamais de compteur à
      // incrémenter ici, seule l'EXISTENCE de la semaine compte pour le
      // trophée "Réguliers", voir group-achievements.ts).
      const weekStart = getWeekStart(updated.date);
      await tx.groupActiveWeek.upsert({
        where: { communityId_weekStart: { communityId, weekStart } },
        create: { communityId, weekStart },
        update: {},
      });
    }

    return updated;
  });
  if (!decided) return { unlockedAchievements: [] };

  // Archivage immédiat du fil (drapeau DISCORD_THREAD_CLOSE_ON_END_ENABLED,
  // éteint par défaut) — voir src/lib/thread-close-on-end.ts.
  await closeThreadOnEndSafely("session", sessionId);

  // PR 5/9 — ouvre la fenêtre de vote de superlatifs entre potes dès que
  // la session passe DONE (voir src/lib/superlative-voting.ts).
  await openSuperlativeVotingWindow(sessionId, decided.decidedGameId ?? null);

  // Sprint 3 suite — les trophées de groupe ("clôture" = soirée DONE) se
  // vérifient à chaque appel, manuel (bouton créateur) ou automatique
  // (cron `closeOverdueScheduledSessions`) : les deux passent par cette
  // même fonction, aucun appelant n'a besoin de dupliquer l'appel.
  const unlockedAchievements = await checkGroupAchievements(decided.communityId ?? defaultCommunityId);

  return { unlockedAchievements };
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

/**
 * Bonus F6 : renvoyer l'annonce Discord d'une session déjà clôturée —
 * poste TOUJOURS un nouveau message webhook, jamais une édition. Pas de
 * sens pour une session `announceViaBot` : ce chemin édite une annonce
 * persistante unique, jamais n'en republie une nouvelle (voir le
 * commentaire de fichier de `session-announce.ts`) — refus explicite
 * plutôt qu'un comportement silencieusement incohérent.
 */
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
  if (session.announceViaBot) return { ok: false, error: "non_disponible_pour_les_sessions_bot" };

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
