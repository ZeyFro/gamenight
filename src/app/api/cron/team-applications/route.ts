import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runTeamApplicationLifecycle } from "@/lib/team-application-lifecycle";
import { isTeamRecruitersEnabled } from "@/lib/team-recruiters-rules";

export const maxDuration = 60;

/**
 * Relance (48 h), expiration (7 j) des candidatures d'équipe et synchronisation d'accès des membres partis.
 * Fail-closed : 503 sans CRON_SECRET (`verifyCronRequest`) ; Preview bloquée ; sans TEAM_RECRUITERS_ENABLED aucun traitement.
 * Aucune cadence créée par le dépôt : à configurer en externe (docs/CRONS.md).
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "preview") {
    return NextResponse.json({ error: "preview_disabled" }, { status: 503 });
  }
  const authorized = verifyCronRequest(request);
  if (!authorized.ok) return NextResponse.json({ error: "unauthorized" }, { status: authorized.status });
  if (!isTeamRecruitersEnabled()) return NextResponse.json({ enabled: false });
  const report = await runTeamApplicationLifecycle(new Date());
  return NextResponse.json({ enabled: true, ...report });
}
