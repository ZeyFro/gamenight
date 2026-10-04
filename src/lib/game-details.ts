import { prisma } from "@/lib/prisma";
import {
  fetchIgdbGameDetails,
  resolveIgdbIdForSteamGame,
  type IgdbGameDetails,
} from "@/lib/igdb";
import { translateToFrench } from "@/lib/deepl";
import { logger } from "@/lib/logger";
import type { Game } from "@prisma/client";

/**
 * Dérive la mise à jour `isCoop`/`maxPlayers` à appliquer à `Game` depuis
 * une fiche IGDB fraîchement récupérée (PR 32, 2.5/4 — Bug 2). Même
 * logique dupliquée dans `prisma/backfill-coop.mjs` (script Node/ESM
 * autonome, pas d'accès aux alias `@/...`) — à garder en synchro si la
 * formule change. `minPlayers` n'est volontairement pas touché ici :
 * IGDB n'expose pas de vraie notion de "minimum" au-delà de ce que
 * l'app déduit déjà (2 par défaut, cf. `getProposalAvailability`), donc
 * rien à gagner à l'écraser depuis cette source.
 */
export function computePlayInfoFromIgdb(
  details: Pick<IgdbGameDetails, "isCoop" | "maxPlayersFromModes">,
  current: { isCoop: boolean; maxPlayers: number | null }
): { isCoop: boolean; maxPlayers: number | null } {
  return {
    isCoop: details.isCoop || current.isCoop,
    maxPlayers: current.maxPlayers ?? details.maxPlayersFromModes,
  };
}

export interface GameDetailsResult {
  details: IgdbGameDetails | null;
  fetchedAt: Date | null;
  /** `not_found` : pas d'igdbId, ou IGDB ne connaît pas ce jeu. `fetch_failed` : erreur réseau/API (et pas de cache existant à retomber dessus). */
  error: "not_found" | "fetch_failed" | null;
}

/**
 * Fiche IGDB détaillée d'un jeu (F : fiche jeu), avec cache en base
 * (`Game.igdbDetails`) — l'appel réel à IGDB ne se fait qu'à la demande
 * (premier affichage de `/jeux/[id]`, ou refresh forcé), jamais à l'import
 * Steam. Un échec réseau/API ne casse jamais la fiche : si un cache
 * existant (même périmé) est disponible on le renvoie, sinon `error`
 * indique au composant d'afficher un message propre plutôt que de planter.
 */
export async function getGameDetails(
  game: Pick<
    Game,
    | "id"
    | "igdbId"
    | "igdbDetails"
    | "igdbDetailsFetchedAt"
    | "source"
    | "steamAppId"
    | "name"
    | "isCoop"
    | "maxPlayers"
    | "playInfoManual"
  >,
  { forceRefresh = false, signal }: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<GameDetailsResult> {
  let igdbId = game.igdbId;

  // Bug corrigé : l'import Steam ne renseignait jamais `igdbId` — la
  // fiche ne tentait donc jamais de récupérer de description IGDB pour un
  // jeu Steam, quel que soit son état. On tente une résolution à la
  // demande (une seule fois : le résultat, trouvé ou non, est persisté).
  if (!igdbId && game.source === "STEAM" && game.steamAppId) {
    const resolved = await resolveIgdbIdForSteamGame(game.steamAppId, game.name);
    if (resolved.igdbId) {
      igdbId = resolved.igdbId;
      try {
        await prisma.game.update({ where: { id: game.id }, data: { igdbId } });
      } catch (err) {
        // Collision improbable sur la contrainte unique `igdbId` (deux
        // jeux Steam résolus vers le même jeu IGDB) : on continue quand
        // même à afficher les infos pour cette visite, on ne persiste
        // juste pas le lien.
        logger.error("igdb-match", err, { gameId: game.id, igdbId });
      }
    }
  }

  if (!igdbId) {
    return { details: null, fetchedAt: null, error: "not_found" };
  }

  // Bug corrigé : un jeu dont `igdbDetails` a été mis en cache par une
  // version de l'app antérieure au champ `descriptionFr` (la fiche jeu
  // existait avant la traduction DeepL) n'avait tout simplement pas cette
  // clé dans son JSON — `descriptionFr` valait `undefined`, pas `null`.
  // Une visite normale de la page (pas de refresh forcé) servait ce cache
  // pour toujours, sans jamais retenter de traduction : la description
  // restait en anglais indéfiniment, même avec DEEPL_API_KEY configurée.
  // On distingue explicitement les deux : `undefined` = cache d'avant la
  // fonctionnalité → on retraduit une fois pour rattraper ; `null` = la
  // traduction a déjà été tentée (échec, ou DEEPL_API_KEY absente) → on
  // respecte le cache et on ne re-tente pas à chaque page vue.
  const cachedDetails = game.igdbDetails as
    | (IgdbGameDetails & { descriptionFr?: string | null })
    | null;
  const cacheNeedsTranslationRetry =
    cachedDetails != null && typeof cachedDetails.descriptionFr === "undefined";

  if (!forceRefresh && game.igdbDetails && !cacheNeedsTranslationRetry) {
    return {
      details: game.igdbDetails as unknown as IgdbGameDetails,
      fetchedAt: game.igdbDetailsFetchedAt,
      error: null,
    };
  }

  if (cacheNeedsTranslationRetry) {
    logger.info("igdb", `Cache de ${game.id} antérieur au champ descriptionFr — retraduction rattrapée.`);
  }

  try {
    // Cache déjà complet (juste besoin de la traduction) : pas la peine de
    // refaire l'appel IGDB, seulement DeepL.
    const fetched =
      cacheNeedsTranslationRetry && cachedDetails && !forceRefresh
        ? cachedDetails
        : await fetchIgdbGameDetails(igdbId, { signal });
    if (!fetched) {
      // IGDB ne connaît pas cet `igdbId` : marque datée pour que le
      // backfill ne le retente pas à chaque passage.
      await prisma.game.update({
        where: { id: game.id },
        data: { igdbNotFoundAt: new Date() },
      });
      return { details: null, fetchedAt: null, error: "not_found" };
    }

    // Traduction FR faite une seule fois ici (pas dans fetchIgdbGameDetails,
    // qui reste un client IGDB pur) puis mise en cache avec le reste —
    // refaite à chaque refresh forcé comme demandé. Dégrade proprement :
    // sans DEEPL_API_KEY ou en cas d'échec, translateToFrench renvoie
    // `null` et la fiche retombe sur `summary` (VO) côté UI.
    const descriptionFr = fetched.summary
      ? await translateToFrench(fetched.summary)
      : null;
    const details: IgdbGameDetails = { ...fetched, descriptionFr };

    logger.info(
      "igdb",
      `Fiche ${game.id} mise en cache — descriptionFr ${
        descriptionFr ? "présente" : "absente (VO conservée)"
      }.`
    );

    const fetchedAt = new Date();
    // Bug 2 (PR 32, 2.5/4) : synchronise isCoop/maxPlayers depuis IGDB à
    // chaque (re)fetch de la fiche — sauf si un humain a déjà confirmé
    // ces valeurs (`playInfoManual`), auquel cas on ne touche à rien.
    const playInfoUpdate = game.playInfoManual
      ? {}
      : computePlayInfoFromIgdb(details, game);

    await prisma.game.update({
      where: { id: game.id },
      data: {
        igdbDetails: details as unknown as object,
        igdbDetailsFetchedAt: fetchedAt,
        igdbNotFoundAt: null,
        ...playInfoUpdate,
      },
    });

    return { details, fetchedAt, error: null };
  } catch (err) {
    logger.error("igdb", err, { gameId: game.id });
    if (game.igdbDetails) {
      return {
        details: game.igdbDetails as unknown as IgdbGameDetails,
        fetchedAt: game.igdbDetailsFetchedAt,
        error: null,
      };
    }
    return { details: null, fetchedAt: null, error: "fetch_failed" };
  }
}
