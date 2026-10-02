import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getValidSession } from "@/lib/valid-session";
import { getSteamAuthUrl } from "@/lib/steam";

const STEAM_STATE_COOKIE = "steam_link_state";

export async function GET(request: NextRequest) {
  const session = await getValidSession();
  if (!session?.user?.discordId) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // `state` aléatoire : posé en cookie ET dans le `return_to` (signé par
  // Steam). Le callback exige les deux identiques et supprime le cookie :
  // l'assertion est liée à CETTE session et ne peut servir qu'une fois.
  const state = randomBytes(16).toString("hex");
  const returnTo = new URL("/api/steam/callback", request.nextUrl.origin);
  returnTo.searchParams.set("state", state);

  const response = NextResponse.redirect(getSteamAuthUrl(returnTo.toString()));
  response.cookies.set(STEAM_STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax", // Steam revient par navigation top-level GET
    path: "/api/steam",
    maxAge: 600,
  });
  return response;
}
