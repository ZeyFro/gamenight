"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getScopedPrisma, withCommunity } from "@/lib/community-scoped-client";
import { creationMemberUserWhere, isCommunityIsolationEnabled, resolveActiveCommunityId } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createRouletteSessionSchema,
  createRouletteSchema,
  submitRouletteEntriesSchema,
} from "@/lib/validations";
import { parseDateAndTime, wallClockNow } from "@/lib/wallclock";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkSessionsCreatedBadges } from "@/lib/badges";
import { announceSessionResult } from "@/lib/discord-announce";
import { isRealDiscordFailure, type PostToDiscordResult } from "@/lib/discord";
import { announceRouletteCreated } from "@/lib/discord-roulette";
import { isRouletteProposalOpen, spinRoulette } from "@/lib/roulette";
import { createRouletteResultSession } from "@/lib/sessions";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";

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
 * UNIQUEMENT pour un tournoi/une session restée sur le webhook
 * (`announceViaBot: false`) — bug remonté en production : cette création
 * ignorait jusqu'ici TOTALEMENT `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`,
 * appelait donc TOUJOURS ce webhook même la catégorie bot activée. Corrigé
 * via `createRouletteResultSession` (src/lib/sessions.ts), chemin partagé
 * avec `spinRoulette` (mode async).
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
    where: { id: { in: participantIds }, ...(await creationMemberUserWhere(user.id)) },
    select: { id: true },
  });
  const finalParticipantIds = [...new Set([user.id, ...validUsers.map((u) => u.id)])];
  if (finalParticipantIds.length < 2) redirect("/roulette?error=donnees_invalides");

  const date = parseDateAndTime(dateStr, timeStr);

  const { session, announceViaBot, proposalId } = await createRouletteResultSession({
    date,
    decidedGameId: gameId,
    decidedTime: date,
    createdById: user.id,
    notifiedUserIds: finalParticipantIds,
  });

  const xpResult = await awardXp(user.id, session.communityId,
    "CREATE_SESSION",
    session.id,
    XP_AMOUNTS.CREATE_SESSION
  );
  const badgeUnlocked = await checkSessionsCreatedBadges(user.id, session.communityId);

  // Jamais les deux transports à la fois — voir `createRouletteResultSession`
  // (l'enqueue bot a déjà réussi, atomiquement avec la création de la
  // session, si `announceViaBot` est vrai).
  let announceResult: PostToDiscordResult = { ok: true };
  if (!announceViaBot) {
    const winner = await prisma.proposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { game: true, votes: { include: { user: true } } },
    });
    announceResult = await announceSessionResult(session, winner, false);
  }

  revalidatePath("/sessions");
  revalidatePath("/roulette");

  const params = new URLSearchParams();
  if (isRealDiscordFailure(announceResult)) params.set("discord", "echec");
  if (badgeUnlocked) params.set("celebrate", "badge");
  else if (xpResult.leveledUp) params.set("celebrate", "levelup");
  const query = params.toString();
  redirect(`/sessions/${session.id}${query ? `?${query}` : ""}`);
}

/**
 * Créer une roulette ASYNCHRONE (FIX Sprint 3) — contrairement au mode
 * instant ci-dessus, aucun jeu n'est décidé ici : juste un créneau, une
 * deadline de proposition, et la liste des potes invités
 * (`Roulette.notifiedUserIds`, même type que `Session.notifiedUserIds`).
 * Chaque invité propose ses 2 jeux séparément sur `/roulette/[id]`
 * (`submitRouletteEntriesAction`), potentiellement à des moments
 * différents — c'est tout le point du mode async.
 */
export async function createRouletteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "createRoulette")) {
    redirect("/roulette?tab=creer&error=rate_limited");
  }

  const input = createRouletteSchema.safeParse({
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    deadlineOffset: String(formData.get("deadlineOffset") ?? "1"),
    participantIds: formData.getAll("participantId").map(String),
  });
  if (!input.success) redirect("/roulette?tab=creer&error=donnees_invalides");
  const { date: dateStr, time: timeStr, deadlineOffset, participantIds } = input.data;

  const scheduledAt = parseDateAndTime(dateStr, timeStr);
  const deadline = new Date(scheduledAt.getTime() - Number(deadlineOffset) * 60 * 60 * 1000);
  if (deadline <= wallClockNow()) {
    redirect("/roulette?tab=creer&error=deadline_trop_proche");
  }

  // Même garde défensive que `createSession`/ping sélectif — le créateur
  // est toujours inclus même s'il a été retiré côté client par erreur.
  const validUsers = await prisma.user.findMany({
    where: { id: { in: participantIds }, ...(await creationMemberUserWhere(user.id)) },
    select: { id: true },
  });
  const finalParticipantIds = [...new Set([user.id, ...validUsers.map((u) => u.id)])];

  const scopedDb = await getScopedPrisma(user.id);
  const communityId = isCommunityIsolationEnabled() ? await resolveActiveCommunityId(user.id) : null;
  if (isCommunityIsolationEnabled() && communityId === null) redirect("/roulette?tab=creer&error=donnees_invalides");
  const roulette = await scopedDb.roulette.create({
    data: {
      createdById: user.id,
      ...withCommunity(communityId),
      scheduledAt,
      deadline,
      notifiedUserIds: finalParticipantIds,
    },
  });

  await announceRouletteCreated(roulette, user);

  revalidatePath("/roulette");
  redirect(`/roulette/${roulette.id}`);
}

/**
 * Enregistre les 2 jeux proposés par l'utilisateur courant (jamais un
 * autre — pas de `userId` pris depuis `formData`). Remplace toute
 * proposition précédente (`deleteMany` puis `createMany` en transaction) :
 * un pote peut revenir changer d'avis tant que la deadline n'est pas
 * passée, `isRouletteProposalOpen` fait le même garde-fou que
 * `isVotingOpen` pour une session classique.
 */
export async function submitRouletteEntriesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "submitRouletteEntries")) return;

  const input = submitRouletteEntriesSchema.safeParse({
    rouletteId: String(formData.get("rouletteId") ?? ""),
    gameIds: formData.getAll("gameId").map(String),
  });
  if (!input.success) return;
  const { rouletteId, gameIds } = input.data;

  const scopedDb = await getScopedPrisma(user.id);
  const roulette = await scopedDb.roulette.findUnique({
    where: { id: rouletteId },
    select: { status: true, deadline: true, createdById: true, notifiedUserIds: true },
  });
  if (!roulette || !isRouletteProposalOpen(roulette)) return;
  // Confidentialité — seuls le créateur et les invités (`notifiedUserIds`)
  // peuvent proposer des jeux sur cette roulette, jamais un pote non
  // invité qui aurait deviné/reçu l'id.
  const invitedIds = resolveNotifiedUserIds(roulette.notifiedUserIds) ?? [];
  if (roulette.createdById !== user.id && !invitedIds.includes(user.id)) return;

  const games = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    select: { id: true },
  });
  if (games.length !== 2) return;

  await prisma.$transaction([
    prisma.rouletteEntry.deleteMany({ where: { rouletteId, userId: user.id } }),
    prisma.rouletteEntry.createMany({
      data: gameIds.map((gameId) => ({ rouletteId, userId: user.id, gameId })),
    }),
  ]);

  revalidatePath(`/roulette/${rouletteId}`);
}

/**
 * Déclenchement manuel du tirage par le créateur ("à la deadline ou
 * manuellement", spec) — n'attend pas le cron. `spinRoulette` gère déjà
 * l'annulation silencieuse si moins de 2 participants ont proposé, rien
 * de spécifique à refaire ici.
 */
export async function forceSpinRouletteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "forceSpinRoulette")) return;

  const rouletteId = String(formData.get("rouletteId") ?? "");
  if (!rouletteId) return;

  const scopedDb = await getScopedPrisma(user.id);
  const roulette = await scopedDb.roulette.findUnique({
    where: { id: rouletteId },
    select: { createdById: true, status: true },
  });
  if (!roulette || roulette.createdById !== user.id || roulette.status !== "OPEN") return;

  await spinRoulette(rouletteId);

  revalidatePath(`/roulette/${rouletteId}`);
  revalidatePath("/roulette");
}
