import { NextRequest, NextResponse } from "next/server";
import { getValidSession } from "@/lib/valid-session";
import { getSteamAuthUrl } from "@/lib/steam";

export async function GET(request: NextRequest) {
  const session = await getValidSession();
  if (!session?.user?.discordId) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const returnTo = new URL(
    "/api/steam/callback",
    request.nextUrl.origin
  ).toString();

  return NextResponse.redirect(getSteamAuthUrl(returnTo));
}
