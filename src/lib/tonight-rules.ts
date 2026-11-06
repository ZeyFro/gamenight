import { z } from "zod";
import { PLAYER_CLASSIFIED_LIFETIME_MS } from "@/lib/player-classifieds-rules";

/**
 * « Qui joue ce soir ? » (`WHO_PLAYS_TONIGHT_ENABLED`) — règles pures, sans
 * base ni réseau. Une déclaration « dispo ce soir » est une petite annonce
 * (`PlayerClassified`) ordinaire, reconnaissable à son préfixe : aucune
 * table ni migration nouvelle, et elle reste visible sur /joueurs.
 */

export const TONIGHT_MESSAGE_PREFIX = "🟢 Dispo ce soir";
/** Fin de « ce soir » : 4 h du matin, horloge murale (même convention que `wallClockNow`). */
export const TONIGHT_END_HOUR = 4;
export const TONIGHT_MAX_GAMES = 3;
/** Marge pour inclure une soirée commencée récemment. */
export const TONIGHT_STARTED_GRACE_MS = 3 * 60 * 60 * 1000;

/** Tient dans une annonce de 240 caractères avec le préfixe et le séparateur. */
export const TONIGHT_NOTE_MAX_LENGTH = 200;

export function isTonightEnabled(): boolean {
  return process.env.WHO_PLAYS_TONIGHT_ENABLED === "true";
}

/**
 * Échéance d'une déclaration faite à `now` (horloge murale) : le prochain
 * 4 h du matin. Toujours dans le futur et jamais au-delà de la durée de vie
 * d'une petite annonce (24 h).
 */
export function tonightExpiresAt(now: Date): Date {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), TONIGHT_END_HOUR)
  );
  if (end.getTime() <= now.getTime()) end.setUTCDate(end.getUTCDate() + 1);
  return new Date(Math.min(end.getTime(), now.getTime() + PLAYER_CLASSIFIED_LIFETIME_MS));
}

/** Fenêtre des soirées planifiées à montrer : commencées depuis peu, ou avant la fin de la nuit. */
export function tonightSessionWindow(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - TONIGHT_STARTED_GRACE_MS), to: tonightExpiresAt(now) };
}

export const tonightSchema = z.object({
  gameIds: z
    .array(z.string().trim().min(1).max(191))
    .min(1)
    .max(TONIGHT_MAX_GAMES)
    .refine((ids) => new Set(ids).size === ids.length, "Jeux en double"),
  note: z.string().trim().max(TONIGHT_NOTE_MAX_LENGTH).optional(),
});

/** Lit le formulaire : jusqu'à 3 champs `gameId` (vides ignorés) et une note facultative. */
export function parseTonightForm(formData: FormData) {
  const gameIds = formData
    .getAll("gameId")
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  const rawNote = formData.get("note");
  const note = typeof rawNote === "string" && rawNote.trim().length > 0 ? rawNote : undefined;
  return tonightSchema.safeParse({ gameIds, note });
}

export function buildTonightMessage(note?: string): string {
  const trimmed = note?.trim();
  return trimmed ? `${TONIGHT_MESSAGE_PREFIX} — ${trimmed}` : TONIGHT_MESSAGE_PREFIX;
}

export function isTonightMessage(message: string): boolean {
  return message.startsWith(TONIGHT_MESSAGE_PREFIX);
}

/** Note libre d'une déclaration, sans le préfixe (chaîne vide s'il n'y en a pas). */
export function tonightNote(message: string): string {
  if (!isTonightMessage(message)) return message;
  return message.slice(TONIGHT_MESSAGE_PREFIX.length).replace(/^\s*—\s*/, "").trim();
}

export interface TonightPlayer {
  id: string;
  discordName: string;
  note: string;
}

/** Regroupe les déclarations par jeu, jeux les plus demandés d'abord, un joueur une seule fois par jeu. */
export function groupTonightByGame(
  listings: { message: string; game: { name: string }; createdBy: { id: string; discordName: string } }[]
): { game: string; players: TonightPlayer[] }[] {
  const byGame = new Map<string, Map<string, TonightPlayer>>();
  for (const listing of listings) {
    if (!isTonightMessage(listing.message)) continue;
    const players = byGame.get(listing.game.name) ?? new Map<string, TonightPlayer>();
    if (!players.has(listing.createdBy.id)) {
      players.set(listing.createdBy.id, {
        id: listing.createdBy.id,
        discordName: listing.createdBy.discordName,
        note: tonightNote(listing.message),
      });
    }
    byGame.set(listing.game.name, players);
  }
  return [...byGame.entries()]
    .map(([game, players]) => ({ game, players: [...players.values()] }))
    .sort((a, b) => b.players.length - a.players.length || a.game.localeCompare(b.game, "fr"));
}
