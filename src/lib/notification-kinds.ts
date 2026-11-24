/**
 * Lot 5 Notifications (cahier C029, C044, C085, D09, D10 ; décisions de Maxime Q17 à Q19, 23/11/2026). Module PUR.
 *
 * Chaque type d'événement de la file (`NotificationEvent.eventType`) porte UN genre explicite, dans une liste FERMÉE :
 *
 * - `PERSONAL_DM` : vise personnellement le joueur (invitation, candidature, son défi, rappel perso). Seul genre autorisé en MP Discord.
 * - `PUBLIC_MILESTONE` : annonce publique d'un moment marquant (liste fermée ci-dessous). Seul genre autorisé à ouvrir un NOUVEAU message public.
 * - `PUBLIC_UPDATE` : édition ou retrait d'un message public déjà autorisé (jamais un nouveau message public).
 * - `THREAD_CONTEXT` : message dans le fil d'une annonce déjà autorisée (rappel, changement de date, mention de secours), jamais dans un salon libre.
 * - `OPT_IN_ROLE_PING` : message portant le ping d'un rôle de jeu, réservé aux membres qui l'ont demandé (voir `buildGameRolePing`).
 * - `IN_APP_ONLY` : centre de notifications dans l'app seulement ; aucun envoi Discord (MP ni salon).
 * - `SYSTEM_ACTION` : opération d'administration exécutée par l'executor (synchronisation d'espaces, rôles…) ; ce n'est pas une notification.
 *
 * Un type absent de la liste est REFUSÉ (échec fermé) : un nouvel événement doit être classé ici, avec son test, avant d'envoyer quoi que ce soit.
 */

export const NOTIFICATION_KINDS = [
  "PERSONAL_DM",
  "PUBLIC_MILESTONE",
  "PUBLIC_UPDATE",
  "THREAD_CONTEXT",
  "OPT_IN_ROLE_PING",
  "IN_APP_ONLY",
  "SYSTEM_ACTION",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type PolicyChannel = "DISCORD_DM" | "DISCORD_CHANNEL" | "IN_APP";

/**
 * Moments marquants autorisés à ouvrir un message PUBLIC (D10). Liste fermée et documentée dans docs/CENTRE_NOTIFICATIONS.md :
 * soirée annoncée (y compris une partie « Jouer maintenant », sans mention), soirée validée, résultat de soirée, tournoi créé, résultat de tournoi (victoire, fin), preuve et réussite d'un défi Tower
 * (avec consentement), annonce communautaire (trophée de groupe, fin de saison, récompense, jeu gratuit).
 */
export const PUBLIC_MILESTONE_EVENT_TYPES = [
  "SESSION_CREATED",
  "SESSION_VALIDATED",
  "SESSION_RESULT",
  "INSTANT_SESSION_ANNOUNCE",
  "TOURNAMENT_CREATED",
  "TOURNAMENT_RESULT",
  "TOWER_PROOF_SUBMITTED",
  "TOWER_CHALLENGE_APPROVED",
  "TOWER_CHALLENGE_REJECTED",
  "TOWER_AUTO_VALIDATION",
  "COMMUNITY_SYSTEM_ANNOUNCE",
] as const;

const PERSONAL_DM_EVENT_TYPES = [
  "SESSION_DM", "SESSION_DM_EDIT",
  "TOURNAMENT_DM", "TOURNAMENT_DM_EDIT",
  "ROULETTE_DM", "ROULETTE_DM_EDIT",
  "INSTANT_SESSION_INVITE", "INSTANT_SESSION_UPDATED",
  "TEAM_APPLICATION_NOTIFY", "TOURNAMENT_TEAM_NOTIFY",
  "ONBOARDING_REMINDER", "TOWER_AUTO_VALIDATED",
] as const;

const PUBLIC_UPDATE_EVENT_TYPES = [
  "SESSION_MODIFIED", "SESSION_REMOVED",
  "TOURNAMENT_MODIFIED", "TOURNAMENT_REMOVED",
  "INSTANT_SESSION_ANNOUNCE_UPDATED",
  "TOWER_PROOF_VOTE_UPDATED", "TOWER_AUTO_VALIDATION_UPDATED",
] as const;

const THREAD_CONTEXT_EVENT_TYPES = [
  "SESSION_DATE_CHANGED", "SESSION_REMINDER", "SESSION_CREATOR_MEMBER", "SESSION_INVITE_SYNC",
  "SESSION_THREAD_ARCHIVE", "SESSION_THREAD_AUTO_DELETE", "SESSION_RSVP",
  "TOURNAMENT_MATCH_RESULT", "TOURNAMENT_THREAD_MEMBER", "TOURNAMENT_THREAD_INVITE", "TOURNAMENT_THREAD_AUTO_DELETE",
  "INSTANT_SESSION_RSVP", "TOWER_PROOF_THREAD",
] as const;

/**
 * Aucun type n'est aujourd'hui « dans l'app seulement » : « Jouer maintenant » garde son annonce publique SANS mention (une partie
 * immédiate est une soirée ouverte aux membres, annoncée comme une soirée) et son invitation reste un MP. Le genre existe pour qu'un
 * futur événement purement in-app soit refusé sur tout canal Discord.
 */
const IN_APP_ONLY_EVENT_TYPES: readonly string[] = [];

const SYSTEM_ACTION_EVENT_TYPES = [
  "SESSION_SPACE_SYNC", "PROJECT_SYNC", "TEAM_SPACE_SYNC",
  "ROLE_AUTOCREATE", "ROLE_CAPACITY_ALERT", "MODERATION_REPORT", "BOOSTER_SUPPORT_SYNC",
] as const;

/** Ping du rôle de jeu à la création d'une soirée OUVERTE (Q19) : un seul événement, jamais de MP, mention produite par `buildGameRolePing` seulement. */
const OPT_IN_ROLE_PING_EVENT_TYPES: readonly string[] = ["SESSION_GAME_PING"];

/** Rangs de MP de secours : `<CATEGORIE>_DM_FALLBACK` est une mention dans le fil, jamais un nouveau message public. */
const DM_FALLBACK_SUFFIX = "_DM_FALLBACK";
const DM_FALLBACK_CATEGORIES = ["SESSION", "TOURNAMENT", "ROULETTE", "INSTANT_SESSION"] as const;

export const EVENT_KINDS: Readonly<Record<string, NotificationKind>> = Object.freeze({
  ...Object.fromEntries(PERSONAL_DM_EVENT_TYPES.map((t) => [t, "PERSONAL_DM" as const])),
  ...Object.fromEntries(PUBLIC_MILESTONE_EVENT_TYPES.map((t) => [t, "PUBLIC_MILESTONE" as const])),
  ...Object.fromEntries(PUBLIC_UPDATE_EVENT_TYPES.map((t) => [t, "PUBLIC_UPDATE" as const])),
  ...Object.fromEntries(THREAD_CONTEXT_EVENT_TYPES.map((t) => [t, "THREAD_CONTEXT" as const])),
  ...Object.fromEntries(DM_FALLBACK_CATEGORIES.map((c) => [c + DM_FALLBACK_SUFFIX, "THREAD_CONTEXT" as const])),
  ...Object.fromEntries(OPT_IN_ROLE_PING_EVENT_TYPES.map((t) => [t, "OPT_IN_ROLE_PING" as const])),
  ...Object.fromEntries(IN_APP_ONLY_EVENT_TYPES.map((t) => [t, "IN_APP_ONLY" as const])),
  ...Object.fromEntries(SYSTEM_ACTION_EVENT_TYPES.map((t) => [t, "SYSTEM_ACTION" as const])),
});

/** Genre d'un type d'événement, ou `null` s'il n'est pas classé (donc refusé). */
export function kindOfEvent(eventType: string): NotificationKind | null {
  return Object.prototype.hasOwnProperty.call(EVENT_KINDS, eventType) ? EVENT_KINDS[eventType] : null;
}

/** Canaux autorisés par genre. `PUBLIC_UPDATE` et `THREAD_CONTEXT` ne peuvent jamais ouvrir un message dans un salon libre : voir `operation`. */
const ALLOWED_CHANNELS: Readonly<Record<NotificationKind, readonly PolicyChannel[]>> = {
  PERSONAL_DM: ["DISCORD_DM", "IN_APP"],
  PUBLIC_MILESTONE: ["DISCORD_CHANNEL", "IN_APP"],
  PUBLIC_UPDATE: ["DISCORD_CHANNEL"],
  THREAD_CONTEXT: ["DISCORD_CHANNEL"],
  OPT_IN_ROLE_PING: ["DISCORD_CHANNEL", "IN_APP"],
  IN_APP_ONLY: ["IN_APP"],
  SYSTEM_ACTION: ["DISCORD_CHANNEL"],
};

export type PolicyRefusalReason = "unknown_event_type" | "channel_not_allowed_for_kind";

export type DeliveryPolicyDecision =
  | { allowed: true; kind: NotificationKind }
  | { allowed: false; kind: NotificationKind | null; reason: PolicyRefusalReason; detail: string };

/**
 * Décision AVANT envoi pour une livraison de la file. MP seulement pour un événement personnel (Q17) ; message public neuf seulement
 * pour un moment marquant (Q18/D10) ; rien d'envoyé pour un événement « dans l'app seulement » ni pour un type inconnu.
 */
export function evaluateDeliveryPolicy(input: { eventType: string; channel: string }): DeliveryPolicyDecision {
  const kind = kindOfEvent(input.eventType);
  if (kind === null) {
    return { allowed: false, kind: null, reason: "unknown_event_type", detail: `Type d'événement « ${input.eventType} » non classé dans la politique de notification.` };
  }
  if (!(ALLOWED_CHANNELS[kind] as readonly string[]).includes(input.channel)) {
    return {
      allowed: false,
      kind,
      reason: "channel_not_allowed_for_kind",
      detail: `Le type « ${input.eventType} » (${kind}) n'est pas autorisé sur le canal ${input.channel}.`,
    };
  }
  return { allowed: true, kind };
}
