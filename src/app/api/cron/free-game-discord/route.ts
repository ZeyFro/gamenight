import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { enqueueFreeGameAnnouncements } from "@/lib/free-game-discord";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.status === 503 ? "not_configured" : "unauthorized" }, { status: auth.status });

  const enabled = process.env.DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED === "true";
  if (!enabled) return NextResponse.json({ enabled: false, enqueued: 0 });

  try {
    const result = await enqueueFreeGameAnnouncements();
    logger.info("cron:free-game-discord", "Offres ajoutées à la file Discord.", result);
    return NextResponse.json({ enabled: true, ...result });
  } catch (error) {
    logger.error("cron:free-game-discord", error);
    return NextResponse.json({ error: "announcement_enqueue_failed" }, { status: 500 });
  }
}
