"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateBracket, declareWinner, buildBracketInTransaction } from "@/lib/tournaments";
import { checkTournamentBadges } from "@/lib/badges";
import { postToDiscord, ACCENT_COLOR } from "@/lib/discord";
import { resolveAbsoluteUrl } from "@/lib/app-url";
import { isTournamentAnnounceViaBotEnabled } from "@/lib/discord-bot-config";
import { enqueueTournamentCreationDeliveries } from "@/lib/tournament-announce";
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
 *
 * Fix bug remonté (annonce tournoi sans lien) — le message ne contenait
 * jusqu'ici aucun moyen d'atteindre `/tournois/{id}`, obligeant à
 * chercher la page à la main. `resolveAbsoluteUrl` (src/lib/app-url.ts)
 * dérive l'URL absolue depuis les variables que Vercel injecte
 * automatiquement (Production ET Preview, sans domaine codé en dur, sans
 * configuration côté projet). Si elle ne peut pas être résolue (dev
 * local, ou variables Vercel absentes — cas qui ne devrait jamais
 * arriver en déploiement réel), le lien est explicitement omis du
 * message (texte d'origine conservé, warning loggué) — jamais de lien
 * cassé (`.../undefined`) envoyé dans Discord.
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

  // Chantier annonces tournois (étend #99) — figé UNE SEULE FOIS ici,
  // jamais relu depuis l'env ensuite (voir le commentaire du champ dans
  // schema.prisma). Création du tournoi ET enqueue de l'intention de
  // notification bot dans LA MÊME transaction SQL (même raisonnement que
  // `createSession`, session-lifecycle.ts, revue ciblée #99) : un crash
  // entre les deux laisserait sinon un tournoi `announceViaBot=true`
  // orphelin, jamais annoncé, sans échec observable nulle part. Aucun
  // appel Discord dans cette transaction (seulement des écritures).
  const announceViaBot = isTournamentAnnounceViaBotEnabled();

  const tournament = await prisma.$transaction(async (tx) => {
    const created = await tx.tournament.create({
      data: { name, gameId, maxPlayers, createdById: user.id, announceViaBot },
    });
    if (announceViaBot) {
      await enqueueTournamentCreationDeliveries(created.id, tx);
    }
    return created;
  });

  // Webhook existant — UNIQUEMENT pour un tournoi resté sur ce chemin
  // (`announceViaBot=false`) : un tournoi bot a déjà enqueue son SEND ci-
  // dessus, jamais les deux transports à la fois (voir le commentaire de
  // fichier de `tournament-announce.ts`).
  if (!announceViaBot) {
    const tournamentUrl = resolveAbsoluteUrl(`/tournois/${tournament.id}`, {
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_URL: process.env.VERCEL_URL,
      VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    });
    if (!tournamentUrl) {
      logger.warn(
        "tournaments",
        "URL absolue indisponible (dev local ou variables Vercel absentes) — lien omis de l'annonce Discord.",
        { tournamentId: tournament.id }
      );
    }

    const result = await postToDiscord({
      title: `🏆 Tournoi ${name} sur ${game.name} — inscriptions ouvertes !`,
      description: tournamentUrl
        ? `${maxPlayers} places disponibles. Inscris-toi ici : ${tournamentUrl}`
        : `${maxPlayers} places disponibles. Inscris-toi sur l'app !`,
      color: ACCENT_COLOR,
    });
    if (!result.ok) {
      logger.warn("tournaments", "Notif Discord création tournoi non envoyée.", {
        tournamentId: tournament.id,
      });
    }
  }

  revalidatePath("/tournois");
  redirect(`/tournois/${tournament.id}`);
}

/**
 * Inscription à un tournoi encore en `REGISTRATION`, tant que les places
 * ne sont pas toutes prises.
 *
 * Fix bug remonté (concurrence tournois, round 2) — l'ancien code lisait
 * `status`/le nombre de places/la présence de l'utilisateur AVANT de
 * créer la ligne `TournamentParticipant`, sans le moindre verrou : deux
 * inscriptions concurrentes sur la toute dernière place passaient
 * toutes les deux ce contrôle (lu avant que l'autre n'ait committé),
 * dépassant `maxPlayers` — le participant en trop restait inscrit en
 * base mais silencieusement absent du bracket construit par
 * `generateBracket` (qui ne prend que les `bracketSize` premiers tirés).
 * Toute la vérification + l'écriture (et, le cas échéant, la
 * construction du bracket si cette inscription remplit la dernière
 * place) tournent maintenant dans UNE transaction qui verrouille D'ABORD
 * la ligne `Tournament` (`SELECT ... FOR UPDATE`, même verrou que
 * `unregisterFromTournamentAction`/`buildBracketInTransaction`, voir ces
 * deux fonctions) — Postgres sérialise toute désinscription ou tentative
 * de lancement concurrente sur ce même tournoi, aucune ne peut plus
 * s'intercaler entre la lecture et l'écriture.
 *
 * Quand cette inscription remplit la dernière place, le bracket est
 * construit via `buildBracketInTransaction(tx, ...)` — PAS via le
 * wrapper public `generateBracket`, qui ouvrirait une seconde
 * transaction : celle-ci réutilise le verrou déjà tenu par CETTE
 * transaction (réentrant, jamais un deadlock avec soi-même).
 */
export async function registerForTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "registerForTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  const registered = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; status: string; maxPlayers: number }[]>`
      SELECT id, status, "maxPlayers" FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE
    `;
    const tournament = locked[0];
    if (!tournament || tournament.status !== "REGISTRATION") return false;

    const participants = await tx.tournamentParticipant.findMany({
      where: { tournamentId },
      select: { userId: true },
    });
    if (participants.length >= tournament.maxPlayers) return false;
    if (participants.some((p) => p.userId === user.id)) return false;

    try {
      await tx.tournamentParticipant.create({ data: { tournamentId, userId: user.id } });
    } catch {
      // Contrainte unique (déjà inscrit) — ne devrait plus se produire
      // sous ce verrou (le re-check ci-dessus le prévient déjà pour
      // toute transaction concurrente sur ce tournoi), gardé en filet de
      // sécurité minimal, comportement identique à avant.
      return false;
    }

    // Places pleines → lancement automatique du bracket (spec), dans
    // CETTE transaction (voir docstring ci-dessus).
    if (participants.length + 1 >= tournament.maxPlayers) {
      await buildBracketInTransaction(tx, tournamentId);
    }

    return true;
  });

  if (!registered) return;

  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
}

/**
 * Désinscription, réservée à soi-même, tant que le tournoi n'a pas
 * encore démarré.
 *
 * Fix bug remonté (concurrence tournois, round 2) — l'ancien code lisait
 * `status` puis supprimait la ligne sans le moindre verrou : une
 * désinscription pouvait s'intercaler entre la lecture des participants
 * et l'écriture d'un lancement de bracket en cours
 * (`generateBracket`/`registerForTournamentAction`), qui tentait ensuite
 * de mettre à jour une ligne `TournamentParticipant` déjà supprimée —
 * exception non catchée, transaction entière annulée (y compris le
 * `status` déjà basculé). Verrouille maintenant D'ABORD la même ligne
 * `Tournament` (`SELECT ... FOR UPDATE`) que `registerForTournamentAction`/
 * `buildBracketInTransaction` avant de relire `status` et de supprimer —
 * Postgres sérialise, aucune fenêtre ne subsiste.
 */
export async function unregisterFromTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "unregisterFromTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  const unregistered = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE
    `;
    const tournament = locked[0];
    if (!tournament || tournament.status !== "REGISTRATION") return false;

    await tx.tournamentParticipant.deleteMany({ where: { tournamentId, userId: user.id } });
    return true;
  });

  if (!unregistered) return;

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
