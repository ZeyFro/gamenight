import { NextResponse } from "next/server";
import { after } from "next/server";
import { runGameNewsBackfill } from "@/lib/backfill-game-news";
import { logger } from "@/lib/logger";

/** Même plafond/mécanique que `/api/backfill/steam-store` — voir ce fichier. */
export const maxDuration = 60;

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  after(() => {
    runGameNewsBackfill().catch((error) => {
      logger.error("game-news", error);
    });
  });

  return NextResponse.json(
    { status: "accepted", message: "Backfill des news gaming lancé en arrière-plan." },
    { status: 202 }
  );
}
