import {
  archiveThread,
  createForumPost,
  deleteThreadPermanently,
  getChannel,
  listDiscordForumChannels,
  listGuildRoles,
  NO_MENTIONS,
  type DiscordRestResult,
} from "@/lib/discord-rest";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { countGamePingOptIns } from "@/lib/game-ping-optin";
import { logger } from "@/lib/logger";
import { persistServerError } from "@/lib/error-log";
import { buildGameRolePing } from "@/lib/notification-policy";
import { consumePlayerClassifiedPing } from "@/lib/player-classified-pings";
import {
  enqueuePlayerClassifiedForum,
  isForumAuthorHidden,
  PLAYER_CLASSIFIED_FORUM_NAME,
  type PlayerClassifiedForumIntent,
} from "@/lib/player-classified-forum";

/** Une marque d'envoi plus récente que cela signifie « un autre exécuteur est en train de poster » (retry) ; plus ancienne : plantage. */
const POSTING_IN_FLIGHT_MS = 2 * 60_000;
/** Échecs de création après lesquels Discord a PEUT-ÊTRE créé le post : la marque d'envoi reste posée (au plus un post). */
const UNCERTAIN_KINDS = new Set(["network_uncertain", "server_error"]);
/** Un post de forum est un fil PUBLIC (type 11). */
const PUBLIC_THREAD_TYPE = 11;

const notFound = (message: string): DiscordRestResult<{ threadId?: string }> => ({ ok: false, kind: "not_found", message, retryable: false });

interface RemovalOutcome { threadId: string; /** `false` : suppression refusée (permission), le fil a seulement été archivé ET verrouillé. */ removed: boolean }

/**
 * Suppression d'un fil de relais, avec garde-fous :
 * - défense en profondeur : avant tout `DELETE`, un `GET` vérifie que l'identifiant est bien un fil PUBLIC (type 11) du serveur de la
 *   communauté ET du forum « recherche de joueurs » (jamais la suppression d'un autre salon par un identifiant erroné) ; fil absent (404) =
 *   objectif atteint ;
 * - repli : si Discord refuse la suppression (permission ou authentification), le fil est archivé ET verrouillé et l'échec est signalé
 *   (journal d'erreurs + journal, sans donnée personnelle). Permission requise : « Gérer les fils » sur le forum (docs/PERMISSIONS_BOTS.md).
 */
async function removeForumThread(threadId: string, communityId: string, deadline: Date): Promise<DiscordRestResult<RemovalOutcome>> {
  const community = await scopedPrisma(null).community.findUnique({ where: { id: communityId }, select: { discordGuildId: true } });
  const guildId = community?.discordGuildId;
  if (!guildId) return { ok: false, kind: "not_found", message: "Serveur Discord non relié : fil non joignable.", retryable: false };

  const channel = await getChannel({ channelId: threadId, deadline });
  if (!channel.ok) return channel.kind === "not_found" ? { ok: true, data: { threadId, removed: true } } : channel;
  const forums = await listDiscordForumChannels({ guildId, deadline });
  if (!forums.ok) return forums;
  const forumIds = new Set(forums.data.filter((forum) => forum.name === PLAYER_CLASSIFIED_FORUM_NAME).map((forum) => forum.id));
  if (channel.data.type !== PUBLIC_THREAD_TYPE || channel.data.guildId !== guildId || !channel.data.parentId || !forumIds.has(channel.data.parentId)) {
    persistServerError("player-classified-forum", new Error("Suppression refusée : l'identifiant n'est pas un fil du forum des recherches de joueurs."), { route: "executor/player-classified-forum" });
    return { ok: false, kind: "destination_mismatch", message: "L'identifiant n'est pas un fil du forum des recherches de joueurs : suppression refusée.", retryable: false };
  }

  const deleted = await deleteThreadPermanently({ threadId, deadline });
  if (deleted.ok || deleted.kind === "not_found") return { ok: true, data: { threadId, removed: true } };
  if (deleted.kind !== "auth_or_permission") return deleted;

  // Repli : le bot n'a pas le droit de supprimer. Le contenu ne doit pas rester ouvert : archivage + verrouillage, échec signalé.
  logger.warn("player-classified-forum", "Suppression du fil refusée par Discord : repli sur l'archivage verrouillé.", { kind: deleted.kind });
  persistServerError("player-classified-forum", new Error("Suppression d'un fil forum refusée (permission « Gérer les fils » manquante ?) : fil archivé et verrouillé seulement."), { route: "executor/player-classified-forum" });
  const archived = await archiveThread({ threadId, locked: true, deadline });
  if (!archived.ok && archived.kind !== "not_found") return archived;
  return { ok: true, data: { threadId, removed: false } };
}

/**
 * Exécution du relais forum. Le runner relit toujours l'annonce : un rejeu après crash ne crée pas de second post.
 * Garantie « au plus un post » : une marque `forumPostingAt` est posée AVANT l'appel Discord ; si le processus plante entre la création et
 * l'écriture de `forumThreadId`, aucun second post n'est jamais créé (au pire, aucun post, signalé dans le journal d'erreurs).
 */
export async function runPlayerClassifiedForumAction(
  input: { intent: PlayerClassifiedForumIntent; listingId: string; communityId: string; threadId?: string },
  deadline: Date,
): Promise<DiscordRestResult<{ threadId?: string }>> {
  const scopedDb = scopedPrisma(null);
  const listing = await scopedDb.playerClassified.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      communityId: true,
      message: true,
      pingedAt: true,
      forumThreadId: true,
      forumClosedAt: true,
      forumRemovedAt: true,
      forumPostingAt: true,
      game: { select: { id: true, name: true } },
      createdBy: { select: { id: true, discordId: true, discordName: true, profileVisibility: { select: { visibility: true } } } },
      community: { select: { discordGuildId: true } },
    },
  });

  // Fermeture (expiration) ou suppression d'un fil connu (porté par l'événement), l'annonce ayant peut-être déjà disparu.
  if (input.intent !== "post") {
    const threadId = input.threadId ?? listing?.forumThreadId ?? undefined;
    if (!threadId) return notFound("Aucun fil forum à traiter.");
    if (listing && (listing.communityId !== input.communityId)) return notFound("Annonce introuvable.");
    let removed = false;
    if (input.intent === "remove") {
      const result = await removeForumThread(threadId, input.communityId, deadline);
      if (!result.ok) return result;
      removed = result.data.removed;
    } else {
      // Expiration : le fil est FERMÉ (archivé ET verrouillé, plus aucune réponse possible) ; son contenu reste lisible, c'est voulu.
      const result = await archiveThread({ threadId, locked: true, deadline });
      // Un fil déjà absent (supprimé à la main) atteint l'état visé : succès. Un refus de permission ou une erreur réseau restent des échecs.
      if (!result.ok && result.kind !== "not_found") return result;
    }
    if (listing && listing.forumThreadId === threadId) {
      const now = new Date();
      await scopedDb.playerClassified.updateMany({
        where: { id: listing.id, communityId: listing.communityId },
        data: { ...(removed ? { forumRemovedAt: now } : {}), ...(listing.forumClosedAt ? {} : { forumClosedAt: now }) },
      });
    }
    return { ok: true, data: { threadId } };
  }

  if (!listing || listing.communityId !== input.communityId || !listing.community.discordGuildId) return notFound("Annonce introuvable.");
  if (listing.forumThreadId) return { ok: true, data: { threadId: listing.forumThreadId } };
  if (listing.forumRemovedAt) return notFound("Fil forum déjà retiré.");
  // Un profil masqué ne fuit jamais son annonce dans le forum public.
  if (listing.createdBy.profileVisibility?.visibility === "HIDDEN") return notFound("Profil masqué : annonce non relayée.");
  if (listing.forumPostingAt) {
    if (Date.now() - listing.forumPostingAt.getTime() < POSTING_IN_FLIGHT_MS) {
      return { ok: false, kind: "server_error", message: "Création du post en cours par un autre exécuteur.", retryable: true };
    }
    // Plantage entre la création du post et l'écriture de son identifiant : jamais de second post.
    persistServerError("player-classified-forum", new Error("Post forum d'annonce possiblement créé sans identifiant enregistré : aucun second post créé."), { route: "executor/player-classified-forum" });
    return notFound("Post possiblement déjà créé (marque d'envoi sans identifiant) : aucun second post n'est créé.");
  }

  const forums = await listDiscordForumChannels({ guildId: listing.community.discordGuildId, deadline });
  if (!forums.ok) return forums;
  const matches = forums.data.filter((forum) => forum.name === PLAYER_CLASSIFIED_FORUM_NAME);
  if (matches.length !== 1) return notFound("Forum de recherche de joueurs introuvable ou ambigu.");

  // Ping du rôle de jeu : seulement si le rôle est mentionnable (un seul rôle non sensible au nom du jeu, au moins un abonné opt-in) ET
  // dans la limite de 3 par joueur et par jour. `pingedAt` est posé (atomiquement) avant le compteur : un rejeu ne consomme jamais deux fois.
  const [roles, optedInCount] = await Promise.all([
    listGuildRoles({ guildId: listing.community.discordGuildId, deadline }),
    countGamePingOptIns(listing.communityId, listing.game.id),
  ]);
  const candidate = roles.ok ? buildGameRolePing({ gameName: listing.game.name, roles: roles.data.roles, optedInCount }) : null;
  let ping = null;
  if (candidate) {
    if (listing.pingedAt) {
      ping = candidate; // déjà consommé par une tentative précédente : jamais deux fois
    } else {
      const claimed = await scopedDb.playerClassified.updateMany({
        where: { id: listing.id, communityId: listing.communityId, pingedAt: null },
        data: { pingedAt: new Date() },
      });
      // Vrai instant : le jour de Paris se lit sur l'instant réel, jamais sur l'heure murale.
      if (claimed.count === 1 && await consumePlayerClassifiedPing({ communityId: listing.communityId, userId: listing.createdBy.id, now: new Date() })) {
        ping = candidate;
      } else if (claimed.count === 1) {
        await scopedDb.playerClassified.updateMany({ where: { id: listing.id, communityId: listing.communityId }, data: { pingedAt: null } });
      }
    }
  }

  const title = `${listing.game.name} · ${listing.createdBy.discordName}`.slice(0, 100);
  const content = [
    ping?.content,
    `**${listing.game.name}** — ${listing.message}`,
    `<@${listing.createdBy.discordId}>`,
  ].filter(Boolean).join("\n");

  // Marque d'envoi AVANT l'appel Discord (au plus un post, même après un plantage).
  const claim = await scopedDb.playerClassified.updateMany({
    where: { id: listing.id, communityId: listing.communityId, forumThreadId: null, forumPostingAt: null, forumRemovedAt: null },
    data: { forumPostingAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, kind: "server_error", message: "Annonce retirée ou déjà en cours de relais.", retryable: true };

  const created = await createForumPost({
    forumChannelId: matches[0].id,
    name: title,
    content,
    allowedMentions: ping?.allowedMentions ?? NO_MENTIONS,
    autoArchiveDuration: 1440,
    deadline,
  });
  if (!created.ok) {
    // Échec certain (permission, limite de débit, requête refusée) : la marque est levée pour permettre un nouvel essai. Échec incertain
    // (réseau, 5xx) : elle reste posée, un post a peut-être été créé.
    if (!UNCERTAIN_KINDS.has(created.kind)) {
      await scopedDb.playerClassified.updateMany({ where: { id: listing.id, communityId: listing.communityId, forumThreadId: null }, data: { forumPostingAt: null } });
    }
    return created;
  }

  const recorded = await scopedDb.playerClassified.updateMany({
    where: { id: listing.id, communityId: listing.communityId, forumThreadId: null },
    data: { forumThreadId: created.data.threadId, forumRelayedAt: new Date() },
  });
  // Fil à retirer tout de suite : l'annonce a été retirée pendant la création (le balayage ne le retrouverait jamais), OU l'auteur a masqué
  // son profil entre le contrôle et la création (la suppression déclenchée par le masquage ne voyait pas encore le fil).
  const orphan = recorded.count === 0;
  const hiddenMeanwhile = !orphan && await isForumAuthorHidden(listing.createdBy.id);
  if (orphan || hiddenMeanwhile) {
    // Suppression mise en file (événement portant le fil, occurrence propre, retry sûr) ; si même la mise en file échoue, dernier recours :
    // suppression en ligne (avec le même repli sur l'archivage verrouillé).
    const queued = await enqueuePlayerClassifiedForum({ listingId: listing.id, communityId: listing.communityId, intent: "remove", threadId: created.data.threadId });
    if (queued !== "queued") {
      logger.error("player-classified-forum", new Error("Fil à retirer non mis en file : suppression en ligne."), { queued, orphan });
      const removed = await removeForumThread(created.data.threadId, listing.communityId, deadline);
      if (!removed.ok) return removed;
    }
  }
  return { ok: true, data: { threadId: created.data.threadId } };
}
