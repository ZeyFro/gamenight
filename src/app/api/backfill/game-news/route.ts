import { NextResponse } from "next/server";
import { after } from "next/server";
import { runGameNewsBackfill } from "@/lib/backfill-game-news";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

/** Même plafond/mécanique que `/api/backfill/steam-store` — voir ce fichier. */
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
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
