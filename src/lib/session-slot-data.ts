import { prisma } from "@/lib/prisma";
import { creationMemberUserWhere } from "@/lib/community-isolation";
import { suggestSessionSlots, type SessionSlotSuggestion } from "@/lib/session-slot-suggestions";
import { toDateInputValue } from "@/lib/wallclock";

export type SlotSuggestionsResult =
  | { ok: true; suggestions: SessionSlotSuggestion[] }
  | { ok: false; error: "authentication" | "invalid_input" | "participants_changed" | "rate_limited" | "unavailable" };

/** Une lecture de roster puis deux lectures bornées, pas de requête par
 * personne/créneau. Les horaires personnels ne quittent pas le serveur. */
export async function loadSessionSlotSuggestions(viewerId: string, guestIds: string[], durationMinutes: number, now: Date): Promise<SlotSuggestionsResult> {
  const requested = [...new Set([viewerId, ...guestIds])];
  const users = await prisma.user.findMany({
    where: { AND: [{ id: { in: requested } }, await creationMemberUserWhere(viewerId)] },
    select: { id: true },
  });
  // Refus explicite plutôt qu'un résultat calculé silencieusement sur moins
  // de personnes : départ, suspension, ids d'un autre serveur ou inventés.
  if (users.length !== requested.length || !users.some((user) => user.id === viewerId)) return { ok: false, error: "participants_changed" };
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 8 * 86_400_000); // Fin d'une soirée traversant minuit le septième jour.
  const [weekly, overrides] = await Promise.all([
    prisma.weeklyAvailability.findMany({ where: { userId: { in: requested } }, select: { userId: true, dayOfWeek: true, startTime: true, endTime: true } }),
    prisma.availabilityOverride.findMany({ where: { userId: { in: requested }, date: { gte: start, lt: end } }, select: { userId: true, date: true, available: true, startTime: true, endTime: true } }),
  ]);
  const weeklyByUser = new Map<string, typeof weekly>();
  const overridesByUser = new Map<string, typeof overrides>();
  for (const row of weekly) { const list = weeklyByUser.get(row.userId) ?? []; list.push(row); weeklyByUser.set(row.userId, list); }
  for (const row of overrides) { const list = overridesByUser.get(row.userId) ?? []; list.push(row); overridesByUser.set(row.userId, list); }
  const members = users.map(({ id }) => ({ id, weekly: weeklyByUser.get(id) ?? [], overrides: (overridesByUser.get(id) ?? []).map((row) => ({ ...row, date: toDateInputValue(row.date) })) }));
  return { ok: true, suggestions: suggestSessionSlots(members, viewerId, now, durationMinutes) };
}
