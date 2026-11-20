// Votants des preuves Tower (TOWER_DISCORD_VOTES_ENABLED) : compte GameNight actif depuis au moins 7 jours.
// L'ancienneté est celle de la Membership (joinedAt) de la communauté, pas la date d'arrivée sur Discord.
export const TOWER_VOTER_MIN_TENURE_MS = 7 * 24 * 60 * 60 * 1000;

export type TowerVoterEligibility = "ELIGIBLE" | "NOT_ACTIVE" | "TOO_RECENT";

export function towerVoterEligibility(input: {
  status: string | null | undefined;
  joinedAt: Date | null | undefined;
  now: Date;
}): TowerVoterEligibility {
  if (input.status !== "ACTIVE" || !input.joinedAt) return "NOT_ACTIVE";
  const joined = input.joinedAt.getTime();
  const current = input.now.getTime();
  if (!Number.isFinite(joined) || !Number.isFinite(current)) return "NOT_ACTIVE";
  return current - joined >= TOWER_VOTER_MIN_TENURE_MS ? "ELIGIBLE" : "TOO_RECENT";
}

export const isTowerDiscordVotesEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.TOWER_DISCORD_VOTES_ENABLED === "true";
