import { prisma } from "@/lib/prisma";
import { resolveAbsoluteUrl } from "@/lib/app-url";
import { formatDateTimeFr, wallClockNow } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import { filterByActiveSessionInvite } from "@/lib/session-access";
import { isRouletteDirectMessageEnabled } from "@/lib/discord-bot-config";
import { enqueueDirectMessages, parseDmRole } from "@/lib/discord-dm";
import type { DiscordRestEmbed } from "@/lib/discord-rest";
import type { DeliveryResolver, Resolution, ResolvedAction, ResolveInput } from "@/lib/notification-executor";

/**
 * MP de la roulette (V2) — invitation, rappel, et résultat (uniquement quand
 * la soirée issue du tirage n'est PAS sur le chemin bot, voir
 * `spinRoulette` : sinon ses MP sont déjà ceux des soirées). Même modèle que
 * les MP des soirées/tournois (`discord-dm.ts`) : un MP par pote (créateur
 * inclus), préférence `ROULETTE` relue à l'envoi, aucun nouveau MP vers un
 * pote dont le MP de cette roulette est fermé.
 *
 * Une roulette n'a NI fil NI annonce publique (les annonces webhook sont
 * supprimées pour confidentialité, voir `discord-roulette.ts`) : il n'y a
 * donc aucune mention à retirer ni aucune mention de secours — un MP fermé
 * est seulement tracé (`FAILED`, `discord:dm_unavailable`).
 *
 * Kinds : `created`, `reminder`, `result`. Rôle de `targetSlot` :
 * `default-guild:ROULETTE:<rouletteId>:dm:<kind>:<userId>`.
 */

export type RouletteDmKind = "created" | "reminder" | "result";

/**
 * Met en file un MP par pote éligible — `userIds` doit déjà être la liste
 * MÉTIER du destinataire (participants, ou seulement ceux qui n'ont pas
 * proposé leurs jeux, créateur inclus). Ne fait rien si l'interrupteur est
 * éteint. Préférence `ROULETTE` filtrée ici (évite des lignes inutiles) ET
 * relue à l'envoi.
 */
export async function enqueueRouletteDirectMessages(
  rouletteId: string,
  kind: RouletteDmKind,
  userIds: string[]
): Promise<void> {
  if (!isRouletteDirectMessageEnabled() || userIds.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, discordId: true, silenceReminders: true },
  });
  const allowed = await filterUsersByNotificationPreference(users, "ROULETTE");
  await enqueueDirectMessages({
    category: "ROULETTE",
    sourceId: rouletteId,
    eventType: "ROULETTE_DM",
    kind,
    users: allowed,
  });
}

function rouletteUrl(rouletteId: string): string | null {
  return resolveAbsoluteUrl(`/roulette/${rouletteId}`, {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
}

const NO_MENTIONS = { parse: [] as [] };
const ACCENT_COLOR = 0x8b5cf6;

/**
 * Résolveur ROULETTE — état relu JUSTE À TEMPS, jamais depuis l'enqueue :
 *   - `created` : la roulette doit encore être `OPEN` ;
 *   - `reminder` : `OPEN` ET deadline pas encore passée ;
 *   - `result` : `DONE` avec sa soirée, et le pote y est toujours invité
 *     (créateur exempté, comme partout : son accès n'est jamais révocable).
 * Le destinataire doit toujours faire partie des participants (ou être le
 * créateur) et avoir la préférence `ROULETTE` active.
 */
export const rouletteDmResolver: DeliveryResolver = {
  async resolve({ delivery, event }: ResolveInput): Promise<Resolution> {
    const rouletteId = event.sourceId;
    const role = delivery.targetSlot.split(":").slice(3).join(":");
    const parsed = parseDmRole(role, "dm:");
    if (!parsed || !["created", "reminder", "result"].includes(parsed.kind)) {
      return { eligible: false, reason: "unresolvable" };
    }
    const kind = parsed.kind as RouletteDmKind;

    const roulette = await prisma.roulette.findUnique({ where: { id: rouletteId } });
    if (!roulette) return { eligible: false, reason: "expired" };

    if (kind === "created" && roulette.status !== "OPEN") return { eligible: false, reason: "expired" };
    if (kind === "reminder" && (roulette.status !== "OPEN" || roulette.deadline <= wallClockNow())) {
      return { eligible: false, reason: "expired" };
    }
    if (kind === "result" && (roulette.status !== "DONE" || !roulette.resultSessionId)) {
      return { eligible: false, reason: "expired" };
    }

    const recipient = await prisma.user.findUnique({
      where: { id: parsed.userId },
      select: { id: true, discordId: true, silenceReminders: true },
    });
    if (!recipient) return { eligible: false, reason: "unresolvable" };

    const participantIds = resolveNotifiedUserIds(roulette.notifiedUserIds) ?? [];
    const isMember = recipient.id === roulette.createdById || participantIds.includes(recipient.id);
    if (!isMember) return { eligible: false, reason: "preference_declined" };
    if ((await filterUsersByNotificationPreference([recipient], "ROULETTE")).length === 0) {
      return { eligible: false, reason: "preference_declined" };
    }

    const url = rouletteUrl(roulette.id);
    let content: string;
    let embed: DiscordRestEmbed;

    if (kind === "result") {
      const session = await prisma.session.findUnique({
        where: { id: roulette.resultSessionId! },
        select: { id: true, createdById: true, decidedGame: { select: { name: true } } },
      });
      if (!session) return { eligible: false, reason: "expired" };
      const [invited] = await filterByActiveSessionInvite(session.id, session.createdById, [recipient]);
      if (!invited) return { eligible: false, reason: "preference_declined" };
      const gameName = session.decidedGame?.name ?? "?";
      content = `🎰 La roue a choisi : ${gameName}`;
      embed = {
        title: content,
        description: formatDateTimeFr(roulette.scheduledAt),
        color: ACCENT_COLOR,
        ...(url ? { fields: [{ name: "Lien", value: url }] } : {}),
      };
    } else {
      content = kind === "reminder" ? "⏰ Roulette du gambling — dernier rappel" : "🎰 Roulette du gambling";
      embed = {
        title: content,
        description: `Propose tes 2 jeux avant ${formatDateTimeFr(roulette.deadline)}`,
        color: ACCENT_COLOR,
        ...(url ? { fields: [{ name: "Lien", value: url }] } : {}),
      };
    }

    const action: ResolvedAction = {
      kind: "send_direct_message",
      userId: recipient.discordId,
      message: { content, embeds: [embed], allowedMentions: NO_MENTIONS },
    };
    return { eligible: true, action };
  },
};
