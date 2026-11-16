export const MAX_GAME_EPITAPH_LENGTH = 1000;

export function isCommunityGameGraveyardEnabled(): boolean {
  return process.env.COMMUNITY_GAME_GRAVEYARD_ENABLED === "true";
}

export function parseGameEpitaph(gameId: unknown, epitaph: unknown) {
  if (typeof gameId !== "string" || typeof epitaph !== "string") return null;
  const value = { gameId: "", epitaph: "" };
  value.gameId = gameId.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value.gameId)) return null;
  value.epitaph = epitaph.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!value.epitaph || value.epitaph.length > MAX_GAME_EPITAPH_LENGTH) return null;
  return value;
}
