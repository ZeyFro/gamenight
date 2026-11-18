import { getGuildMemberProfile } from "@/lib/discord-rest";

/**
 * Statut Booster d'un membre, lu à la source Discord (`premium_since`).
 *
 * Aucun second système : pas de table « booster », pas de rôle maison, pas de
 * cache persistant. Le statut est donc toujours juste (y compris pendant la
 * minute qui suit un arrêt de boost) et rien ne peut diverger.
 *
 * Conséquence assumée : chaque consultation coûte un appel REST Discord. La
 * mémoire d'historique (badge permanent, périodes de boost) demandera une
 * table dédiée, donc une migration — opération bloquante qui n'est pas faite
 * ici. Les récompenses déjà obtenues ailleurs restent, elles, inchangées.
 */
export type BoosterStatus =
  | { status: "ACTIVE"; since: string | null }
  | { status: "INACTIVE" }
  | { status: "UNAVAILABLE" };

/** Budget Discord de la commande `/boost` (réponse différée, place large). */
export const BOOSTER_REQUEST_BUDGET_MS = 6_000;

export async function readBoosterStatus(input: {
  guildId: string;
  discordId: string;
  now?: Date;
  /**
   * Budget réseau propre à l'appelant : le profil web ne peut pas attendre
   * plusieurs secondes avant de peindre la page, `/boost` si.
   */
  budgetMs?: number;
}): Promise<BoosterStatus> {
  const budget = Math.max(200, Math.min(input.budgetMs ?? BOOSTER_REQUEST_BUDGET_MS, BOOSTER_REQUEST_BUDGET_MS));
  const deadline = new Date(Date.now() + budget);
  const member = await getGuildMemberProfile({
    guildId: input.guildId,
    userId: input.discordId,
    deadline,
    now: input.now,
  });
  if (!member.ok) return { status: "UNAVAILABLE" };
  return member.data.premiumSince
    ? { status: "ACTIVE", since: member.data.premiumSince }
    : { status: "INACTIVE" };
}
