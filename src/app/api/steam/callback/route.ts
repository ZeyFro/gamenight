import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { importSteamLibrary, verifySteamOpenId } from "@/lib/steam";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.discordId) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const steamId64 = await verifySteamOpenId(request.nextUrl.searchParams);
  if (!steamId64) {
    return NextResponse.redirect(
      new URL("/profil?steam=erreur", request.url)
    );
  }

  const user = await prisma.user.update({
    where: { discordId: session.user.discordId },
    data: { steamId64 },
  });

  const result = await importSteamLibrary(user.id, steamId64);
  const status =
    result.status === "imported"
      ? `importe&count=${result.count}`
      : "prive";

  return NextResponse.redirect(new URL(`/profil?steam=${status}`, request.url));
}
