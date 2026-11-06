import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getValidSession } from "@/lib/valid-session";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { webPushConfigIssue, webPushIssueMessage } from "@/lib/web-push-config";
import { isAllowedPushEndpoint, parseWebPushSubscription } from "@/lib/web-push-subscription";

async function requestBody(request: Request): Promise<unknown | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 4096) return null;
  try {
    const body = await request.text();
    if (body.length > 4096) return null;
    return JSON.parse(body);
  } catch { return null; }
}

async function userIdFromRequest() {
  const session = await getValidSession();
  if (!session?.user?.discordId) return null;
  const user = await prisma.user.findUnique({ where: { discordId: session.user.discordId }, select: { id: true } });
  return user?.id ?? null;
}

export async function POST(request: Request) {
  const userId = await userIdFromRequest();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const issue = webPushConfigIssue(process.env);
  if (issue) {
    if (issue.code !== "disabled") logger.warn("web-push", webPushIssueMessage(issue), { variables: issue.variables });
    return NextResponse.json({ error: "not_configured", reason: issue.code }, { status: 503 });
  }
  const subscription = parseWebPushSubscription(await requestBody(request));
  if (!subscription) return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });

  const existing = await prisma.webPushSubscription.findUnique({ where: { endpoint: subscription.endpoint }, select: { id: true, userId: true } });
  if (existing && existing.userId !== userId) return NextResponse.json({ error: "subscription_in_use" }, { status: 409 });
  if (!existing && await prisma.webPushSubscription.count({ where: { userId } }) >= 5) {
    return NextResponse.json({ error: "device_limit" }, { status: 409 });
  }
  try {
    if (existing) {
      await prisma.webPushSubscription.update({
        where: { id: existing.id },
        data: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      });
    } else {
      await prisma.webPushSubscription.create({
        data: {
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          userId,
        },
      });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "subscription_in_use" }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ ok: true }, { status: existing ? 200 : 201 });
}

export async function DELETE(request: Request) {
  const userId = await userIdFromRequest();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await requestBody(request);
  const endpoint = body && typeof body === "object" ? (body as { endpoint?: unknown }).endpoint : null;
  if (!isAllowedPushEndpoint(endpoint)) return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  await prisma.webPushSubscription.deleteMany({ where: { endpoint, userId } });
  return NextResponse.json({ ok: true });
}
