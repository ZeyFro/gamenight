import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { assignDailyTowerTeamChallenges } from "@/lib/tower-team-daily";

export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status },
    );
  }

  if (process.env.TOWER_TEAM_DAILY_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, checked: 0, failed: 0 });
  }

  const summary = await assignDailyTowerTeamChallenges(new Date(Date.now() + 20_000));
  return NextResponse.json({ enabled: true, ...summary });
}
