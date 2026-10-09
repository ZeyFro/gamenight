import { prisma } from "@/lib/prisma";
import { getOnboardingProgress, missingOnboardingSteps, onboardingEventKey, ONBOARDING_REMINDER } from "@/lib/onboarding";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { resolveAbsoluteUrl } from "@/lib/app-url";
import type { DeliveryResolver } from "@/lib/notification-executor";

/** Un MP par compte, même lors de connexions simultanées ou sur deux serveurs.
 * Le verrou User et le SEND partagent le commit. Aucun jeton n'est copié
 * dans le journal ; les tâches manquantes sont relues à la livraison. */
export async function enqueueOnboardingReminder(userId: string): Promise<void> {
  if (process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true" || !process.env.DISCORD_BOT_TOKEN?.trim()) return;
  if (await prisma.notificationEvent.findUnique({ where: onboardingEventKey(userId, ONBOARDING_REMINDER), select: { id: true } })) return;
  const progress = await getOnboardingProgress(userId);
  if (!progress || !missingOnboardingSteps(progress).length) return;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (await tx.notificationEvent.findUnique({ where: onboardingEventKey(userId, ONBOARDING_REMINDER), select: { id: true } })) return;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { silenceReminders: true, memberships: {
      where: { status: "ACTIVE", community: { status: "ACTIVE" } }, select: { communityId: true }, take: 1,
    } } });
    if (!user || user.silenceReminders || !user.memberships.length) return;
    const event = await createNotificationEvent({ category: "ADMIN", eventType: ONBOARDING_REMINDER, sourceId: userId,
      communityId: user.memberships[0].communityId }, tx);
    await enqueueDelivery({ eventId: event.id, channel: "DISCORD_DM", transport: "BOT", operation: "SEND",
      recipientKey: `user:${userId}`, targetSlot: `account:${userId}:ONBOARDING:welcome` }, tx);
  });
}

export const onboardingReminderResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== ONBOARDING_REMINDER || delivery.operation !== "SEND" ||
      delivery.channel !== "DISCORD_DM" || delivery.transport !== "BOT" || delivery.recipientKey !== `user:${event.sourceId}` ||
      delivery.targetSlot !== `account:${event.sourceId}:ONBOARDING:welcome`) return { eligible: false, reason: "unresolvable" };
    const user = await prisma.user.findUnique({ where: { id: event.sourceId }, select: { discordId: true, silenceReminders: true,
      memberships: { where: { communityId: event.communityId ?? "", status: "ACTIVE", community: { status: "ACTIVE" } }, select: { id: true }, take: 1 },
    } });
    if (!user?.memberships.length) return { eligible: false, reason: "expired" };
    if (user.silenceReminders) return { eligible: false, reason: "preference_declined" };
    const progress = await getOnboardingProgress(event.sourceId);
    const missing = progress ? missingOnboardingSteps(progress) : [];
    if (!missing.length) return { eligible: false, reason: "expired" };
    const origin = resolveAbsoluteUrl("/bienvenue", {
      VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_URL: process.env.VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    });
    if (!origin || !process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const lines = missing.map(step => step === "steam"
      ? `🎮 **Lie ton compte Steam** (ou indique que tu n'utilises pas Steam) : ${origin}?step=steam`
      : `📅 **Renseigne tes disponibilités** pour trouver les bons créneaux : ${origin.replace(/\/bienvenue$/, "/disponibilites")}`);
    return { eligible: true, action: { kind: "send_direct_message", userId: user.discordId,
      message: { embeds: [{ title: "Bienvenue sur GameNight 🎮", description: `Il reste quelques réglages pour jouer ensemble :\n\n${lines.join("\n\n")}\n\nGuide pas à pas : ${origin}`, color: 0x8b5cf6 }], allowedMentions: { parse: [] } },
    } };
  },
};
