/**
 * Potes = amis (cahier C128, décision de Maxime du 23/11/2026). Règles PURES (aucun accès base) partagées par
 * `friends.ts`, `community-isolation.ts` (accès à une fiche) et la page `/potes`.
 *
 * Interrupteur `POTES_FRIENDS_ENABLED` : éteint par défaut, actif seulement si la valeur vaut exactement `true`.
 * Éteint, `/potes` liste toute la communauté comme avant et la table `Friendship` n'est jamais lue.
 */
export type FriendRelation = "self" | "friend" | "pending_sent" | "pending_received" | "none";

export const FRIEND_SEARCH_MIN_LENGTH = 2;
export const FRIEND_SEARCH_MAX_LENGTH = 32;
export const FRIEND_SEARCH_LIMIT = 20;
/** Demandes d'ami envoyées par personne et par jour (anti-harcèlement). */
export const FRIEND_REQUESTS_PER_DAY = 20;

export function isFriendsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.POTES_FRIENDS_ENABLED === "true";
}

/** Clé canonique d'une paire : identifiants triés, donc une seule ligne par paire quel que soit le sens. */
export function friendPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Recherche par pseudo : espaces réduits, 2 à 32 caractères ; `null` sinon (aucune requête n'est faite). */
export function normalizeFriendSearch(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const query = raw.replace(/\s+/g, " ").trim();
  return query.length >= FRIEND_SEARCH_MIN_LENGTH && query.length <= FRIEND_SEARCH_MAX_LENGTH ? query : null;
}

/**
 * Relation vue par `viewerId`. Une demande REFUSÉE reste affichée « envoyée » pour celui qui l'a faite (jamais de
 * refus annoncé : pas de notification, pas de pression) et ne peut pas être renvoyée par lui ; celui qui a refusé
 * peut, lui, demander plus tard.
 */
export function relationFor(
  viewerId: string,
  otherId: string,
  row: { requesterId: string; status: "PENDING" | "ACCEPTED" | "DECLINED" } | null,
): FriendRelation {
  if (viewerId === otherId) return "self";
  if (!row) return "none";
  if (row.status === "ACCEPTED") return "friend";
  if (row.requesterId === viewerId) return "pending_sent";
  return row.status === "PENDING" ? "pending_received" : "none";
}

export const FRIEND_RELATION_LABELS: Record<FriendRelation, string> = {
  self: "Toi",
  friend: "Ami",
  pending_sent: "Demande envoyée",
  pending_received: "T'a demandé en ami",
  none: "",
};
