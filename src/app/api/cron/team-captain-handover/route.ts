import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { transferInactiveCommunityTeamCaptains } from "@/lib/community-team-handover";

export const maxDuration = 60;

/** Never scheduled automatically by this PR. Production execution requires
 * a separate explicit flag AND execute mode, protected by CRON_SECRET.
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "preview") {
    return NextResponse.json({ error: "preview_disabled" }, { status: 503 });
  }
  const authorized = verifyCronRequest(request);
  if (!authorized.ok) return NextResponse.json({ error: "unauthorized" }, { status: authorized.status });
  if (process.env.TEAM_CAPTAIN_HANDOVER_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, report: null });
  }
  const dryRun = process.env.TEAM_CAPTAIN_HANDOVER_MODE !== "execute";
  const result = await transferInactiveCommunityTeamCaptains(new Date(), dryRun);
  return NextResponse.json({ enabled: true, dryRun, ...result });
}
