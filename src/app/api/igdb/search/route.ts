import { NextRequest, NextResponse } from "next/server";
import { getValidSession } from "@/lib/valid-session";
import { searchIgdbGames } from "@/lib/igdb";
import { logger } from "@/lib/logger";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

/**
 * Longueur maximale relayée à IGDB : aucun nom de jeu n'approche cette taille,
 * et la route est appelée à chaque frappe par un client authentifié. Une requête
 * plus longue (collage accidentel) est tronquée plutôt que refusée.
 */
const MAX_QUERY_LENGTH = 100;

/**
 * Plafond par membre (audit du 23/11/2026, A04) : la route relaie chaque frappe vers IGDB, dont le quota est partagé ; un membre
 * connecté pouvait l'épuiser. 30 recherches par minute laissent la frappe rapide de la saisie assistée, et rien de plus.
 * Compteur en mémoire de l'instance (voir rate-limit.ts) : un garde-fou, pas une garantie stricte.
 */
const SEARCH_LIMIT_PER_MINUTE = 30;

export async function GET(request: NextRequest) {
  const session = await getValidSession();
  if (!session?.user?.discordId) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  if (!checkRateLimit(session.user.discordId, "igdb-search", { limit: SEARCH_LIMIT_PER_MINUTE })) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429, headers: { "Retry-After": "10" } });
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
