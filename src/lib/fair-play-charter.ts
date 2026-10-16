export const MAX_FAIR_PLAY_CHARTER_LENGTH = 5000;

export function parseFairPlayCharter(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const charter = value.trim();
  return charter.length <= MAX_FAIR_PLAY_CHARTER_LENGTH ? charter || null : null;
}
