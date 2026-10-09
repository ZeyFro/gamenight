"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { awardXp } from "@/lib/xp-actions";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkRevancheAfterSessionResults } from "@/lib/revanche";
import { completeWeeklyChallenge } from "@/lib/weekly-challenges";
import { detectDebts } from "@/lib/debts";
import { checkRateLimit } from "@/lib/rate-limit";

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

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
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

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
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
  // PR B : l'XP de résultat est créditée dans la communauté de la soirée.
  const xpCommunityId = await statsCommunityIdForSession(session.communityId);
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

    // Chantier nettoyage réel du stockage (V2, suite) — `gameId`/
    // `gameName`/`sessionDate` dénormalisés ICI, où `session.decidedGame`
    // est déjà connu (même philosophie que `Debt.reason`, déjà figé au
    // même endroit juste en dessous) : ce résumé doit rester lisible même
    // après la purge de la soirée, jamais recalculé via une jointure vers
    // une ligne `Session` qui pourra disparaître.
    await prisma.sessionResult.create({
      data: {
        sessionId,
        userId: participantId,
        placement,
        gameId: session.decidedGameId,
        gameName: session.decidedGame?.name ?? null,
        sessionDate: session.date,
      },
    });

    let xpResult: { leveledUp: boolean } | null = null;
    if (isCoop) {
      xpResult = await awardXp(participantId, "SESSION_RESULT", sessionId, XP_AMOUNTS.COOP_BONUS, {
        communityId: xpCommunityId,
      });
    } else if (placement) {
      xpResult = await awardXp(
        participantId,
        "SESSION_RESULT",
        sessionId,
        placementAmounts[placement],
        { communityId: xpCommunityId }
      );
    }

    if (participantId === user.id) {
      ownPlacement = placement;
      ownLeveledUp = xpResult?.leveledUp ?? false;
    }
  }

  if (session.decidedGame) {
    await detectDebts(sessionId, absentIds, session.decidedGame.name, session.date, session.communityId);
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
