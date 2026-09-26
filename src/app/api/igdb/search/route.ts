import { NextRequest, NextResponse } from "next/server";
import { getValidSession } from "@/lib/valid-session";
import { searchIgdbGames } from "@/lib/igdb";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const session = await getValidSession();
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchIgdbGames(query);
    return NextResponse.json({ results });
  } catch (error) {
    logger.error("igdb", error, { query });
    return NextResponse.json(
      { error: "La recherche IGDB a échoué." },
      { status: 502 }
    );
  }
}
