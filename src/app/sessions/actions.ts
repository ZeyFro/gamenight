"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { resolveSessionSchedule } from "@/lib/session-schedule";
import { announceSessionCreated } from "@/lib/discord-session-created";
import { announceSessionModified } from "@/lib/discord-session-modified";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import {
  cancelSession,
  closeSession,
  isVotingOpen,
  markSessionDone,
  resendSessionAnnouncement,
} from "@/lib/sessions";
import {
  finalizeSuperlativeVotingIfDue,
  forceFinalizeSuperlativeVoting,
  getWinningProposalParticipants,
} from "@/lib/superlative-voting";
import { submitPronostic, getPronosticEligibleUsers } from "@/lib/pronostics";
import { placeBet } from "@/lib/xp-bets";
import { checkSessionsCreatedBadges, checkVotesCastBadges } from "@/lib/badges";
import { checkRevancheAfterSessionResults } from "@/lib/revanche";
import { completeWeeklyChallenge } from "@/lib/weekly-challenges";
import { detectDebts } from "@/lib/debts";
import { parseReminderTimingsFromFormData } from "@/lib/reminder-timings";
import { parseNotifyRecipientsFromFormData } from "@/lib/notify-recipients";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import {
  createSessionSchema,
  editSessionSchema,
  pronosticSchema,
  sessionGameRefSchema,
  sessionProposalRefSchema,
  superlativeVoteEntrySchema,
  toggleVoteSchema,
  VALIDATION_ERROR_KEY,
  xpBetSchema,
} from "@/lib/validations";

export async function createSession(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "createSession")) {
    redirect(`/sessions?error=${RATE_LIMIT_ERROR_KEY}`);
  }

  const input = createSessionSchema.safeParse({
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    notifyUserIds: parseNotifyRecipientsFromFormData(formData),
  });
  if (!input.success) {
    redirect(`/sessions?error=${VALIDATION_ERROR_KEY}`);
  }
  const { date: dateStr, time: timeStr, notifyUserIds } = input.data;

  const schedule = resolveSessionSchedule({
    dateStr,
    timeStr,
    deadlineDateStr: String(formData.get("deadlineDate") ?? "").trim(),
    deadlineTimeStr: String(formData.get("deadlineTime") ?? "").trim(),
    deadlineOffset: String(formData.get("deadlineOffset") ?? "6"),
  });
  if (!schedule.ok) {
    redirect(`/sessions?error=${schedule.error}`);
  }
  const { date, votingDeadline, deadlineAdjusted } = schedule;

  const customReminderMessage =
    String(formData.get("customReminderMessage") ?? "").trim() || null;
  const reminderTimings = parseReminderTimingsFromFormData(formData);
  // Ne garde que des ids qui correspondent réellement à un user existant —
  // la liste vient de checkboxes générées depuis une vraie liste de potes,
  // mais une requête manipulée pourrait envoyer un id périmé/inventé ; on
  // filtre silencieusement plutôt que de faire échouer toute la création
  // pour un seul destinataire invalide.
  const notifiedUserIds = notifyUserIds.length
    ? (
        await prisma.user.findMany({
          where: { id: { in: notifyUserIds } },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];

  const session = await prisma.session.create({
    data: {
      date,
      votingDeadline,
      customReminderMessage,
      reminderTimings,
      notifiedUserIds,
      createdById: user.id,
    },
  });

  const xpResult = await awardXp(
    user.id,
    "CREATE_SESSION",
    session.id,
    XP_AMOUNTS.CREATE_SESSION
  );
  const badgeUnlocked = await checkSessionsCreatedBadges(user.id);

  // Jeu pré-sélectionné depuis la fiche jeu ("Proposer une soirée avec ce
  // jeu") : on le propose directement, sans passer par le formulaire de
  // /sessions/[id]. Best-effort — un gameId invalide/déjà retiré ne doit
  // pas empêcher la création de la session.
  const preselectedGameId = String(formData.get("gameId") ?? "").trim();
  if (preselectedGameId) {
    try {
      await prisma.proposal.create({
        data: { sessionId: session.id, gameId: preselectedGameId, proposedById: user.id },
      });
    } catch {
      // Jeu inexistant, ou contrainte unique — on ignore, la session reste utilisable.
    }
  }

  const announceResult = await announceSessionCreated(session, user);

  revalidatePath("/sessions");

  const params = new URLSearchParams();
  if (deadlineAdjusted) params.set("deadline", "ajustee");
  if (!announceResult.ok) params.set("discord", "echec");
  // Confettis (Sprint 2 PR-B, U9) — badge prioritaire sur level up si les
  // deux se produisent au même moment (plus rare, mérite plus l'attention).
  if (badgeUnlocked) params.set("celebrate", "badge");
  else if (xpResult.leveledUp) params.set("celebrate", "levelup");
  const query = params.toString();
  redirect(`/sessions/${session.id}${query ? `?${query}` : ""}`);
}

/**
 * Modification du créneau d'une session existante — réservée au créateur,
 * seuls date/heure/deadline de vote sont éditables (le champ créateur, lui,
 * ne change jamais après coup). Mêmes règles de validation qu'à la
 * création (`resolveSessionSchedule`, mutualisé, pas dupliqué) : deadline
 * toujours strictement avant la session, ajustement auto si elle tombe
 * dans le passé, refus si la session elle-même devient trop proche.
 *
 * Restreint aux sessions encore VOTING ou SCHEDULED — modifier le créneau
 * d'une soirée déjà DONE ou CANCELLED n'a pas de sens (rien à reprogrammer).
 * Si la session était déjà décidée (`decidedTime` renseigné à la clôture,
 * simple copie de `date`), on le resynchronise avec la nouvelle date pour
 * ne pas laisser les deux champs diverger.
 */
export async function editSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "editSession")) return;

  const rawSessionId = String(formData.get("sessionId") ?? "");
  const input = editSessionSchema.safeParse({
    sessionId: rawSessionId,
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    deadlineDate: String(formData.get("deadlineDate") ?? "").trim(),
    deadlineTime: String(formData.get("deadlineTime") ?? "").trim(),
  });
  if (!input.success) {
    // `sessionId` fait partie du schéma (donc potentiellement absent ici),
    // mais on ne peut rediriger vers `/sessions/[id]` sans lui — repli sur
    // la valeur brute du formulaire pour ne pas perdre l'utilisateur en
    // silence sur un cas qui ne devrait de toute façon jamais arriver via
    // le modal d'édition (champs `required`).
    if (rawSessionId) {
      redirect(`/sessions/${rawSessionId}?error=${VALIDATION_ERROR_KEY}`);
    }
    return;
  }
  const {
    sessionId,
    date: dateStr,
    time: timeStr,
    deadlineDate: deadlineDateStr,
    deadlineTime: deadlineTimeStr,
  } = input.data;

  const existing = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!existing || existing.createdById !== user.id) return;
  if (existing.status === "DONE" || existing.status === "CANCELLED") return;

  const schedule = resolveSessionSchedule({
    dateStr,
    timeStr,
    deadlineDateStr,
    deadlineTimeStr,
    deadlineOffset: "6",
  });
  if (!schedule.ok) {
    redirect(`/sessions/${sessionId}?error=${schedule.error}`);
  }
  const { date, votingDeadline, deadlineAdjusted } = schedule;

  const previous = { date: existing.date, votingDeadline: existing.votingDeadline };

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      date,
      votingDeadline,
      ...(existing.decidedTime ? { decidedTime: date } : {}),
    },
  });

  const announceResult = await announceSessionModified(
    { id: sessionId, date, votingDeadline },
    previous,
    user
  );

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");

  const params = new URLSearchParams();
  if (deadlineAdjusted) params.set("deadline", "ajustee");
  if (!announceResult.ok) params.set("discord", "echec");
  const query = params.toString();
  redirect(`/sessions/${sessionId}${query ? `?${query}` : ""}`);
}

export async function proposeGame(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "proposeGame")) return;

  const input = sessionGameRefSchema.safeParse({
    sessionId: String(formData.get("sessionId") ?? ""),
    gameId: String(formData.get("gameId") ?? ""),
  });
  if (!input.success) return;
  const { sessionId, gameId } = input.data;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true, votingDeadline: true },
  });
  if (!session || !isVotingOpen(session)) return;

  try {
    await prisma.proposal.create({
      data: { sessionId, gameId, proposedById: user.id },
    });
  } catch {
    // Contrainte unique (sessionId, gameId) : déjà proposé, on ignore.
  }

  revalidatePath(`/sessions/${sessionId}`);
}

export interface ToggleVoteResult {
  ok: boolean;
  error?: string;
}

/**
 * Renvoie un résultat (au lieu d'un simple `void`) depuis PR "Rate
 * limiting" : `VoteButton.tsx` fait une mise à jour optimiste avant
 * d'appeler cette action, elle doit pouvoir la défaire si la requête est
 * refusée (rate limit) plutôt que de laisser le bouton mentir sur l'état
 * réel du vote.
 */
export async function toggleVote(formData: FormData): Promise<ToggleVoteResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "toggleVote")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const input = toggleVoteSchema.safeParse({
    proposalId: String(formData.get("proposalId") ?? ""),
  });
  if (!input.success) return { ok: true };
  const { proposalId } = input.data;

  // Fix bug remonté (vote inter-session) — la session vient UNIQUEMENT de
  // `Proposal.sessionId`, jamais d'un champ transmis par le client (qui
  // n'existe plus, cf. `toggleVoteSchema`) : voter avec un `proposalId`
  // valide vote toujours sur SA propre session, impossible d'associer une
  // proposition d'une autre session (potentiellement fermée) en la
  // faisant passer pour ouverte.
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: {
      sessionId: true,
      session: { select: { status: true, date: true, votingDeadline: true } },
    },
  });
  if (!proposal || !isVotingOpen(proposal.session)) return { ok: true };
  const sessionId = proposal.sessionId;

  const existing = await prisma.vote.findUnique({
    where: { proposalId_userId: { proposalId, userId: user.id } },
  });

  if (existing) {
    await prisma.vote.delete({ where: { id: existing.id } });
  } else {
    await prisma.vote.create({ data: { proposalId, userId: user.id } });
    // sourceId = proposalId (pas l'id du Vote) : un aller-retour
    // vote/dévote/revote sur la MÊME proposition ne doit pas re-créditer
    // l'XP à chaque fois (la contrainte unique sur XpEvent l'empêche déjà
    // via awardXp) ; voter sur une AUTRE proposition, en revanche, reste
    // une nouvelle action légitime.
    await awardXp(user.id, "VOTE", proposalId, XP_AMOUNTS.VOTE);
    await checkVotesCastBadges(user.id);
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

/**
 * Retrait d'une proposition par son propre auteur — réservé à
 * `proposedById`, PAS au créateur de la session (qui gère la session dans
 * son ensemble via la suppression, mais n'a pas à retirer les propositions
 * des autres). Cascade automatique sur les votes via le schéma
 * (`onDelete: Cascade` sur `Vote.proposal`). Restreint au vote encore
 * ouvert, comme `proposeGame`/`toggleVote` : retirer une proposition après
 * clôture n'a pas d'effet utile (le gagnant est déjà figé dans
 * `Session.decidedGameId`, indépendant de la ligne `Proposal`).
 */
export async function withdrawProposalAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "withdrawProposal")) return;

  const input = sessionProposalRefSchema.safeParse({
    proposalId: String(formData.get("proposalId") ?? ""),
    sessionId: String(formData.get("sessionId") ?? ""),
  });
  if (!input.success) return;
  const { proposalId, sessionId } = input.data;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true, votingDeadline: true },
  });
  if (!session || !isVotingOpen(session)) return;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { sessionId: true, proposedById: true },
  });
  if (
    !proposal ||
    proposal.sessionId !== sessionId ||
    proposal.proposedById !== user.id
  )
    return;

  await prisma.proposal.delete({ where: { id: proposalId } });
  revalidatePath(`/sessions/${sessionId}`);
}

export async function closeSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "closeSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  // Clôture manuelle réservée au créateur — la clôture automatique
  // (deadline/heure dépassée, `closeSessionIfDue`) reste accessible à
  // tout le monde puisqu'elle se déclenche à la lecture, sans bouton.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  const result = await closeSession(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");

  // `result.discord === null` : clôture silencieuse (0 votant, cf.
  // `closeSession`) — pas un échec d'envoi, rien à signaler.
  if (result?.discord && !result.discord.ok) {
    redirect(`/sessions/${sessionId}?discord=echec`);
  }
}

export async function resendDiscordAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "resendDiscord")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const result = await resendSessionAnnouncement(sessionId);
  redirect(`/sessions/${sessionId}?discord=${result.ok ? "envoye" : "echec"}`);
}

export async function cancelSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "cancelSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  // Annulation manuelle réservée au créateur (même logique que la clôture
  // manuelle ci-dessus).
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  await cancelSession(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}

/**
 * Suppression définitive d'une session — réservée au créateur, jamais de
 * notification Discord (contrairement à l'annulation, qui reste annoncée
 * via F6 : supprimer, c'est du ménage silencieux, pas un événement à
 * communiquer au groupe). Cascade automatique via le schéma
 * (`onDelete: Cascade` sur Proposal → Session et Vote → Proposal) : les
 * propositions et votes liés disparaissent avec la session, et comme les
 * rappels F7 sont un simple champ JSON sur la ligne Session elle-même
 * (`remindersSent`), rien à nettoyer séparément pour eux.
 */
export async function deleteSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "deleteSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  await prisma.session.delete({ where: { id: sessionId } });
  revalidatePath("/sessions");
  redirect("/sessions");
}

export async function markSessionDoneAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "markSessionDone")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  // Pas explicitement listée dans l'alignement des permissions demandé
  // (qui nomme "modifier/supprimer/clôturer/annuler"), mais c'est la même
  // famille d'action de gestion du cycle de vie de la soirée que
  // clôturer/annuler — cohérent avec "le créateur gère sa soirée, les
  // autres votent" de restreindre celle-ci aussi.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  const { unlockedAchievements } = await markSessionDone(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  revalidatePath("/");

  // Sprint 3 suite — confettis pour le créateur qui vient de clôturer,
  // si ça a débloqué un trophée de groupe (même mécanique `?celebrate=`
  // que badge/level up ailleurs dans le chantier).
  if (unlockedAchievements.length > 0) {
    redirect(`/sessions/${sessionId}?celebrate=achievement`);
  }
}

/**
 * Marque le défi hebdo de la semaine en cours comme complété par CETTE
 * soirée (Sprint 3 suite) — bouton créateur, sur une soirée `DONE`
 * uniquement. `completeWeeklyChallenge` fait toutes les vérifications
 * (défi pas déjà complété, soirée dans la bonne semaine) et l'attribution
 * XP/badge ; ici on ne fait que le contrôle de permission et rediriger
 * avec `?celebrate=badge` si LE créateur (l'utilisateur qui vient de
 * cliquer, seul spectateur de cette redirection) a débloqué "Challenger".
 */
export async function completeWeeklyChallengeAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "completeWeeklyChallenge")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  const { badgeUnlockedByUserId } = await completeWeeklyChallenge(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/");

  if (badgeUnlockedByUserId[user.id]) {
    redirect(`/sessions/${sessionId}?celebrate=badge`);
  }
}

/**
 * Saisie des résultats d'une soirée (Axe 2) — réservée au créateur, une
 * seule fois par session : dès qu'au moins une ligne `SessionResult`
 * existe pour cette session, un nouvel appel est un no-op. Choix assumé,
 * pas de ré-édition possible : un podium corrigé après coup pourrait
 * créditer une deuxième fois le bonus XP à un nouveau 1er sans jamais
 * retirer celui déjà attribué à l'ancien (`XpEvent` est un ledger
 * append-only, pas fait pour être annulé) — plutôt que de construire un
 * mécanisme de correction pour un pépin mineur sur une fonctionnalité
 * ludique, on verrouille la saisie après coup.
 *
 * Participants = users ayant voté pour la proposition **gagnante** — même
 * définition que l'XP `PARTICIPATE` attribué à la clôture (`closeSession`
 * dans src/lib/sessions.ts), volontairement unifiée pour n'avoir qu'une
 * seule notion de "présence" dans tout le chantier.
 *
 * Session `isCoop` (le jeu retenu, pas la session) : pas de podium, bonus
 * plat identique pour tous. Sinon, podium 1er/2e/3e facultatif — un
 * placement dupliqué côté client (protégé par le formulaire) est de toute
 * façon ignoré ici en ne retenant que la première occurrence rencontrée.
 */
export async function submitSessionResultsAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "submitSessionResults")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { decidedGame: true },
  });
  if (!session || session.createdById !== user.id) return;
  if (session.status !== "DONE" || !session.decidedGameId) return;

  const alreadySubmitted =
    (await prisma.sessionResult.count({ where: { sessionId } })) > 0;
  if (alreadySubmitted) return;

  const winningProposal = await prisma.proposal.findFirst({
    where: { sessionId, gameId: session.decidedGameId },
    select: { id: true },
  });
  if (!winningProposal) return;

  const participantVotes = await prisma.vote.findMany({
    where: { proposalId: winningProposal.id },
    select: { userId: true },
  });
  if (participantVotes.length === 0) return;

  const isCoop = session.decidedGame?.isCoop ?? false;
  const placementAmounts: Record<number, number> = {
    1: XP_AMOUNTS.PODIUM_1ST,
    2: XP_AMOUNTS.PODIUM_2ND,
    3: XP_AMOUNTS.PODIUM_3RD,
  };
  const usedPlacements = new Set<number>();
  // Confettis (Sprint 2 PR-B, U9) — seule la place/le level up DU CRÉATEUR
  // (le seul à voir la redirection de cette action) compte ici, jamais
  // celle d'un autre participant : `?celebrate=win` doit refléter une
  // victoire vécue par l'utilisateur qui regarde son écran, pas un
  // événement arrivé à quelqu'un d'autre.
  let ownPlacement: number | null = null;
  let ownLeveledUp = false;
  // Dettes/gage (Sprint 3 suite) — un voteur non coché "présent" ci-dessous
  // n'a ni `SessionResult` ni XP : il a voté mais n'est pas venu.
  const absentIds: string[] = [];

  for (const { userId: participantId } of participantVotes) {
    const present = formData.get(`present-${participantId}`) === "1";
    if (!present) {
      absentIds.push(participantId);
      continue;
    }

    let placement: number | null = null;

    if (!isCoop) {
      const raw = String(formData.get(`placement-${participantId}`) ?? "").trim();
      const parsed = raw ? Number(raw) : null;
      const candidate = parsed && [1, 2, 3].includes(parsed) ? parsed : null;
      placement = candidate && !usedPlacements.has(candidate) ? candidate : null;
      if (placement) usedPlacements.add(placement);
    }

    await prisma.sessionResult.create({
      data: { sessionId, userId: participantId, placement },
    });

    let xpResult: { leveledUp: boolean } | null = null;
    if (isCoop) {
      xpResult = await awardXp(participantId, "SESSION_RESULT", sessionId, XP_AMOUNTS.COOP_BONUS);
    } else if (placement) {
      xpResult = await awardXp(
        participantId,
        "SESSION_RESULT",
        sessionId,
        placementAmounts[placement]
      );
    }

    if (participantId === user.id) {
      ownPlacement = placement;
      ownLeveledUp = xpResult?.leveledUp ?? false;
    }
  }

  if (session.decidedGame) {
    await detectDebts(sessionId, absentIds, session.decidedGame.name, session.date);
  }

  // FEATURE 3 (revanche auto) — best-effort, jamais bloquant pour la
  // saisie des résultats elle-même (même philosophie que
  // `createNotification`, qui avale déjà ses propres erreurs).
  await checkRevancheAfterSessionResults(sessionId);

  revalidatePath(`/sessions/${sessionId}/resultats`);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/");
  const celebrate = ownPlacement === 1 ? "win" : ownLeveledUp ? "levelup" : null;
  redirect(
    `/sessions/${sessionId}/resultats${celebrate ? `?celebrate=${celebrate}` : ""}`
  );
}

/**
 * Vote de superlatifs entre potes (PR 5/9, version light — remplace la
 * saisie de stats chiffrées initialement prévue). Un seul vote par user
 * par session, verrouillé dès soumission — même rationale que
 * `submitSessionResultsAction` : `XpEvent` est un ledger append-only, pas
 * de correction possible après coup.
 *
 * Formulaire tout-ou-rien : chaque catégorie active doit avoir un vote
 * valide (pour un participant autre que soi-même) sinon rien n'est
 * enregistré — pas de vote partiel silencieux.
 */
export async function submitSuperlativeVotesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "submitSuperlativeVotes")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      decidedGameId: true,
      superlativeVotingClosed: true,
    },
  });
  if (!session || session.status !== "DONE" || !session.decidedGameId) return;
  if (session.superlativeVotingClosed) return;

  const participants = await getWinningProposalParticipants(
    sessionId,
    session.decidedGameId
  );
  const isParticipant = participants.some((p) => p.id === user.id);
  if (!isParticipant) return;

  const alreadyVoted =
    (await prisma.superlativeVote.count({
      where: { sessionId, voterUserId: user.id },
    })) > 0;
  if (alreadyVoted) return;

  const categories = await prisma.superlativeCategory.findMany({
    where: { active: true },
  });
  if (categories.length === 0) return;

  const participantIds = new Set(participants.map((p) => p.id));

  const votes: {
    sessionId: string;
    categoryId: string;
    voterUserId: string;
    votedForUserId: string;
  }[] = [];
  for (const category of categories) {
    const entry = superlativeVoteEntrySchema.safeParse({
      categoryId: category.id,
      votedForUserId: String(formData.get(`vote-${category.id}`) ?? ""),
    });
    if (
      !entry.success ||
      entry.data.votedForUserId === user.id ||
      !participantIds.has(entry.data.votedForUserId)
    ) {
      // Formulaire incomplet/invalide (ou tentative de voter pour
      // soi-même) : on rejette tout, pas de vote partiel.
      return;
    }
    votes.push({
      sessionId,
      categoryId: category.id,
      voterUserId: user.id,
      votedForUserId: entry.data.votedForUserId,
    });
  }

  await prisma.superlativeVote.createMany({ data: votes });

  await finalizeSuperlativeVotingIfDue(sessionId);

  revalidatePath(`/sessions/${sessionId}/vote-superlatifs`);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  redirect(`/sessions/${sessionId}/vote-superlatifs`);
}

/**
 * Bouton créateur "Forcer la clôture des votes maintenant" — ignore la
 * deadline de 24h et le "tout le monde a voté", pour ne pas attendre si
 * tout le groupe est déjà là.
 */
export async function forceCloseSuperlativeVotingAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "forceCloseSuperlativeVoting")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  await forceFinalizeSuperlativeVoting(sessionId);

  revalidatePath(`/sessions/${sessionId}/vote-superlatifs`);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}

/**
 * Sprint 4 (Pronostics) — "🔮 Qui va carry ?" sur une soirée `SCHEDULED`.
 * Réservée aux mêmes participants que le vote de superlatifs à venir
 * (`getPronosticEligibleUsers`, même définition de présence que partout
 * ailleurs) — pas de sens à prédire pour une soirée à laquelle on ne
 * participe pas. 1 seul prono par personne (contrainte unique côté
 * `submitPronostic`, retombe silencieusement en cas de doublon).
 *
 * Infra (Sprint 5 suite, I2) — renvoie un résultat (au lieu d'un simple
 * `void`), même contrat que `ToggleVoteResult` : `PronosticForm` fait une
 * mise à jour optimiste avant d'appeler cette action, elle doit pouvoir
 * la défaire si la requête est refusée plutôt que de laisser affiché "Pronostic
 * enregistré" alors que rien n'a été enregistré côté serveur.
 */
export async function submitPronosticAction(formData: FormData): Promise<ToggleVoteResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "submitPronostic")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const input = pronosticSchema.safeParse({
    sessionId: String(formData.get("sessionId") ?? ""),
    predictedUserId: String(formData.get("predictedUserId") ?? ""),
  });
  if (!input.success) return { ok: true };
  const { sessionId, predictedUserId } = input.data;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, decidedGameId: true },
  });
  if (!session || session.status !== "SCHEDULED" || !session.decidedGameId) return { ok: true };

  const eligible = await getPronosticEligibleUsers(sessionId, session.decidedGameId);
  const eligibleIds = new Set(eligible.map((u) => u.id));
  if (!eligibleIds.has(user.id) || !eligibleIds.has(predictedUserId)) return { ok: true };
  if (predictedUserId === user.id) return { ok: true };

  await submitPronostic(sessionId, user.id, predictedUserId);
  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
}

/**
 * Sprint 4 (Paris d'XP) — "🎲 Paris" sur une soirée `SCHEDULED`, mêmes
 * participants éligibles que les pronostics ci-dessus. La validation des
 * bornes réelles (10-50% du solde, tranches de 10) vit dans `placeBet`
 * (src/lib/xp-bets.ts) — zod ne garantit ici que la forme.
 */
export async function placeBetAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "placeBet")) return;

  const input = xpBetSchema.safeParse({
    sessionId: String(formData.get("sessionId") ?? ""),
    targetUserId: String(formData.get("targetUserId") ?? ""),
    amount: String(formData.get("amount") ?? ""),
  });
  if (!input.success) return;
  const { sessionId, targetUserId, amount } = input.data;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, decidedGameId: true },
  });
  if (!session || session.status !== "SCHEDULED" || !session.decidedGameId) return;

  const eligible = await getPronosticEligibleUsers(sessionId, session.decidedGameId);
  const eligibleIds = new Set(eligible.map((u) => u.id));
  if (!eligibleIds.has(user.id) || !eligibleIds.has(targetUserId)) return;
  if (targetUserId === user.id) return;

  await placeBet(sessionId, user.id, targetUserId, amount);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/profil");
}
