import { getCurrentUser } from "@/lib/current-user";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { accessibleSessionWhereFor } from "@/lib/session-access";
import { wallClockNow } from "@/lib/wallclock";
import { buildIcalCalendar } from "@/lib/ical-calendar";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) return new Response(null, { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const scopedDb = await getActiveScopedPrisma(user.id);
  const sessions = await scopedDb.session.findMany({
    where: {
      date: { gte: wallClockNow() },
      status: { in: ["VOTING", "SCHEDULED"] },
      ...(await accessibleSessionWhereFor(user.id)),
    },
    select: { id: true, date: true, status: true, decidedGame: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  const calendar = buildIcalCalendar(sessions.map((session) => ({
    id: session.id,
    date: session.date,
    title: session.decidedGame?.name ? `Soirée GameNight — ${session.decidedGame.name}` : "Soirée GameNight",
    status: session.status === "SCHEDULED" ? "SCHEDULED" : "VOTING",
    url: new URL(`/sessions/${encodeURIComponent(session.id)}`, request.url).toString(),
  })));

  return new Response(calendar, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="gamenight.ics"',
      "Content-Type": "text/calendar; charset=utf-8",
    },
  });
}
