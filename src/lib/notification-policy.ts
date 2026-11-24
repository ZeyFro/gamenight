import { isSensitiveRole, exactRoleMatches, type GuildRoleSummary } from "@/lib/discord-guild-roles";

/**
 * Politique de notification (sujet I, décision de Maxime du 18/11/2026). Module PUR.
 *
 * - Un MP Discord n'est autorisé que pour ce qui vise PERSONNELLEMENT le joueur : invitation,
 *   candidature, son défi, contestation. Tout le reste passe par le centre de notifications
 *   dans l'app (et le Web Push existant), ou par un ping de rôle de jeu opt-in dans un salon.
 * - `@everyone` et `@here` ne sont JAMAIS autorisés, où que ce soit.
 * - Une annonce publique n'est réservée qu'aux moments marquants.
 */

/** Ce qui vise personnellement un joueur : seul cas où un MP est légitime. */
export const PERSONAL_DM_KINDS = ["INVITATION", "APPLICATION", "OWN_CHALLENGE", "CONTESTATION"] as const;
export type PersonalDmKind = (typeof PERSONAL_DM_KINDS)[number];

/** Moments marquants : seuls événements qui justifient une annonce publique. */
export const PUBLIC_ANNOUNCEMENT_KINDS = ["NEW_RANKER", "NEW_HIGH_RANKER", "TOURNAMENT_WIN", "RECORD"] as const;
export type PublicAnnouncementKind = (typeof PUBLIC_ANNOUNCEMENT_KINDS)[number];

export function isDirectMessageAllowed(kind: string): kind is PersonalDmKind {
  return (PERSONAL_DM_KINDS as readonly string[]).includes(kind);
}

export function isPublicAnnouncementAllowed(kind: string): kind is PublicAnnouncementKind {
  return (PUBLIC_ANNOUNCEMENT_KINDS as readonly string[]).includes(kind);
}

type MentionParse = Array<"roles" | "users" | "everyone">;

/** Retire la valeur `everyone` de `parse` : aucun chemin d'envoi ne peut pinguer @everyone/@here. */
export function stripEveryoneParse(parse: MentionParse | undefined): MentionParse {
  return (parse ?? []).filter((kind) => kind !== "everyone");
}

/** Texte contenant @everyone/@here : neutralisé par un caractère de largeur nulle. */
export function neutralizeEveryoneText(content: string): string {
  return content.replace(/@(everyone|here)\b/gi, (match) => `@​${match.slice(1)}`);
}

export interface GameRolePing {
  content: string;
  allowedMentions: { parse: []; roles: string[] };
}

/**
 * Mentions de rôle approuvées (lot 5, Q19) : seul `buildGameRolePing` en produit (jeu avec au moins un abonné opt-in, un seul rôle non
 * sensible). `discord-rest.ts` retire TOUTE mention de rôle qui n'est pas passée par là : un ping de rôle de jeu ne peut donc pas être ajouté
 * « par accident » ni par un nouvel appelant. L'identité de l'objet fait foi (un objet copié ou reconstruit n'est pas approuvé).
 */
const APPROVED_ROLE_MENTIONS = new WeakSet<object>();
export function isApprovedRolePing(mentions: object): boolean {
  return APPROVED_ROLE_MENTIONS.has(mentions);
}

/**
 * Ping du rôle de jeu pour un jeu donné. Retourne `null` (donc aucun ping) sauf si le jeu a au
 * moins un abonné opt-in dans la communauté ET qu'un seul rôle non sensible correspond au nom du
 * jeu (jamais de devinette en cas d'ambiguïté). Seul ce rôle précis est mentionnable.
 */
export function buildGameRolePing(input: {
  gameName: string;
  roles: readonly GuildRoleSummary[];
  optedInCount: number;
}): GameRolePing | null {
  if (input.optedInCount <= 0) return null;
  const matches = exactRoleMatches([...input.roles], input.gameName).filter((role) => !isSensitiveRole(role));
  if (matches.length !== 1) return null;
  const role = matches[0];
  const allowedMentions: GameRolePing["allowedMentions"] = { parse: [], roles: [role.id] };
  APPROVED_ROLE_MENTIONS.add(allowedMentions);
  return { content: `<@&${role.id}>`, allowedMentions };
}
