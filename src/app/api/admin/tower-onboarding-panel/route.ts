import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { isTowerOwner, towerGuildId } from "@/lib/tower-config";
import { isVercelPreview } from "@/lib/preview-safety";
import { checkSharedRateLimit } from "@/lib/shared-rate-limit";
import { recordSensitiveOperation } from "@/lib/sensitive-operation-log";
import { publishTowerWelcomePanel } from "@/lib/tower-onboarding-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const confirmation = z.object({ confirm: z.literal("PUBLIER_PANNEAU_TOWER") }).strict();
const respond = (body: object, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * One-shot, owner-only installation. No cron or automatic call path.
 * Publishing is a public Discord message, so the caller must be the Tower
 * owner and supply an explicit confirmation string in the request body.
 */
export async function POST(request: Request) {
  if (isVercelPreview()) return respond({ error: "preview_disabled" }, 503);

  const admin = await requireAdmin();
  if (!admin || !isTowerOwner(admin.discordId)) return respond({ error: "forbidden" }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "invalid_confirmation" }, 400);
  }
  if (!confirmation.safeParse(body).success) return respond({ error: "invalid_confirmation" }, 400);

  if (!(await checkSharedRateLimit(admin.id, "towerWelcomePanelPublish", { limit: 1, windowMs: 60_000 }))) {
    return respond({ error: "rate_limited" }, 429);
  }

  const channelId = process.env.TOWER_DISCORD_WELCOME_CHANNEL_ID;
  const result = await publishTowerWelcomePanel({
    guildId: towerGuildId(),
    channelId: channelId ?? "",
    deadline: new Date(Date.now() + 10_000),
  });
  if (!result.ok) {
    const status = result.kind === "not_configured" || result.kind === "destination_mismatch" ? 409 : 502;
    return respond({ error: result.kind }, status);
  }

  if (!result.data.alreadyPublished) {
    await recordSensitiveOperation({
      actorId: admin.id,
      action: "discord.welcome_panel_publish",
      outcome: "published",
      target: result.data.messageId,
    });
  }
  return respond({
    ok: true,
    alreadyPublished: result.data.alreadyPublished,
    messageId: result.data.messageId,
  }, result.data.alreadyPublished ? 200 : 201);
}
