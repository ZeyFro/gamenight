"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateBracket, declareWinner } from "@/lib/tournaments";
import { checkTournamentBadges } from "@/lib/badges";
import { postToDiscord, ACCENT_COLOR } from "@/lib/discord";
import { logger } from "@/lib/logger";
import {
  createTournamentSchema,
  declareWinnerSchema,
  idSchema,
  VALIDATION_ERROR_KEY,
} from "@/lib/validations";

/**
 * Sprint 5 (FEATURE 1, Tournois Bracket) — création : le créateur choisit
 * un jeu de la biblio commune (pas de restriction à sa biblio perso,
 * même logique que `createSession`/proposer un jeu — un tournoi concerne
 * tout le groupe) et le nombre de places (4/6/8, cf. `bracketSizeFor`).
 * Annonce Discord immédiate ("inscriptions ouvertes").
 */
export async function createTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "createTournament")) {
    redirect(`/tournois/creer?error=${VALIDATION_ERROR_KEY}`);
  }

  const input = createTournamentSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    gameId: String(formData.get("gameId") ?? ""),
    maxPlayers: String(formData.get("maxPlayers") ?? ""),
  });
  if (!input.success) {
    redirect(`/tournois/creer?error=${VALIDATION_ERROR_KEY}`);
  }
  const { name, gameId, maxPlayers } = input.data;

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { name: true } });
  if (!game) redirect(`/tournois/creer?error=${VALIDATION_ERROR_KEY}`);

  const tournament = await prisma.tournament.create({
    data: { name, gameId, maxPlayers, createdById: user.id },
  });

  const result = await postToDiscord({
    title: `🏆 Tournoi ${name} sur ${game.name} — inscriptions ouvertes !`,
    description: `${maxPlayers} places disponibles. Inscris-toi sur l'app !`,
    color: ACCENT_COLOR,
  });
  if (!result.ok) {
    logger.warn("tournaments", "Notif Discord création tournoi non envoyée.", {
      tournamentId: tournament.id,
    });
  }

  revalidatePath("/tournois");
  redirect(`/tournois/${tournament.id}`);
}

/** Inscription à un tournoi encore en `REGISTRATION`, tant que les places ne sont pas toutes prises. */
export async function registerForTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "registerForTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { participants: { select: { userId: true } } },
  });
  if (!tournament || tournament.status !== "REGISTRATION") return;
  if (tournament.participants.length >= tournament.maxPlayers) return;
  if (tournament.participants.some((p) => p.userId === user.id)) return;

  try {
    await prisma.tournamentParticipant.create({ data: { tournamentId, userId: user.id } });
  } catch {
    // Contrainte unique (déjà inscrit) : on ignore.
    return;
  }

  // Places pleines → lancement automatique du bracket (spec).
  if (tournament.participants.length + 1 >= tournament.maxPlayers) {
    await generateBracket(tournamentId);
  }

  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
}

/** Désinscription, réservée à soi-même, tant que le tournoi n'a pas encore démarré. */
export async function unregisterFromTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "unregisterFromTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true },
  });
  if (!tournament || tournament.status !== "REGISTRATION") return;

  await prisma.tournamentParticipant.deleteMany({ where: { tournamentId, userId: user.id } });
  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
}

/** Lancement anticipé par le créateur, avant que les places soient toutes prises. */
export async function launchTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "launchTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { createdById: true, status: true },
  });
  if (!tournament || tournament.createdById !== user.id || tournament.status !== "REGISTRATION") {
    return;
  }

  await generateBracket(tournamentId);
  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
}

/**
 * Déclare le vainqueur d'un match — réservé au créateur du tournoi ou à
 * l'un des deux joueurs (cf. `declareWinner`, src/lib/tournaments.ts, pour
 * le contrôle de permission). Vérifie les badges de TOUS les
 * participants si le tournoi vient de se terminer (le champion et les
 * demi-finalistes gagnent potentiellement "Champion de tournoi"/
 * "Gladiateur" en même temps que l'XP).
 */
export async function declareWinnerAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "declareWinner")) return;

  const input = declareWinnerSchema.safeParse({
    matchId: String(formData.get("matchId") ?? ""),
    winnerId: String(formData.get("winnerId") ?? ""),
  });
  if (!input.success) return;

  const result = await declareWinner(input.data.matchId, input.data.winnerId, user.id);
  if (!result.ok) return;

  if (result.tournamentDone) {
    await checkTournamentBadges(user.id);
  }

  const match = await prisma.tournamentMatch.findUnique({
    where: { id: input.data.matchId },
    select: { tournamentId: true },
  });
  if (match) {
    revalidatePath(`/tournois/${match.tournamentId}`);
    revalidatePath("/tournois");
    revalidatePath("/");
  }
}
