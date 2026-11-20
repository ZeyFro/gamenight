import { VIEW_CHANNEL, VOICE_CHANNEL_ALLOW } from "@/lib/discord-team-spaces";
import { SESSION_SPACE_MAX_MEMBERS } from "@/lib/session-visibility";

/**
 * Fonctions pures de l'espace Discord temporaire d'une soirée (fil privé + vocal privé).
 * Aucune écriture ici : l'application passe par la file puis l'executor.
 */
export const SESSION_SPACE_EVENT = "SESSION_SPACE_SYNC";

export type SessionSpaceIntent = "provision" | "member" | "cleanup";

export interface VoiceOverwrite {
  id: string;
  /** 0 = rôle (@everyone), 1 = membre. */
  type: 0 | 1;
  allow: string;
  deny: string;
}

/** Nom lisible, sans caractère interdit ni dépassement de la limite Discord (100). */
export function sessionSpaceName(prefix: string, formattedDate: string): string {
  const clean = `${prefix} ${formattedDate}`.replace(/[\r\n/\\#@:`]/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 90);
}

/**
 * Identifiants Discord à autoriser : créateur d'abord, puis coorganisateur, puis invités ;
 * uniques, bien formés, plafonnés (100 overwrites par salon côté Discord).
 */
export function selectSpaceMembers(
  orderedDiscordIds: ReadonlyArray<string | null | undefined>,
  max: number = SESSION_SPACE_MAX_MEMBERS,
): string[] {
  const seen = new Set<string>();
  for (const id of orderedDiscordIds) {
    if (id && /^[0-9]{16,20}$/.test(id) && !seen.has(id)) seen.add(id);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Vocal privé : @everyone ne voit rien, seuls les membres listés voient, se connectent et parlent. */
export function buildVoiceOverwrites(guildId: string, memberDiscordIds: readonly string[]): VoiceOverwrite[] {
  return [
    { id: guildId, type: 0, allow: "0", deny: VIEW_CHANNEL },
    ...memberDiscordIds.map((id): VoiceOverwrite => ({ id, type: 1, allow: VOICE_CHANNEL_ALLOW, deny: "0" })),
  ];
}
