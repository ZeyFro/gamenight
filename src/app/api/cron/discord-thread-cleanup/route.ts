import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runDiscordThreadCleanup } from "@/lib/discord-thread-cleanup";

/**
 * Nettoyage automatique des fils Discord (V2) — voir
 * `src/lib/discord-thread-cleanup.ts` pour la règle (archivage + verrouillage
 * à la fin, suppression 24 h plus tard). Cette route n'enqueue que des
 * intentions ; c'est `/api/cron/notification-executor` qui appelle Discord.
 *
 * Mêmes deux verrous que `retention-cleanup`, indépendants de lui :
 *   1. `DISCORD_THREAD_CLEANUP_ENABLED=true` — sinon rien n'est lu ni écrit.
 *   2. `DISCORD_THREAD_CLEANUP_MODE=execute` — sinon dry-run (rapport seul).
 *
 * Appelée par le cron externe (cron-job.org), authentifiée par
 * `CRON_SECRET` comme toutes les routes `/api/cron/*`.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    if (auth.status === 503) {
      logger.error("cron:discord-thread-cleanup", "CRON_SECRET non configurée — route désactivée.");
    }
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  if (process.env.DISCORD_THREAD_CLEANUP_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, dryRun: true, report: null });
  }

  const dryRun = process.env.DISCORD_THREAD_CLEANUP_MODE !== "execute";
  const report = await runDiscordThreadCleanup({ dryRun });

  logger.info("cron:discord-thread-cleanup", "Passage terminé.", {
    dryRun,
    sessionsArchived: report.sessions.archiveEnqueued.length,
    sessionsDeleted: report.sessions.deleteEnqueued.length,
    tournamentsArchived: report.tournaments.archiveEnqueued.length,
    tournamentsDeleted: report.tournaments.deleteEnqueued.length,
    archiveFailed: report.sessions.archiveFailed.length + report.tournaments.archiveFailed.length,
    truncated: report.truncated,
  });

  return NextResponse.json({ enabled: true, dryRun, report });
}
