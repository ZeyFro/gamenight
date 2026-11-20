import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { editSetupResponse, NO_MENTIONS } from "@/lib/discord-rest";
import type { DeliveryResolver } from "@/lib/notification-executor";
import type { InteractionOutput } from "@/lib/discord-interactions";

/**
 * Commande contextuelle « Signaler » (clic droit sur un message, type 3,
 * DISCORD_REPORT_COMMAND_ENABLED). Un membre actif signale un message : une
 * `ModerationReport` est écrite (journal) et un ticket est posté dans le salon
 * staff PRIVÉ `DISCORD_REPORT_STAFF_CHANNEL_ID` par la file de notifications
 * (événement ADMIN MODERATION_REPORT, executor, jamais d'appel direct).
 *
 * AUCUNE sanction automatique : ni suppression de message, ni mute, ni ban, ni
 * retrait de rôle. Le contenu n'est gardé que sous forme d'extrait de 500
 * caractères ; aucune mention n'est jamais déclenchée (allowedMentions vide).
 */
export const MODERATION_REPORT_EVENT = "MODERATION_REPORT";
export const REPORT_COMMAND_NAME = "Signaler";
export const MAX_EXCERPT = 500;
/** Au plus 5 signalements par membre et par heure (anti-abus, compté en base). */
export const REPORT_HOURLY_LIMIT = 5;
const EPHEMERAL = 64;
const REPLY_BUDGET_MS = 10_000;
const snowflake = z.string().regex(/^[0-9]{16,20}$/);

export const reportCommandEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.DISCORD_REPORT_COMMAND_ENABLED === "true";

export function reportQueueReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    reportCommandEnabled(env) &&
    env.NOTIFICATION_EXECUTOR_ENABLED === "true" &&
    Boolean(env.DISCORD_BOT_TOKEN?.trim()) &&
    snowflake.safeParse(env.DISCORD_REPORT_STAFF_CHANNEL_ID?.trim()).success
  );
}

const inputSchema = z.object({
  type: z.literal(2),
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake,
  member: z.object({ user: z.object({ id: snowflake, bot: z.literal(false).optional() }) }),
  data: z.object({
    name: z.literal(REPORT_COMMAND_NAME),
    type: z.literal(3),
    target_id: snowflake,
    resolved: z.object({
      messages: z.record(
        z.string(),
        z.object({
          id: snowflake,
          channel_id: snowflake,
          content: z.string().max(8_000).default(""),
          author: z.object({ id: snowflake, bot: z.boolean().optional() }),
          attachments: z.array(z.unknown()).max(50).optional(),
        })
      ),
    }),
  }),
});

export interface ReportedMessage {
  messageId: string;
  channelId: string;
  authorDiscordId: string;
  authorIsBot: boolean;
  content: string;
  attachmentCount: number;
}

/** Extrait borné, sur une seule ligne logique, sans ruptures de citation. */
export function reportExcerpt(content: string): string {
  const flat = content.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return flat.length > MAX_EXCERPT ? `${flat.slice(0, MAX_EXCERPT - 1)}…` : flat;
}

export const messageUrl = (guildId: string, channelId: string, messageId: string) =>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

export type ReportOutcome =
  | "recorded"
  | "disabled"
  | "not_member"
  | "own_message"
  | "bot_message"
  | "duplicate"
  | "rate_limited"
  | "unavailable";

export const REPORT_REPLIES: Record<ReportOutcome, string> = {
  recorded: "✅ Merci : ton signalement a été transmis en privé au staff. Aucune sanction n'est appliquée automatiquement, le staff examine le message.",
  disabled: "Le signalement n'est pas encore ouvert sur ce serveur. Contacte directement le staff.",
  not_member: "Ton compte Discord n'est pas encore membre actif de cette communauté GameNight : connecte-toi une fois sur le site, puis réessaie.",
  own_message: "Tu ne peux pas signaler ton propre message.",
  bot_message: "Ce message vient d'un bot : contacte le staff directement.",
  duplicate: "Tu as déjà signalé ce message : le staff est au courant.",
  rate_limited: "Tu as envoyé beaucoup de signalements récemment. Réessaie dans une heure ou contacte le staff.",
  unavailable: "Le signalement est momentanément indisponible. Contacte directement le staff.",
};

const isMissingTable = (error: unknown) => {
  const code = (error as { code?: string }).code;
  return code === "P2021" || code === "P2022" || (error as Error)?.message?.includes("does not exist") === true;
};

export async function submitModerationReport(input: {
  guildId: string;
  reporterDiscordId: string;
  message: ReportedMessage;
  now?: Date;
  enqueue?: typeof enqueueReportTicket;
}): Promise<ReportOutcome> {
  if (!reportCommandEnabled()) return "disabled";
  const { message } = input;
  if (message.authorDiscordId === input.reporterDiscordId) return "own_message";
  if (message.authorIsBot) return "bot_message";
  const now = input.now ?? new Date();
  const community = await prisma.community.findFirst({
    where: { discordGuildId: input.guildId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!community) return "not_member";
  const reporter = await prisma.user.findUnique({
    where: { discordId: input.reporterDiscordId },
    select: { id: true, memberships: { where: { communityId: community.id, status: "ACTIVE" }, select: { id: true } } },
  });
  if (!reporter?.memberships.length) return "not_member";

  const scopedDb = scopedPrisma({ communityIds: [community.id], includesDefault: false });
  try {
    const recent = await scopedDb.moderationReport.count({
      where: { reporterDiscordId: input.reporterDiscordId, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } },
    });
    if (recent >= REPORT_HOURLY_LIMIT) return "rate_limited";
    const duplicate = await scopedDb.moderationReport.findFirst({
      where: { guildId: input.guildId, messageId: message.messageId, reporterDiscordId: input.reporterDiscordId },
      select: { id: true },
    });
    if (duplicate) return "duplicate";
    let report: { id: string };
    try {
      report = await scopedDb.moderationReport.create({
        data: {
          communityId: community.id,
          guildId: input.guildId,
          channelId: message.channelId,
          messageId: message.messageId,
          authorDiscordId: message.authorDiscordId,
          reporterDiscordId: input.reporterDiscordId,
          messageUrl: messageUrl(input.guildId, message.channelId, message.messageId),
          excerpt: reportExcerpt(message.content),
          attachmentCount: message.attachmentCount,
        },
        select: { id: true },
      });
    } catch (error) {
      // Double clic simultané : l'unicité (serveur, message, signaleur) tranche.
      if ((error as { code?: string }).code === "P2002") return "duplicate";
      throw error;
    }
    // Journal : identifiants seulement, jamais le contenu du message.
    logger.info("moderation-report", "Signalement enregistré.", { reportId: report.id, communityId: community.id });
    if (reportQueueReady()) {
      const queued = await (input.enqueue ?? enqueueReportTicket)({ reportId: report.id, communityId: community.id, guildId: input.guildId, now });
      if (queued) await scopedDb.moderationReport.updateMany({ where: { id: report.id, communityId: community.id }, data: { ticketQueuedAt: now } });
    }
    return "recorded";
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    logger.warn("moderation-report", "Table des signalements absente : migration requise.");
    return "unavailable";
  }
}

const slotFor = (guildId: string, reportId: string) => `${guildId}:ADMIN:${reportId}:report-ticket`;

export async function enqueueReportTicket(input: { reportId: string; communityId: string; guildId: string; now: Date }): Promise<boolean> {
  try {
    const event = await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: MODERATION_REPORT_EVENT,
      sourceId: input.reportId,
      payload: { reportId: input.reportId },
    });
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `report:${input.reportId}`,
      targetSlot: slotFor(input.guildId, input.reportId),
    });
    return true;
  } catch (error) {
    // Le signalement reste enregistré (visible du staff dans /admin) ; seul le ticket Discord manque.
    logger.warn("moderation-report", "Ticket de signalement non enfilé.", { errorType: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}

/** Neutralise les mentions et la mise en forme Discord dans l'extrait cité. */
export function quoteExcerpt(excerpt: string): string {
  const safe = excerpt.replace(/@/g, "@​").replace(/`/g, "'");
  return safe ? safe.split("\n").map((line) => `> ${line}`).join("\n").slice(0, 1_000) : "> (message sans texte)";
}

export const reportTicketResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== MODERATION_REPORT_EVENT || !event.communityId) {
      return { eligible: false, reason: "unresolvable" };
    }
    if (!reportCommandEnabled()) return { eligible: false, reason: "not_configured" };
    const channelId = process.env.DISCORD_REPORT_STAFF_CHANNEL_ID?.trim() ?? "";
    if (!process.env.DISCORD_BOT_TOKEN?.trim() || !snowflake.safeParse(channelId).success) {
      return { eligible: false, reason: "configuration_unavailable" };
    }
    const community = await prisma.community.findUnique({ where: { id: event.communityId }, select: { status: true, discordGuildId: true } });
    if (community?.status !== "ACTIVE" || !community.discordGuildId) return { eligible: false, reason: "expired" };
    if (
      delivery.operation !== "SEND" ||
      delivery.channel !== "DISCORD_CHANNEL" ||
      delivery.transport !== "BOT" ||
      delivery.recipientKey !== `report:${event.sourceId}` ||
      delivery.targetSlot !== slotFor(community.discordGuildId, event.sourceId)
    ) {
      return { eligible: false, reason: "unresolvable" };
    }
    const scopedDb = scopedPrisma({ communityIds: [event.communityId], includesDefault: false });
    const report = await scopedDb.moderationReport.findFirst({
      where: { id: event.sourceId, communityId: event.communityId },
      select: { messageUrl: true, channelId: true, authorDiscordId: true, reporterDiscordId: true, excerpt: true, attachmentCount: true, closedAt: true, createdAt: true },
    });
    if (!report || report.closedAt) return { eligible: false, reason: "expired" };
    return {
      eligible: true,
      action: {
        kind: "send_channel_message",
        channelId,
        message: {
          embeds: [
            {
              title: "🚩 Signalement de message",
              description: quoteExcerpt(report.excerpt),
              color: 0xd97706,
              fields: [
                { name: "Message", value: report.messageUrl },
                { name: "Salon", value: `<#${report.channelId}>`, inline: true },
                { name: "Auteur", value: `<@${report.authorDiscordId}>`, inline: true },
                { name: "Signalé par", value: `<@${report.reporterDiscordId}>`, inline: true },
                ...(report.attachmentCount > 0 ? [{ name: "Pièces jointes", value: String(report.attachmentCount), inline: true }] : []),
                { name: "Suite", value: "Aucune sanction automatique : le staff examine le contexte et décide." },
              ],
            },
          ],
          allowedMentions: NO_MENTIONS,
        },
      },
    };
  },
};

/** Exclusivement appelé après la vérification Ed25519 du corps brut dans discord-interactions. */
export function handleSignedReportInteraction(body: unknown, timestamp: string | null): InteractionOutput {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { status: 400 };
  const interaction = parsed.data;
  const seconds = Number(timestamp);
  const target = interaction.data.resolved.messages[interaction.data.target_id];
  if (
    !target ||
    !timestamp ||
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300 ||
    interaction.application_id !== process.env.DISCORD_CLIENT_ID
  ) {
    return { status: 400 };
  }
  // ACK immédiat (< 3 s) : aucune requête SQL ni Discord avant la réponse.
  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runReport: async () => {
      let outcome: ReportOutcome;
      try {
        outcome = await submitModerationReport({
          guildId: interaction.guild_id,
          reporterDiscordId: interaction.member.user.id,
          message: {
            messageId: target.id,
            channelId: target.channel_id,
            authorDiscordId: target.author.id,
            authorIsBot: target.author.bot === true,
            content: target.content,
            attachmentCount: target.attachments?.length ?? 0,
          },
        });
      } catch (error) {
        logger.warn("moderation-report", "Échec du traitement du signalement.", { errorType: error instanceof Error ? error.name : "unknown" });
        outcome = "unavailable";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: REPORT_REPLIES[outcome],
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("moderation-report", "Réponse privée de Signaler non livrée.", { kind: sent.kind });
    },
  };
}
