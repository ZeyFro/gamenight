import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runTeamTournamentMaintenance } from "@/lib/tournament-teams";
import { isTournamentTeamsEnabled } from "@/lib/tournament-teams-rules";

export const maxDuration = 60;

/**
 * Tournois d'équipes : relance unique (12 h) du capitaine dont la confirmation de résultat attend, lancement des tournois dont l'échéance
 * d'inscription est passée. Fail-closed : 503 sans CRON_SECRET (`verifyCronRequest`) ; Preview bloquée ; sans TOURNAMENT_TEAMS_ENABLED aucun
 * traitement. Aucune cadence créée par le dépôt : à configurer en externe (docs/CRONS.md).
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "preview") {
    return NextResponse.json({ error: "preview_disabled" }, { status: 503 });
  }
  const authorized = verifyCronRequest(request);
  if (!authorized.ok) return NextResponse.json({ error: "unauthorized" }, { status: authorized.status });
  if (!isTournamentTeamsEnabled()) return NextResponse.json({ enabled: false });
  const report = await runTeamTournamentMaintenance(new Date());
  return NextResponse.json({ enabled: true, ...report });
}
