import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  importSteamLibrary,
  verifySteamOpenId,
  type ImportSteamLibraryResult,
} from "@/lib/steam";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.discordId) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // `verifySteamOpenId` fait un appel réseau vers Steam (vérification
  // OpenID) — non catché en amont, une panne Steam ferait planter tout ce
  // callback (redirection 500 brute) au lieu d'un simple retour à
  // /profil/parametres avec un message. Distinct de `steam=erreur`
  // (signature invalide, cas déjà géré ci-dessous) : ici Steam est
  // injoignable, pas la vérification qui a échoué.
  let steamId64: string | null;
  try {
    steamId64 = await verifySteamOpenId(request.nextUrl.searchParams);
  } catch (error) {
    console.error("[steam] Vérification OpenID injoignable (Steam down ?)", error);
    return NextResponse.redirect(
      new URL("/profil/parametres?steam=indisponible", request.url)
    );
  }
  if (!steamId64) {
    return NextResponse.redirect(
      new URL("/profil/parametres?steam=erreur", request.url)
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

  // Même logique : `importSteamLibrary` appelle Steam GetOwnedGames, pas
  // catché en amont. Le lien du compte (steamId64 en base, ci-dessus) est
  // déjà acquis à ce stade même si l'import échoue — l'utilisateur pourra
  // réessayer depuis /profil/parametres sans tout relier.
  let result: ImportSteamLibraryResult;
  try {
    result = await importSteamLibrary(user.id, steamId64);
  } catch (error) {
    console.error("[steam] Import de bibliothèque échoué (Steam down ?)", error);
    return NextResponse.redirect(
      new URL("/profil/parametres?steam=indisponible", request.url)
    );
  }

  const status =
    result.status === "imported"
      ? `importe&count=${result.count}`
      : "prive";

  return NextResponse.redirect(new URL(`/profil/parametres?steam=${status}`, request.url));
}
