"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { GameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkLibraryBadges } from "@/lib/badges";
import { checkRateLimit } from "@/lib/rate-limit";
import { matchGameName } from "@/lib/family-import";
import { importSteamLibrary } from "@/lib/steam";
import { logger } from "@/lib/logger";

export interface FamilyImportGameSummary {
  id: string;
  name: string;
  coverUrl: string | null;
  isCoop: boolean;
}

export interface FamilyImportSuggestion {
  igdbId: number;
  name: string;
  coverUrl: string | null;
}

export interface FamilyImportItemResult {
  input: string;
  outcome: "imported" | "duplicate" | "needsConfirmation";
  game?: FamilyImportGameSummary;
  suggestion?: FamilyImportSuggestion | null;
  confidence?: number;
}

/**
 * Traite un lot de noms de jeux collés (`FamilyImportForm.tsx` appelle
 * cette action séquentiellement par lots de `FAMILY_IMPORT_BATCH_SIZE`,
 * pas en un seul appel géant — même leçon que les backfills coop
 * (PR "Optimisation build") : un lot de 300 recherches IGDB d'un coup
 * dépasserait largement la fenêtre d'exécution d'une requête serveur,
 * batcher côté client donne une vraie progress bar en prime).
 *
 * Pour chaque nom : recherche IGDB + score de confiance
 * (`src/lib/family-import.ts`). Sous le seuil de confiance ou sans
 * résultat → `needsConfirmation` (aucune écriture). Au-dessus du seuil :
 * upsert du `Game` (par `igdbId`, comme l'ajout manuel avec autocomplete)
 * puis, si l'utilisateur ne possède pas déjà ce jeu, création du
 * `UserGame` avec `source = FAMILY`. Un jeu déjà possédé (`PERSONAL`,
 * `MANUAL` ou `FAMILY` — peu importe la source d'origine) → `duplicate`,
 * aucune écriture non plus.
 *
 * Volontairement EXEMPTÉE du rate limiting (PR "Rate limiting") : déjà
 * auto-bornée (`FAMILY_IMPORT_BATCH_SIZE` par lot), séquentielle et
 * cadencée par l'utilisateur côté client — un import familial légitime de
 * plusieurs dizaines de jeux dépasserait la limite par défaut sans être du
 * spam.
 */
export async function matchFamilyImportBatch(
  names: string[]
): Promise<FamilyImportItemResult[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const results: FamilyImportItemResult[] = [];
  let importedCount = 0;

  for (const input of names) {
    const match = await matchGameName(input);

    if (match.status !== "matched" || !match.candidate) {
      results.push({
        input,
        outcome: "needsConfirmation",
        suggestion: match.candidate
          ? {
              igdbId: match.candidate.igdbId,
              name: match.candidate.name,
              coverUrl: match.candidate.coverUrl,
            }
          : null,
        confidence: match.confidence,
      });
      continue;
    }

    const candidate = match.candidate;

    // Sur un `Game` déjà existant, on ne touche qu'à `name`/`coverUrl`
    // (cosmétique, sans risque) — jamais `isCoop`/`maxPlayers` : ce jeu
    // peut déjà avoir `playInfoManual = true` (confirmé par un humain,
    // via l'ajout manuel ou l'onglet "À vérifier"), qu'un match
    // automatique ne doit pas écraser. Ces champs ne sont posés que sur
    // `create`, quand il n'y a encore rien à protéger.
    const dbGame = await prisma.game.upsert({
      where: { igdbId: candidate.igdbId },
      update: { name: candidate.name, coverUrl: candidate.coverUrl ?? undefined },
      create: {
        name: candidate.name,
        source: GameSource.IGDB,
        igdbId: candidate.igdbId,
        coverUrl: candidate.coverUrl,
        isCoop: candidate.isCoop,
        // Steam ne fournit pas cette donnée et IGDB non plus vraiment
        // (`searchIgdbGames` renvoie toujours `minPlayers: null`) — 2 par
        // défaut, même convention que l'import Steam perso et l'ajout
        // manuel (app pensée pour jouer à plusieurs).
        minPlayers: 2,
        maxPlayers: candidate.maxPlayers,
        addedById: user.id,
      },
    });

    const existing = await prisma.userGame.findUnique({
      where: { userId_gameId: { userId: user.id, gameId: dbGame.id } },
    });

    if (existing) {
      results.push({
        input,
        outcome: "duplicate",
        game: {
          id: dbGame.id,
          name: dbGame.name,
          coverUrl: dbGame.coverUrl,
          isCoop: dbGame.isCoop,
        },
      });
      continue;
    }

    await prisma.userGame.create({
      data: { userId: user.id, gameId: dbGame.id, owned: true, source: "FAMILY" },
    });
    importedCount += 1;

    results.push({
      input,
      outcome: "imported",
      game: {
        id: dbGame.id,
        name: dbGame.name,
        coverUrl: dbGame.coverUrl,
        isCoop: dbGame.isCoop,
      },
    });
  }

  if (importedCount > 0) await checkLibraryBadges(user.id);

  return results;
}

/**
 * Fix bug remonté (biblio Steam Family pénible à synchroniser) — bouton
 * "🔄 Resynchroniser Family" à côté de l'import copier-coller. Rappelle
 * `getOwnedGames`/`importSteamLibrary` avec `include_played_free_games`
 * désormais posé (voir `src/lib/steam.ts`), qui inclut parfois les jeux
 * Family selon les comptes — Steam ne documente aucune garantie officielle
 * là-dessus (aucun endpoint Family public), donc le résultat dépend du
 * compte. `newCount === 0` → l'API n'a rien renvoyé de nouveau, message
 * clair redirigeant vers le copier-coller plutôt qu'un faux "à jour"
 * silencieux.
 */
export async function resyncSteamFamilyAction() {
  const user = await getCurrentUser();
  if (!user?.steamId64) redirect("/profil/parametres");
  if (!checkRateLimit(user.id, "resyncSteamFamily")) {
    redirect("/profil/parametres?family=rate_limited");
  }

  // `redirect()` fonctionne en interne par exception (`NEXT_REDIRECT`) —
  // le `try` ne doit couvrir QUE l'appel réseau, jamais les `redirect()`
  // ci-dessous, sinon le `catch` générique les avalerait par erreur
  // (même garde-fou documenté sur `reimportSteamLibrary`, src/app/actions.ts).
  let result: Awaited<ReturnType<typeof importSteamLibrary>>;
  try {
    result = await importSteamLibrary(user.id, user.steamId64);
  } catch (error) {
    logger.error("steam", error, { userId: user.id, action: "resyncSteamFamily" });
    redirect("/profil/parametres?family=indisponible");
  }

  revalidatePath("/bibliotheque");

  if (result.status !== "imported") {
    redirect("/profil/parametres?family=prive");
  }
  redirect(
    result.newCount > 0
      ? `/profil/parametres?family=resync_ok&new=${result.newCount}`
      : "/profil/parametres?family=resync_vide"
  );
}
