export const MAX_GAME_EPITAPH_LENGTH = 1000;

export function isCommunityGameGraveyardEnabled(): boolean {
  return process.env.COMMUNITY_GAME_GRAVEYARD_ENABLED === "true";
}

export function parseGameEpitaph(gameId: unknown, epitaph: unknown) {
  if (typeof gameId !== "string" || typeof epitaph !== "string") return null;
  const value = { gameId: gameId.trim(), epitaph: epitaph.trim() };
  if (!value.gameId || value.gameId.length > 100 || !value.epitaph || value.epitaph.length > MAX_GAME_EPITAPH_LENGTH) return null;
  return value;
}
