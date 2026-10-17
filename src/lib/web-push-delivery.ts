import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { webPushConfig } from "@/lib/web-push-config";

export type WebPushPayload = { title: string; body: string; url: string };

export async function sendUserWebPush(userId: string, payload: WebPushPayload): Promise<void> {
  const config = webPushConfig(process.env);
  if (!config) return;

  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { vapidDetails: config, TTL: 60, urgency: "normal" }
      );
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : null;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.webPushSubscription.deleteMany({ where: { id: subscription.id, userId } });
      } else {
        logger.warn("web-push", "Échec de livraison push.", { userId, statusCode });
      }
    }
  }
}
