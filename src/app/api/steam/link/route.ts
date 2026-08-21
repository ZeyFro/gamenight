import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSteamAuthUrl } from "@/lib/steam";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const returnTo = new URL(
    "/api/steam/callback",
    request.nextUrl.origin
  ).toString();

  return NextResponse.redirect(getSteamAuthUrl(returnTo));
}
