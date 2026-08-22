import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { importSteamLibrary, verifySteamOpenId } from "@/lib/steam";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";

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

  // Lu avant l'update : "1ère fois" au sens de l'Axe 1 XP = aucun Steam
  // encore lié pour ce user (un re-lien/changement de compte ne recrédite
  // pas — cohérent avec "1ère fois" au sens littéral).
  const before = await prisma.user.findUnique({
    where: { discordId: session.user.discordId },
    select: { id: true, steamId64: true },
  });
  const isFirstLink = !before?.steamId64;

  const user = await prisma.user.update({
    where: { discordId: session.user.discordId },
    data: { steamId64 },
  });

  if (isFirstLink) {
    await awardXp(user.id, "STEAM_LINK_FIRST", user.id, XP_AMOUNTS.STEAM_LINK_FIRST);
  }

  const result = await importSteamLibrary(user.id, steamId64);
  const status =
    result.status === "imported"
      ? `importe&count=${result.count}`
      : "prive";

  return NextResponse.redirect(new URL(`/profil?steam=${status}`, request.url));
}
