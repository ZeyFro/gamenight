import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getValidSession } from "@/lib/valid-session";
import { prisma } from "@/lib/prisma";
import {
  importSteamLibrary,
  verifySteamOpenId,
  type ImportSteamLibraryResult,
} from "@/lib/steam";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { logger } from "@/lib/logger";

const STEAM_STATE_COOKIE = "steam_link_state";

export async function GET(request: NextRequest) {
  const session = await getValidSession();
  if (!session?.user?.discordId) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // `state` à usage unique (posé par `steam/link`) : le cookie doit exister
  // et être identique à celui du `return_to` — sinon l'assertion ne vient
  // pas du flux démarré par CETTE session (login CSRF / rejeu). Le cookie
  // est supprimé dans tous les cas.
  const redirect = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url));
    res.cookies.set(STEAM_STATE_COOKIE, "", { path: "/api/steam", maxAge: 0 });
    return res;
  };
  const state = request.cookies.get(STEAM_STATE_COOKIE)?.value;
  if (!state || request.nextUrl.searchParams.get("state") !== state) {
    return redirect("/profil/parametres?steam=erreur");
  }
  const expectedReturnTo = new URL("/api/steam/callback", request.nextUrl.origin);
  expectedReturnTo.searchParams.set("state", state);

  // `verifySteamOpenId` fait un appel réseau vers Steam (vérification
  // OpenID) — non catché en amont, une panne Steam ferait planter tout ce
  // callback (redirection 500 brute) au lieu d'un simple retour à
  // /profil/parametres avec un message. Distinct de `steam=erreur`
  // (signature invalide, cas déjà géré ci-dessous) : ici Steam est
  // injoignable, pas la vérification qui a échoué.
  let steamId64: string | null;
  try {
    steamId64 = await verifySteamOpenId(request.nextUrl.searchParams, expectedReturnTo.toString());
  } catch (error) {
    logger.error("steam", error, { step: "verify-openid" });
    return redirect("/profil/parametres?steam=indisponible");
  }
  if (!steamId64) {
    return redirect("/profil/parametres?steam=erreur");
  }

  // Lu avant l'update : "1ère fois" au sens de l'Axe 1 XP = aucun Steam
  // encore lié pour ce user (un re-lien/changement de compte ne recrédite
  // pas — cohérent avec "1ère fois" au sens littéral).
  const before = await prisma.user.findUnique({
    where: { discordId: session.user.discordId },
    select: { id: true, steamId64: true },
  });
  const isFirstLink = !before?.steamId64;

  let user;
  try {
    user = await prisma.user.update({
      where: { discordId: session.user.discordId },
      data: { steamId64 },
    });
  } catch (error) {
    // `steamId64` est unique : ce Steam est déjà lié à un autre compte.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      logger.warn("steam", "SteamID déjà lié à un autre compte — liaison refusée.");
      return redirect("/profil/parametres?steam=erreur");
    }
    throw error;
  }

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
    logger.error("steam", error, { step: "import-library", userId: user.id });
    return redirect("/profil/parametres?steam=indisponible");
  }

  const status =
    result.status === "imported"
      ? `importe&count=${result.count}`
      : "prive";

  return redirect(`/profil/parametres?steam=${status}`);
}
