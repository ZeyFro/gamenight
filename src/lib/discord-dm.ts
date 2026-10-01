import { prisma } from "@/lib/prisma";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import type { TerminalDiscordFailureInput } from "@/lib/notification-executor";

/**
 * MP Discord des tournois et de la roulette (V2) — même modèle que les MP
 * des soirées (`session-announce.ts`, PR #113/#114), mutualisé pour ces deux
 * familles : un MP par pote concerné (créateur inclus), un `targetSlot` par
 * `[source, kind, pote]` (idempotent), aucun nouveau MP vers un pote dont un
 * MP de cette même source a déjà échoué en `dm_unavailable`.
 *
 * Rôles de `targetSlot` : `dm:<kind>:<userId>` (le MP) et, pour les
 * tournois seulement, `dm-fallback:<kind>:<userId>` (mention de secours dans
 * le fil). Un `userId` (cuid) ne contient jamais `:`.
 *
 * Uniquement des écritures — jamais d'appel Discord ici (voir le commentaire
 * de fichier de `notification-delivery.ts`).
 */

export type DmCategory = "TOURNAMENT" | "ROULETTE";

const GUILD_SLOT_PREFIX = "default-guild";
export const DM_UNAVAILABLE_ERROR_CLASS = "discord:dm_unavailable";

export function dmSlot(category: DmCategory, sourceId: string, kind: string, userId: string): string {
  return `${GUILD_SLOT_PREFIX}:${category}:${sourceId}:dm:${kind}:${userId}`;
}

export function dmFallbackSlot(category: DmCategory, sourceId: string, kind: string, userId: string): string {
  return `${GUILD_SLOT_PREFIX}:${category}:${sourceId}:dm-fallback:${kind}:${userId}`;
}

export interface ParsedDmRole {
  kind: string;
  userId: string;
}

/** `role` = fin du `targetSlot` après `default-guild:<CATEGORY>:<id>:`. */
export function parseDmRole(role: string, prefix: "dm:" | "dm-fallback:"): ParsedDmRole | null {
  if (!role.startsWith(prefix)) return null;
  const rest = role.slice(prefix.length);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { kind: rest.slice(0, cut), userId: rest.slice(cut + 1) };
}

export interface EnqueueDirectMessagesInput<T extends { id: string }> {
  category: DmCategory;
  sourceId: string;
  /** Libellé libre du type d'événement (ex. `TOURNAMENT_DM`). */
  eventType: string;
  /** Un kind = un type de message pour cette source (ex. `announce`). */
  kind: string;
  users: T[];
}

/**
 * Met en file un MP par destinataire et renvoie :
 *   - `covered` : les potes désormais couverts par un MP (leur mention doit
 *     être retirée du message public) ;
 *   - `blocked` : les potes dont un MP de cette source a déjà échoué en
 *     `dm_unavailable` — AUCUN nouveau MP, à mentionner comme avant.
 */
export async function enqueueDirectMessages<T extends { id: string }>(
  input: EnqueueDirectMessagesInput<T>
): Promise<{ covered: T[]; blocked: T[] }> {
  const { category, sourceId, eventType, kind, users } = input;
  if (users.length === 0) return { covered: [], blocked: [] };

  const failed = await prisma.notificationDelivery.findMany({
    where: {
      targetSlot: { startsWith: `${GUILD_SLOT_PREFIX}:${category}:${sourceId}:dm:` },
      recipientKey: { in: users.map((u) => `user:${u.id}`) },
      errorClass: DM_UNAVAILABLE_ERROR_CLASS,
    },
    select: { recipientKey: true },
  });
  const blockedKeys = new Set(failed.map((d) => d.recipientKey));
  const blocked = users.filter((u) => blockedKeys.has(`user:${u.id}`));
  const covered = users.filter((u) => !blockedKeys.has(`user:${u.id}`));
  if (covered.length === 0) return { covered, blocked };

  const event = await createNotificationEvent({ category, eventType, sourceId, occurrence: kind });
  for (const user of covered) {
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_DM",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `user:${user.id}`,
      targetSlot: dmSlot(category, sourceId, kind, user.id),
    });
  }
  return { covered, blocked };
}

/**
 * MP fermé (`discord:dm_unavailable`, jamais une autre erreur) — met en file
 * la mention de secours dans le fil, dans la MÊME transaction que le passage
 * à FAILED (voir `DeliveryResolver.onTerminalDiscordFailure`). Idempotent
 * (occurrence = `targetSlot` du MP d'origine). Ne fait rien pour une autre
 * catégorie que celle demandée ni pour une livraison qui n'est pas un MP.
 */
export async function enqueueDirectMessageFallback(
  input: TerminalDiscordFailureInput,
  category: DmCategory
): Promise<void> {
  const { delivery, event, errorClass, db } = input;
  if (event.category !== category || delivery.channel !== "DISCORD_DM") return;
  if (errorClass !== DM_UNAVAILABLE_ERROR_CLASS) return;
  const role = delivery.targetSlot.split(":").slice(3).join(":");
  const parsed = parseDmRole(role, "dm:");
  if (!parsed) return;

  const fallbackEvent = await createNotificationEvent(
    { category, eventType: `${category}_DM_FALLBACK`, sourceId: event.sourceId, occurrence: delivery.targetSlot },
    db
  );
  await enqueueDelivery(
    {
      eventId: fallbackEvent.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `user:${parsed.userId}`,
      targetSlot: dmFallbackSlot(category, event.sourceId, parsed.kind, parsed.userId),
    },
    db
  );
}
