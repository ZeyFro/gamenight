import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importSteamLibrary } from "@/lib/steam";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { wallClockNow } from "@/lib/wallclock";

/**
 * Fix "cron Steam surdimensionné" — import complet de bibliothèque
 * (upserts `Game`/`UserGame`, badges, wishlist via `importSteamLibrary`,
 * strictement inchangée) déplacé ici, à une cadence bien plus basse que
 * l'ancien cron toutes les 2 min (recommandé : toutes les ~2h). Le
 * rafraîchissement fréquent de l'activité affichée se fait désormais
 * ailleurs, via `steam-library-sync` (`refreshSteamActivity`, léger, aucun
 * upsert).
 *
 * Rotation round-robin : UN SEUL compte traité par passage
 * (`steamFullSyncAttemptedAt` ASC, `nulls: "first"` pour prioriser les
 * comptes jamais encore traités), pour ne jamais risquer d'agréger le
 * temps de plusieurs bibliothèques volumineuses dans une seule invocation.
 * `steamFullSyncAttemptedAt` est posé ICI (pas dans `importSteamLibrary`,
 * qui reste décorrélée de toute notion de rotation cron) INCONDITIONNELLEMENT
 * avant la tentative — un compte qui échoue systématiquement (bibliothèque
 * trop volumineuse, panne persistante) avance quand même en fin de file à
 * chaque tentative plutôt que de monopoliser indéfiniment la première
 * place.
 *
 * `steamLastSyncAt` (posée par `importSteamLibrary` elle-même, seulement
 * après succès complet — upserts + badges + wishlist) n'est délibérément
 * PAS utilisée pour la rotation : elle ne doit refléter qu'un succès réel,
 * jamais une tentative, donc un compte en échec répété resterait
 * indéfiniment "le plus ancien" si on s'y fiait pour l'ordre — d'où le
 * champ dédié `steamFullSyncAttemptedAt`.
 *
 * Avec ~5 comptes liés et une cadence de 2h, chaque compte repasse en
 * rotation en une dizaine d'heures — largement sous une journée, sans
 * jamais approcher les 60s de `maxDuration` puisqu'un seul compte est
 * traité par passage.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  const nextUser = await prisma.user.findFirst({
    where: { steamId64: { not: null } },
    orderBy: [{ steamFullSyncAttemptedAt: { sort: "asc", nulls: "first" } }],
    select: { id: true, steamId64: true },
  });

  if (!nextUser) {
    return NextResponse.json({ attempted: false });
  }

  // Posé inconditionnellement avant la tentative — voir docstring ci-dessus
  // (jamais `steamLastSyncAt`, réservée au succès réel).
  await prisma.user.update({
    where: { id: nextUser.id },
    data: { steamFullSyncAttemptedAt: wallClockNow() },
  });

  try {
    const result = await importSteamLibrary(nextUser.id, nextUser.steamId64!);
    logger.info(
      "cron:steam-library-full-sync",
      result.status === "imported"
        ? `Import complet réussi — ${result.count} jeu(x), ${result.newCount} nouveau(x).`
        : "Import complet — profil privé."
    );
    return NextResponse.json({ attempted: true, status: result.status });
  } catch (error) {
    logger.error("cron:steam-library-full-sync", error, { userId: nextUser.id });
    return NextResponse.json({ attempted: true, status: "error" }, { status: 500 });
  }
}
