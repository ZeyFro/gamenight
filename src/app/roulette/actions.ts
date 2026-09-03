"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRouletteSessionSchema } from "@/lib/validations";
import { parseDateAndTime } from "@/lib/wallclock";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkSessionsCreatedBadges } from "@/lib/badges";
import { announceSessionResult } from "@/lib/discord-announce";

/**
 * Créer la soirée depuis le résultat de la roue (Sprint 3, /roulette).
 * Contrairement à `createSession` (statut `VOTING`, vote à ouvrir), la
 * roue a déjà décidé le jeu — la session est créée directement
 * `SCHEDULED` avec `decidedGameId` déjà posé, exactement l'état dans
 * lequel `closeSession` laisse une session normale une fois le vote
 * clôturé (même invariant, cf. `src/lib/sessions.ts`). Un `Proposal` +
 * des `Vote` sont créés pour le jeu gagnant, un par participant : ça fait
 * fonctionner SANS AUCUNE modification tout ce qui lit "les votants du
 * jeu gagnant" ailleurs dans l'app (compteur "joueurs inscrits" sur
 * `/`/`/sessions`, saisie des résultats, vote de superlatifs...).
 *
 * Annonce Discord : `announceSessionResult` (le même embed "🎮 Soirée
 * validée : [Jeu]" que la clôture normale d'un vote) plutôt que
 * `announceSessionCreated` ("📣 Nouvelle soirée" invite à voter) — un
 * jeu déjà décidé par la roue n'a rien à faire voter, "soirée validée"
 * est le message qui correspond réellement à ce qui vient de se passer.
 */
export async function createSessionFromRouletteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "createSessionFromRoulette")) {
    redirect("/roulette?error=rate_limited");
  }

  const input = createRouletteSessionSchema.safeParse({
    gameId: String(formData.get("gameId") ?? ""),
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    participantIds: formData.getAll("participantId").map(String),
  });
  if (!input.success) redirect("/roulette?error=donnees_invalides");
  const { gameId, date: dateStr, time: timeStr, participantIds } = input.data;

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) redirect("/roulette?error=donnees_invalides");

  // Ne garde que des ids qui correspondent réellement à un user existant
  // (même garde défensive que `createSession`/ping sélectif) — le créateur
  // est toujours inclus même s'il a été retiré côté client par erreur.
  const validUsers = await prisma.user.findMany({
    where: { id: { in: participantIds } },
    select: { id: true },
  });
  const finalParticipantIds = [...new Set([user.id, ...validUsers.map((u) => u.id)])];
  if (finalParticipantIds.length < 2) redirect("/roulette?error=donnees_invalides");

  const date = parseDateAndTime(dateStr, timeStr);

  const session = await prisma.session.create({
    data: {
      date,
      status: "SCHEDULED",
      decidedGameId: gameId,
      decidedTime: date,
      createdById: user.id,
      createdViaRoulette: true,
      notifiedUserIds: finalParticipantIds,
    },
  });

  const proposal = await prisma.proposal.create({
    data: { sessionId: session.id, gameId, proposedById: user.id },
  });
  await prisma.vote.createMany({
    data: finalParticipantIds.map((userId) => ({ proposalId: proposal.id, userId })),
  });

  const xpResult = await awardXp(
    user.id,
    "CREATE_SESSION",
    session.id,
    XP_AMOUNTS.CREATE_SESSION
  );
  const badgeUnlocked = await checkSessionsCreatedBadges(user.id);

  const winner = await prisma.proposal.findUniqueOrThrow({
    where: { id: proposal.id },
    include: { game: true, votes: { include: { user: true } } },
  });
  const announceResult = await announceSessionResult(session, winner, false);

  revalidatePath("/sessions");
  revalidatePath("/roulette");

  const params = new URLSearchParams();
  if (!announceResult.ok) params.set("discord", "echec");
  if (badgeUnlocked) params.set("celebrate", "badge");
  else if (xpResult.leveledUp) params.set("celebrate", "levelup");
  const query = params.toString();
  redirect(`/sessions/${session.id}${query ? `?${query}` : ""}`);
}
