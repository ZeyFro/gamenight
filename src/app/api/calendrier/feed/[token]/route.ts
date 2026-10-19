import { readCalendarFeed } from "@/lib/calendar-feed";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const calendar = await readCalendarFeed(token, new URL(request.url).origin);
  return new Response(calendar, {
    status: calendar === null ? 404 : 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/calendar; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, noarchive",
    },
  });
}
