import { getScopedPrisma } from "@/lib/community-scoped-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { wallClockNow } from "@/lib/wallclock";
import { logger } from "@/lib/logger";
import { persistServerError } from "@/lib/error-log";
import { enqueueForumThreadRemovals, enqueuePlayerClassifiedForum, isForumAuthorHidden, markForumRelayRetry, playerClassifiedForumEnabled } from "@/lib/player-classified-forum";
import { isTonightMessage } from "@/lib/tonight-rules";
import type { PlayerClassifiedFilters } from "@/lib/player-classified-filters";
import type { GameLevel } from "@/lib/game-levels-rules";
import {
  listPlayerClassifieds,
  playerClassifiedExpiresAt,
  playerClassifiedSchema,
} from "@/lib/player-classifieds";

/**
 * Service d'écriture **unique** des annonces de joueurs (`PlayerClassified`).
 *
 * Discord (`/joueurs publier`, `/joueurs retirer`) et l'application web
 * (`src/app/joueurs/actions.ts`) passent par ces fonctions : une seule
 * validation, une seule expiration, un seul contrôle d'auteur.
 *
 * Le fichier `src/lib/player-classifieds*.ts` est réservé par #408 : il n'est ici
 * qu'importé (schéma et durée de vie partagés). L'action web n'appelle ce service
 * qu'après application du patch `20261117-joueurs-service-partage.patch`, qui
 * appartient au propriétaire de #408.
 *
 * Champs optionnels (`platform`, `microphoneRequirement`, `partyType`, `startsAt`,
 * `durationMinutes`) : #408 les ajoute au modèle. Ils sont acceptés ici et
 * transmis **seulement** s'ils sont fournis, pour que la même fonction serve les
 * deux branches à la fusion. Sur la branche actuelle, l'appelant Discord ne les
 * fournit jamais : rien n'est inventé côté base.
 */
export interface PlayerListingExtras {
  platform?: string;
  microphoneRequirement?: string;
  partyType?: string;
  startsDate?: string;
  startsTime?: string;
  startsAt?: Date;
  durationMinutes?: number;
}

export type CreateListingOutcome =
  | { status: "created"; id: string; expiresAt: Date }
  | { status: "duplicate"; id: string }
  | { status: "invalid" }
  | { status: "game_not_found" }
  | { status: "starts_in_past" }
  | { status: "rate_limited" };

export type DeleteListingOutcome = "deleted" | "missing" | "not_owner" | "rate_limited" | "forum_unavailable";

/** Création : schéma partagé, 24 h, anti-doublon, limite de débit. */
export async function createPlayerListing(input: {
  userId: string;
  communityId: string;
  gameId: string;
  message: string;
  extras?: PlayerListingExtras;
  now?: Date;
}): Promise<CreateListingOutcome> {
  // Le schéma est celui de #408 : il valide aussi les champs étendus quand ils
  // sont fournis, et seulement `gameId`/`message` sur la branche actuelle.
  const parsed = playerClassifiedSchema.safeParse({ ...(input.extras ?? {}), gameId: input.gameId, message: input.message });
  if (!parsed.success) return { status: "invalid" };
  if (!checkRateLimit(input.userId, "createPlayerClassified")) return { status: "rate_limited" };
  const scopedDb = await getScopedPrisma(input.userId);
  const { gameId, message: validatedMessage, ...validatedExtras } = parsed.data as {
    gameId: string;
    message: string;
    startsAt?: Date;
  } & Record<string, unknown>;
  const game = await scopedDb.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) return { status: "game_not_found" };

  const createdAt = input.now ?? wallClockNow();
  const startsAt = (parsed.data as { startsAt?: Date }).startsAt;
  if (startsAt && startsAt <= createdAt) return { status: "starts_in_past" };

  // Anti-doublon : même auteur, même jeu, même message, encore active.
  const existing = await scopedDb.playerClassified.findFirst({
    where: {
      communityId: input.communityId,
      createdById: input.userId,
      gameId: game.id,
      message: validatedMessage,
      expiresAt: { gt: createdAt },
    },
    select: { id: true },
  });
  if (existing) return { status: "duplicate", id: existing.id };

  // Champs validés par le schéma partagé : absents sur la branche actuelle,
  // présents (plateforme, micro, type de partie, horaire, durée) après #408.
  const extras = Object.fromEntries(
    Object.entries(validatedExtras).filter(([, value]) => value !== undefined && value !== null)
  );
  const listing = await scopedDb.playerClassified.create({
    data: {
      communityId: input.communityId,
      gameId: game.id,
      createdById: input.userId,
      message: validatedMessage,
      createdAt,
      expiresAt: playerClassifiedExpiresAt(createdAt),
      ...extras,
    } as Parameters<typeof scopedDb.playerClassified.create>[0]["data"],
    select: { id: true, expiresAt: true },
  });
  await relayNewPlayerListing({ listingId: listing.id, communityId: input.communityId, userId: input.userId, message: validatedMessage });
  return { status: "created", id: listing.id, expiresAt: listing.expiresAt };
}

/**
 * Relais forum d'une annonce qui vient d'être créée (chemin Discord ET page web) : un profil masqué n'est JAMAIS relayé, sinon un événement
 * « post » est mis en file. AUCUN ping n'est consommé ici : l'exécuteur ne le consomme qu'après avoir établi que le rôle du jeu est
 * mentionnable (voir `runPlayerClassifiedForumAction`), sur le VRAI instant (jamais l'heure murale de `wallClockNow()`).
 *
 * L'annonce existe déjà : une panne du relais ne doit jamais faire échouer la création (le joueur réessaierait et créerait un doublon). Elle
 * est donc journalisée explicitement (journal serveur + journal d'erreurs) et la création réussit.
 */
export async function relayNewPlayerListing(input: { listingId: string; communityId: string; userId: string; message: string }): Promise<void> {
  if (!playerClassifiedForumEnabled()) return;
  // « 🟢 Dispo ce soir » n'est jamais relayé sur le forum (D3 : seules les annonces créées par le joueur le sont).
  if (isTonightMessage(input.message)) return;
  try {
    if (await isForumAuthorHidden(input.userId)) return;
    const queued = await enqueuePlayerClassifiedForum({ listingId: input.listingId, communityId: input.communityId, intent: "post" });
    if (queued === "retry") {
      // Échec transitoire de la mise en file : marque explicite, le balayage du cron rattrape UNIQUEMENT ces annonces.
      const error = new Error("Relais forum non mis en file à la création (réessayable) : rattrapage par le balayage du cron.");
      logger.error("player-listings", error, { step: "forum-relay-retry" });
      persistServerError("player-listings", error, { route: "player-listings/forum-relay" });
      await markRelayRetry(input);
    }
  } catch (error) {
    logger.error("player-listings", error, { step: "forum-relay" });
    persistServerError("player-listings", error, { route: "player-listings/forum-relay" });
    await markRelayRetry(input);
  }
}

/** Pose la marque « relais à retenter » ; si même cela échoue, l'échec est journalisé (jamais avalé en silence). */
async function markRelayRetry(input: { listingId: string; communityId: string }): Promise<void> {
  try {
    await markForumRelayRetry(input.listingId, input.communityId);
  } catch (markError) {
    logger.error("player-listings", markError, { step: "forum-relay-mark" });
    persistServerError("player-listings", markError, { route: "player-listings/forum-relay" });
  }
}

/** Retrait : auteur uniquement, ou modération si `isAdmin`. */
export async function deletePlayerListing(input: {
  userId: string;
  communityId: string;
  listingId: string;
  isAdmin?: boolean;
}): Promise<DeleteListingOutcome> {
  if (!input.listingId || input.listingId.length > 191) return "missing";
  if (!checkRateLimit(input.userId, "deletePlayerClassified")) return "rate_limited";
  const scopedDb = await getScopedPrisma(input.userId);
  const listing = await scopedDb.playerClassified.findFirst({
    where: { id: input.listingId, communityId: input.communityId },
    select: { id: true, createdById: true, forumThreadId: true },
  });
  if (!listing) return "missing";
  if (listing.createdById !== input.userId && !input.isAdmin) return "not_owner";
  // Le fil est SUPPRIMÉ (pseudo et mention de l'auteur ne restent pas lisibles) même si la ligne disparaît : l'identifiant du fil est porté par
  // l'événement. Cela ne dépend jamais de l'interrupteur de relais. Échec RÉESSAYABLE de la mise en file : retrait refusé (jamais un fil
  // public laissé ouvert sans annonce). Échec PERMANENT (aucun serveur Discord relié) : journalisé, le retrait continue.
  if (await enqueueForumThreadRemovals([{ id: listing.id, communityId: input.communityId, forumThreadId: listing.forumThreadId }], "remove") > 0) {
    return "forum_unavailable";
  }
  const removed = await scopedDb.playerClassified.deleteMany({
    where: { id: listing.id, communityId: input.communityId },
  });
  return removed.count ? "deleted" : "missing";
}

export interface PlayerListing {
  id: string;
  game: string;
  message: string;
  authorName: string;
  authorId: string;
  /** Niveau auto-déclaré de l'auteur pour ce jeu, seulement s'il est visible du lecteur. */
  authorLevel?: GameLevel | null;
  createdAt: Date;
  expiresAt: Date;
  expired: boolean;
}

const toListing = (
  row: {
    id: string;
    message: string;
    createdAt: Date;
    expiresAt: Date;
    game: { name: string };
    createdBy: { id: string; discordName: string };
    authorLevel?: GameLevel | null;
  },
  now: Date
): PlayerListing => ({
  id: row.id,
  game: row.game.name,
  message: row.message,
  authorName: row.createdBy.discordName,
  authorId: row.createdBy.id,
  authorLevel: row.authorLevel ?? null,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  expired: row.expiresAt <= now,
});

/** Annonces actives de la communauté — même lecture que la page `/joueurs`. */
export async function listCommunityListings(input: {
  userId: string;
  communityId: string;
  now?: Date;
  filters?: PlayerClassifiedFilters;
}): Promise<PlayerListing[]> {
  const now = input.now ?? wallClockNow();
  const rows = await listPlayerClassifieds(input.userId, input.communityId, now, input.filters);
  return rows.map((row) => toListing(row, now));
}

/** Ses propres annonces, actives **et** expirées (pour les identifier). */
export async function listOwnListings(input: {
  userId: string;
  communityId: string;
  now?: Date;
}): Promise<PlayerListing[]> {
  const now = input.now ?? wallClockNow();
  const scopedDb = await getScopedPrisma(input.userId);
  const rows = await scopedDb.playerClassified.findMany({
    where: { communityId: input.communityId, createdById: input.userId },
    select: {
      id: true,
      message: true,
      createdAt: true,
      expiresAt: true,
      game: { select: { name: true } },
      createdBy: { select: { id: true, discordName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return rows.map((row) => toListing(row, now));
}

/** Filtre commun Discord/web : jeu, auteur, texte, annonces encore actives. */
export function filterListings(
  listings: PlayerListing[],
  options: { query?: string; authorId?: string; includeExpired?: boolean; now?: Date } = {}
): PlayerListing[] {
  const now = options.now ?? wallClockNow();
  const normalize = (value: string) =>
    value
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr-FR");
  const needle = normalize(options.query ?? "");
  return listings.filter((listing) => {
    if (!options.includeExpired && listing.expiresAt <= now) return false;
    if (options.authorId && listing.authorId !== options.authorId) return false;
    if (!needle) return true;
    return normalize(`${listing.game} ${listing.message} ${listing.authorName}`).includes(needle);
  });
}
