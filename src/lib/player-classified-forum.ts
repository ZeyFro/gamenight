import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { logger } from "@/lib/logger";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { isTonightMessage, TONIGHT_MESSAGE_PREFIX } from "@/lib/tonight-rules";
import type { DeliveryResolver } from "@/lib/notification-executor";

/**
 * Relais forum des annonces de joueurs (D3) : AUCUNE écriture Discord directe
 * depuis le web ou Discord. Une annonce produit un `NotificationEvent`
 * (ADMIN / `PLAYER_CLASSIFIED_FORUM`, genre SYSTEM_ACTION : relais d'un contenu déjà créé par le joueur, pas une annonce publique de
 * « moment marquant ») + une livraison BOT ; l'executor crée le post forum, puis un balayage planifié met en file sa fermeture.
 *
 * Trois intentions :
 * - `post`   : création du post unique (un événement par annonce) ;
 * - `close`  : ARCHIVAGE du fil, à l'expiration de l'annonce seulement (le contenu reste lisible, c'est voulu) ;
 * - `remove` : SUPPRESSION du fil (annonce retirée par son auteur ou un admin, compte supprimé, profil masqué) : le pseudo et la mention de
 *   l'auteur ne restent jamais lisibles.
 *
 * Idempotence : un seul événement par annonce et par intention ; les événements `close` et `remove` portent TOUJOURS `threadId` et leur
 * occurrence (`close:<fil>`, `remove:<fil>`) : la ligne de l'annonce peut avoir disparu, et un fil orphelin a sa propre occurrence. Une
 * suppression qui n'a pu qu'archiver le fil (permission manquante) est retentée chaque JOUR par le balayage avec une occurrence versionnée
 * (`remove:<fil>:AAAAMMJJ`) : la déduplication ne bloque jamais un nouvel essai légitime une fois la permission accordée.
 *
 * Les annonces « 🟢 Dispo ce soir » (`replaceTonightClassifieds`) ne sont JAMAIS relayées, par aucun chemin (création, nouvel essai,
 * rattrapage, résolveur, exécuteur) : le forum ne reçoit que les annonces créées par le joueur (D3).
 *
 * Règles de sécurité (D3, corrections de revue du 27/11/2026) :
 * - un profil masqué (`UserProfileVisibility = HIDDEN`) n'est JAMAIS relayé, que `PROFILE_VISIBILITY_ENABLED` soit allumé ou non (règle la
 *   plus prudente : une personne qui a masqué son profil le reste) ; masquer son profil met immédiatement en file la suppression de ses
 *   fils, le balayage du cron rattrape le reste ;
 * - fermer ou supprimer un fil ne dépend jamais de l'interrupteur de relais (il gouverne la création, pas le retrait).
 */
export const PLAYER_CLASSIFIED_FORUM_EVENT = "PLAYER_CLASSIFIED_FORUM";
export const PLAYER_CLASSIFIED_FORUM_NAME = "🔎・recherche-de-joueurs";

const intentSchema = z.enum(["post", "close", "remove"]);
export type PlayerClassifiedForumIntent = z.infer<typeof intentSchema>;

/**
 * `unavailable` = échec PERMANENT (communauté sans serveur Discord relié, demande invalide) : inutile de réessayer, le retrait de l'annonce
 * ou du compte n'est jamais bloqué par lui. `retry` = échec transitoire de la mise en file : l'appelant refuse et invite à réessayer.
 */
export type ForumEnqueueResult = "queued" | "disabled" | "unavailable" | "retry";

export function playerClassifiedForumEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED === "true"
    && env.NOTIFICATION_EXECUTOR_ENABLED === "true"
    && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

const occurrenceFor = (intent: PlayerClassifiedForumIntent, threadId?: string, attempt?: string) =>
  (intent === "post" ? "post" : `${intent}:${threadId}${attempt ? `:${attempt}` : ""}`);
const slotFor = (guildId: string, listingId: string, intent: PlayerClassifiedForumIntent, threadId?: string, attempt?: string) =>
  `${guildId}:ADMIN:${listingId}:player-classified-${intent}${intent === "post" ? "" : `:${threadId}${attempt ? `:${attempt}` : ""}`}`;
/** Jour (UTC) servant de version aux nouvelles tentatives quotidiennes d'une suppression qui n'a pu qu'archiver. */
const attemptDay = (now: Date) => now.toISOString().slice(0, 10).replace(/-/g, "");

/** Profil masqué par son auteur : l'annonce ne doit jamais apparaître dans le forum public. */
export async function isForumAuthorHidden(userId: string): Promise<boolean> {
  const row = await prisma.userProfileVisibility.findUnique({ where: { userId }, select: { visibility: true } });
  return row?.visibility === "HIDDEN";
}

export async function enqueuePlayerClassifiedForum(input: {
  listingId: string;
  communityId: string;
  intent: PlayerClassifiedForumIntent;
  /** Obligatoire pour `close` et `remove` : la ligne peut déjà être supprimée à l'exécution. */
  threadId?: string;
  /** Version (AAAAMMJJ) d'une nouvelle tentative de `remove` : occurrence distincte, donc jamais dédupliquée avec l'essai précédent. */
  attempt?: string;
}): Promise<ForumEnqueueResult> {
  // L'interrupteur gouverne la CRÉATION des posts ; fermer ou supprimer un fil existant reste toujours possible.
  if (input.intent === "post" && !playerClassifiedForumEnabled()) return "disabled";
  if (input.intent !== "post" && !/^\d{1,32}$/.test(input.threadId ?? "")) return "unavailable";
  try {
    const community = await scopedPrisma(null).community.findUnique({
      where: { id: input.communityId },
      select: { discordGuildId: true },
    });
    if (!community?.discordGuildId) return "unavailable";
    const event = await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: PLAYER_CLASSIFIED_FORUM_EVENT,
      sourceId: input.listingId,
      occurrence: occurrenceFor(input.intent, input.threadId, input.attempt),
      payload: { intent: input.intent, ...(input.threadId ? { threadId: input.threadId } : {}), ...(input.attempt ? { attempt: input.attempt } : {}) },
    });
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `player-classified:${input.listingId}`,
      targetSlot: slotFor(community.discordGuildId, input.listingId, input.intent, input.threadId, input.attempt),
    });
    return "queued";
  } catch (error) {
    // Jamais bloquant pour la création de l'annonce ; pour un retrait, l'appelant lit « retry » et refuse (réessayable).
    logger.warn("player-classified-forum", "Relais forum non enfilé.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return "retry";
  }
}

export const playerClassifiedForumResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== PLAYER_CLASSIFIED_FORUM_EVENT || !event.communityId) {
      return { eligible: false, reason: "unresolvable" };
    }
    const payload = z.object({
      intent: intentSchema,
      threadId: z.string().regex(/^\d{1,32}$/).optional(),
      attempt: z.string().regex(/^\d{8}$/).optional(),
    }).safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    const { intent, threadId, attempt } = payload.data;
    if (intent !== "post" && !threadId) return { eligible: false, reason: "unresolvable" };
    if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const listing = await scopedPrisma(null).playerClassified.findUnique({
      where: { id: event.sourceId },
      select: { communityId: true, message: true, forumThreadId: true, forumClosedAt: true, forumRemovedAt: true,
        createdBy: { select: { profileVisibility: { select: { visibility: true } } } } },
    });
    if (!listing) {
      // Annonce retirée : seules la fermeture et la suppression d'un fil connu (porté par l'événement) restent possibles.
      if (intent === "post") return { eligible: false, reason: "expired" };
    } else {
      if (listing.communityId !== event.communityId) return { eligible: false, reason: "expired" };
      if (intent === "post") {
        if (isTonightMessage(listing.message)) return { eligible: false, reason: "expired" };
        if (listing.forumThreadId || listing.forumRemovedAt) return { eligible: false, reason: "expired" };
        if (listing.createdBy.profileVisibility?.visibility === "HIDDEN") return { eligible: false, reason: "expired" };
      }
      if (intent === "close" && (listing.forumThreadId === threadId ? Boolean(listing.forumClosedAt || listing.forumRemovedAt) : false)) {
        return { eligible: false, reason: "expired" };
      }
    }
    const community = await scopedPrisma(null).community.findUnique({
      where: { id: event.communityId },
      select: { discordGuildId: true },
    });
    if (!community?.discordGuildId) return { eligible: false, reason: "not_configured" };
    if (delivery.operation !== "SEND" || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT"
      || delivery.recipientKey !== `player-classified:${event.sourceId}`
      || delivery.targetSlot !== slotFor(community.discordGuildId, event.sourceId, intent, threadId, attempt)) {
      return { eligible: false, reason: "unresolvable" };
    }
    return {
      eligible: true,
      action: {
        kind: "relay_player_classified_forum",
        intent,
        listingId: event.sourceId,
        communityId: event.communityId,
        ...(threadId ? { threadId } : {}),
      },
    };
  },
};

/**
 * Met en file la SUPPRESSION (ou, à l'expiration, l'archivage) des fils de ces annonces. Renvoie le nombre d'échecs RÉESSAYABLES : 0 = rien
 * ne s'oppose au retrait. Un échec PERMANENT (communauté sans serveur Discord relié) est journalisé (aucune donnée personnelle) et ne
 * bloque jamais le retrait : il n'y a alors aucun moyen de joindre le fil.
 */
export async function enqueueForumThreadRemovals(
  rows: Array<{ id: string; communityId: string; forumThreadId: string | null; attempt?: string }>,
  intent: "close" | "remove" = "remove",
): Promise<number> {
  let retryable = 0;
  let permanent = 0;
  for (const row of rows) {
    if (!row.forumThreadId) continue;
    const result = await enqueuePlayerClassifiedForum({ listingId: row.id, communityId: row.communityId, intent, threadId: row.forumThreadId, ...(row.attempt ? { attempt: row.attempt } : {}) });
    if (result === "retry") retryable++;
    else if (result === "unavailable") permanent++;
  }
  if (permanent > 0) {
    logger.warn("player-classified-forum", "Fil forum non joignable (échec permanent) : le retrait continue sans fermeture.", { intent, permanent });
  }
  return retryable;
}

/** Suppression de compte ou profil masqué : met en file la suppression de tous les fils encore présents de la personne. */
export async function enqueueForumRemovalsForUser(userId: string): Promise<number> {
  const rows = await scopedPrisma(null).playerClassified.findMany({
    where: { createdById: userId, forumThreadId: { not: null }, forumRemovedAt: null },
    select: { id: true, communityId: true, forumThreadId: true },
  });
  return enqueueForumThreadRemovals(rows, "remove");
}

export interface PlayerClassifiedForumLifecycle {
  enabled: boolean;
  closeQueued: number;
  /** Annonces dont la mise en file du relais avait ÉCHOUÉ à la création et que ce passage a réellement mises en file (marque consommée). */
  postsQueued: number;
}

/**
 * Marqueur EXPLICITE d'une mise en file du relais à retenter (sans migration) : sur une annonce SANS fil, `forumSweptAt` renseigné signifie
 * « l'enfilement du post a échoué à la création ». Le balayage ne rattrape QUE ces annonces, puis efface la marque (jamais de recomptage,
 * jamais une annonce que le relais n'a pas tentée, comme « Dispo ce soir »). Sur une annonce AVEC fil, `forumSweptAt` reste le curseur du balayage.
 */
export async function markForumRelayRetry(listingId: string, communityId: string): Promise<void> {
  await scopedPrisma(null).playerClassified.updateMany({
    where: { id: listingId, communityId, forumThreadId: null },
    data: { forumSweptAt: new Date() },
  });
}

/** Une annonce plus ancienne que cela n'est plus rattrapée (le balayage ne fait pas ressortir une vieille annonce dans le forum). */
const CATCH_UP_WINDOW_MS = 6 * 60 * 60_000;

/**
 * Balayage (cron des rappels) : supprime les fils dont l'auteur a masqué son profil, ferme (archive et verrouille) ceux des annonces
 * expirées, et rattrape les relais dont la mise en file a échoué à la création. Il tourne même
 * relais éteint (il ne fait que retirer des fils qui existent déjà). Curseur `forumSweptAt` : les lignes les moins récemment traitées
 * passent d'abord, une ligne bloquée en permanence ne monopolise donc jamais les 25 lignes d'un passage.
 */
export async function runPlayerClassifiedForumLifecycle(now: Date = new Date()): Promise<PlayerClassifiedForumLifecycle> {
  const scopedDb = scopedPrisma(null);
  const rows = await scopedDb.playerClassified.findMany({
    where: {
      forumThreadId: { not: null },
      forumRemovedAt: null,
      OR: [
        { forumClosedAt: null, expiresAt: { lte: now } },
        { createdBy: { profileVisibility: { is: { visibility: "HIDDEN" } } } },
      ],
    },
    orderBy: [{ forumSweptAt: { sort: "asc", nulls: "first" } }, { expiresAt: "asc" }],
    take: 25,
    select: { id: true, communityId: true, forumThreadId: true, forumClosedAt: true, createdBy: { select: { profileVisibility: { select: { visibility: true } } } } },
  });
  let failed = 0;
  for (const row of rows) {
    const hidden = row.createdBy.profileVisibility?.visibility === "HIDDEN";
    // Un fil déjà fermé (archivé) dont la SUPPRESSION reste due (repli sans permission, ou archivé à l'expiration puis profil masqué) est
    // retenté avec une occurrence du jour : la déduplication ne bloque jamais un nouvel essai légitime.
    failed += await enqueueForumThreadRemovals([{ ...row, ...(hidden && row.forumClosedAt ? { attempt: attemptDay(now) } : {}) }], hidden ? "remove" : "close");
  }
  if (rows.length > 0) {
    await scopedDb.playerClassified.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { forumSweptAt: now } });
  }

  // Rattrapage : UNIQUEMENT les annonces dont la mise en file a réellement échoué à la création (marque explicite posée par
  // `relayNewPlayerListing`), encore actives, récentes, d'auteur non masqué, jamais un « Dispo ce soir ». La marque est consommée dès que la
  // mise en file réussit (ou est définitivement impossible) : aucun recomptage.
  let postsQueued = 0;
  if (playerClassifiedForumEnabled()) {
    const missing = await scopedDb.playerClassified.findMany({
      where: {
        forumThreadId: null, forumPostingAt: null, forumRemovedAt: null, forumSweptAt: { not: null },
        expiresAt: { gt: now }, createdAt: { gte: new Date(now.getTime() - CATCH_UP_WINDOW_MS) },
        NOT: [
          { createdBy: { profileVisibility: { is: { visibility: "HIDDEN" } } } },
          { message: { startsWith: TONIGHT_MESSAGE_PREFIX } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, communityId: true },
    });
    for (const row of missing) {
      const queued = await enqueuePlayerClassifiedForum({ listingId: row.id, communityId: row.communityId, intent: "post" });
      if (queued === "retry") continue; // marque conservée : nouvel essai au prochain passage
      await scopedDb.playerClassified.updateMany({ where: { id: row.id, communityId: row.communityId, forumThreadId: null }, data: { forumSweptAt: null } });
      if (queued === "queued") postsQueued++;
    }
  }
  return { enabled: playerClassifiedForumEnabled() || rows.length > 0, closeQueued: rows.length - failed, postsQueued };
}
