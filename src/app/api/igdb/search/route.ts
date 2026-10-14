import { NextRequest, NextResponse } from "next/server";
import { getValidSession } from "@/lib/valid-session";
import { searchIgdbGames } from "@/lib/igdb";
import { logger } from "@/lib/logger";

/**
 * Longueur maximale relayée à IGDB : aucun nom de jeu n'approche cette taille,
 * et la route est appelée à chaque frappe par un client authentifié. Une requête
 * plus longue (collage accidentel) est tronquée plutôt que refusée.
 */
const MAX_QUERY_LENGTH = 100;

export async function GET(request: NextRequest) {
  const session = await getValidSession();
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < 2) {
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
