import { prisma } from "@/lib/prisma";
import { resolveAbsoluteUrl } from "@/lib/app-url";
import { formatDateTimeFr, wallClockNow } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { filterUsersByNotificationPreference } from "@/lib/notification-preferences";
import { filterByActiveSessionInvite } from "@/lib/session-access";
import { isRouletteDirectMessageEnabled } from "@/lib/discord-bot-config";
import { enqueueDirectMessageEdits, enqueueDirectMessages, parseDmRole } from "@/lib/discord-dm";
import type { DiscordRestEmbed } from "@/lib/discord-rest";
import type { DeliveryResolver, Resolution, ResolvedAction, ResolveInput } from "@/lib/notification-executor";

/**
 * MP de la roulette (V2) — invitation et rappel ; à la fin (tirage fait ou
 * annulation faute de participants) le MP d'INVITATION déjà envoyé est ÉDITÉ
 * (jeu retenu / annulée), jamais un nouveau MP (`enqueueRouletteDirectMessageEdits`).
 * Même modèle que les MP des soirées/tournois (`discord-dm.ts`) : un MP par
 * pote (créateur inclus), préférence `ROULETTE` relue à l'envoi, aucun nouveau
 * MP vers un pote dont le MP de cette roulette est fermé.
 *
 * Une roulette n'a NI fil NI annonce publique (les annonces webhook sont
 * supprimées pour confidentialité, voir `discord-roulette.ts`) : il n'y a
 * donc aucune mention à retirer ni aucune mention de secours — un MP fermé
 * est seulement tracé (`FAILED`, `discord:dm_unavailable`).
 *
 * Kinds : `created` (invitation, éditée à la fin) et `reminder` (le rappel
 * reste en MP : pas de fil pour la roulette). L'ancien kind `result` n'est
 * plus mis en file ; ses lignes déjà en file sont abandonnées (`expired`).
 * Rôle de `targetSlot` :
 * `default-guild:ROULETTE:<rouletteId>:dm:<kind>:<userId>`.
 */

export type RouletteDmKind = "created" | "reminder";

/**
 * Fin de roulette : ÉDITE les MP d'invitation déjà envoyés (aucun nouveau MP,
 * aucune mention). Ne fait rien si l'interrupteur est éteint.
 */
export async function enqueueRouletteDirectMessageEdits(rouletteId: string): Promise<void> {
  if (!isRouletteDirectMessageEnabled()) return;
  await enqueueDirectMessageEdits({
    category: "ROULETTE",
    sourceId: rouletteId,
    eventType: "ROULETTE_DM_EDIT",
    kind: "created",
  });
}

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
 *   - `created` (SEND) : la roulette doit encore être `OPEN` ; (EDIT) : tout
 *     état — rend le jeu retenu (`DONE` avec sa soirée) ou « annulée »
 *     (`DONE` sans soirée), sinon l'invitation d'origine ;
 *   - `reminder` : `OPEN` ET deadline pas encore passée.
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
    // Ancien kind `result` : plus jamais envoyé (le MP d'invitation est édité).
    if (parsed.kind === "result") return { eligible: false, reason: "expired" };
    const kind = parsed.kind as RouletteDmKind;
    const isEdit = delivery.operation === "EDIT";
    if (isEdit && kind !== "created") return { eligible: false, reason: "unresolvable" };

    const roulette = await prisma.roulette.findUnique({ where: { id: rouletteId } });
    if (!roulette) return { eligible: false, reason: "expired" };

    if (kind === "created" && !isEdit && roulette.status !== "OPEN") return { eligible: false, reason: "expired" };
    if (kind === "reminder" && (roulette.status !== "OPEN" || roulette.deadline <= wallClockNow())) {
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

    if (isEdit && roulette.status === "DONE" && roulette.resultSessionId) {
      const session = await prisma.session.findUnique({
        where: { id: roulette.resultSessionId },
        select: { id: true, createdById: true, decidedGame: { select: { name: true } } },
      });
      if (!session) return { eligible: false, reason: "expired" };
      const [invited] = await filterByActiveSessionInvite(session.id, session.createdById, [recipient]);
      if (!invited) return { eligible: false, reason: "preference_declined" };
      content = `🎰 La roue a choisi : ${session.decidedGame?.name ?? "?"}`;
      embed = {
        title: content,
        description: formatDateTimeFr(roulette.scheduledAt),
        color: ACCENT_COLOR,
        ...(url ? { fields: [{ name: "Lien", value: url }] } : {}),
      };
    } else if (isEdit && roulette.status === "DONE") {
      content = "🎰 Roulette annulée — moins de 2 participants";
      embed = { title: content, description: formatDateTimeFr(roulette.scheduledAt), color: 0xef4444 };
    } else {
      content = kind === "reminder" ? "⏰ Roulette du gambling — dernier rappel" : "🎰 Roulette du gambling";
      embed = {
        title: content,
        description: `Propose tes 2 jeux avant ${formatDateTimeFr(roulette.deadline)}`,
        color: ACCENT_COLOR,
        ...(url ? { fields: [{ name: "Lien", value: url }] } : {}),
      };
    }

    const message = { content, embeds: [embed], allowedMentions: NO_MENTIONS };
    if (isEdit) {
      const sent = await prisma.notificationDelivery.findFirst({
        where: { targetSlot: delivery.targetSlot, operation: "SEND", status: "SENT" },
        select: { discordMessageId: true, discordChannelId: true },
      });
      if (!sent?.discordMessageId || !sent.discordChannelId) return { eligible: false, reason: "unresolvable" };
      const action: ResolvedAction = {
        kind: "edit_channel_message",
        channelId: sent.discordChannelId,
        messageId: sent.discordMessageId,
        isDirectMessage: true,
        message,
      };
      return { eligible: true, action };
    }
    const action: ResolvedAction = { kind: "send_direct_message", userId: recipient.discordId, message };
    return { eligible: true, action };
  },
};
