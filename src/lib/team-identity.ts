/**
 * Identité visuelle d'une équipe (cahier §11.2) : une couleur et un emblème, choisis par le capitaine.
 * Pas d'envoi de fichier : l'emblème est pris dans une liste fermée, la couleur est un code #RRGGBB.
 */
export const TEAM_EMBLEMS = [
  "🛡️", "⚔️", "🏹", "🐉", "🦅", "🐺", "🦁", "🐻", "🦊", "🐍", "🦈", "🐙",
  "🔥", "⚡", "❄️", "🌙", "⭐", "💎", "👑", "🎯", "🚀", "🎮", "🏰", "🍀",
] as const;

const COLOR = /^#[0-9a-fA-F]{6}$/;

export type TeamIdentity = { color: string | null; emblem: string | null };

/** Valide un choix d'identité ; chaîne vide = retirer. Retourne null si une valeur est hors liste. */
export function parseTeamIdentity(color: unknown, emblem: unknown): TeamIdentity | null {
  const rawColor = typeof color === "string" ? color.trim() : "";
  const rawEmblem = typeof emblem === "string" ? emblem.trim() : "";
  if (rawColor && !COLOR.test(rawColor)) return null;
  if (rawEmblem && !(TEAM_EMBLEMS as readonly string[]).includes(rawEmblem)) return null;
  return { color: rawColor ? rawColor.toLowerCase() : null, emblem: rawEmblem || null };
}

/** Couleur affichable, ou null si la valeur stockée n'est pas un code valide. */
export function safeTeamColor(color: string | null | undefined): string | null {
  return color && COLOR.test(color) ? color : null;
}
