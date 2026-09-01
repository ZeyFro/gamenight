"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { importSteamLibrary, type ImportSteamLibraryResult } from "@/lib/steam";
import { checkLibraryBadges } from "@/lib/badges";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import {
  addManualGameSchema,
  idSchema,
  playerCountsSchema,
  VALIDATION_ERROR_KEY,
} from "@/lib/validations";
import { logger } from "@/lib/logger";

export async function addManualGame(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "addManualGame")) {
    redirect(`/bibliotheque/ajouter?error=${RATE_LIMIT_ERROR_KEY}`);
  }

  const nameInput = addManualGameSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    igdbId: formData.get("igdbId") ? String(formData.get("igdbId")) : "",
  });
  if (!nameInput.success) {
    redirect(`/bibliotheque/ajouter?error=${VALIDATION_ERROR_KEY}`);
  }
  const { name } = nameInput.data;
  const igdbId = nameInput.data.igdbId ? Number(nameInput.data.igdbId) : null;
  const coverUrl = formData.get("coverUrl")
    ? String(formData.get("coverUrl"))
    : null;
  const isCoop = formData.get("isCoop") === "on";

  const minPlayersRaw = formData.get("minPlayers");
  const maxPlayersRaw = formData.get("maxPlayers");
  // Bug corrigé : une saisie manuelle sans borne (ex. minPlayers=999) faussait
  // le calcul "jouable" de F5. minPlayers doit rester un nombre de joueurs
  // plausible, et maxPlayers (si renseigné) ne peut pas être sous minPlayers.
  const playersInput = playerCountsSchema.safeParse({
    minPlayers: minPlayersRaw ? Number(minPlayersRaw) : 2,
    maxPlayers: maxPlayersRaw ? Number(maxPlayersRaw) : null,
  });
  if (!playersInput.success) {
    redirect("/bibliotheque/ajouter?error=joueurs_invalide");
  }
  const { minPlayers, maxPlayers } = playersInput.data;

  const gameData = {
    name,
    coverUrl,
    isCoop,
    minPlayers,
    maxPlayers,
    // Saisie manuelle explicite (checkbox + champs nombre du formulaire) —
    // le backfill IGDB automatique (PR 32) ne doit plus jamais y toucher.
    playInfoManual: true,
  };

  const game = igdbId
    ? await prisma.game.upsert({
        where: { igdbId },
        update: gameData,
        create: {
          ...gameData,
          source: GameSource.IGDB,
          igdbId,
          addedById: user.id,
        },
      })
    : await prisma.game.create({
        data: { ...gameData, source: GameSource.MANUAL, addedById: user.id },
      });

  // `source: MANUAL` posé uniquement sur `create` — si ce jeu était déjà
  // possédé (PERSONAL ou FAMILY), un ajout manuel redondant ne doit pas
  // reclasser la relation existante.
  await prisma.userGame.upsert({
    where: { userId_gameId: { userId: user.id, gameId: game.id } },
    update: { owned: true },
    create: { userId: user.id, gameId: game.id, owned: true, source: "MANUAL" },
  });
  await checkLibraryBadges(user.id);

  revalidatePath("/bibliotheque");
  redirect("/bibliotheque");
}

export interface UpdateGameResult {
  ok: boolean;
  error?: string;
}

/**
 * Édite un jeu déjà en biblio (isCoop, min/maxPlayers, et le nom si
 * `source = MANUAL` uniquement — on ne renomme pas un jeu Steam/IGDB dont
 * le nom vient de la source externe). Invoquée directement depuis un
 * composant client (pas de `<form action=…>`) : retourne un résultat au
 * lieu de rediriger, pour piloter le panneau d'édition + le toast sans
 * navigation.
 */
export async function updateGame(formData: FormData): Promise<UpdateGameResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (!checkRateLimit(user.id, "updateGame")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const gameIdInput = idSchema.safeParse(formData.get("gameId"));
  if (!gameIdInput.success) return { ok: false, error: "missing_game" };
  const gameId = gameIdInput.data;

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return { ok: false, error: "not_found" };

  const owns = await prisma.userGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId } },
  });
  if (!owns) return { ok: false, error: "not_owned" };

  const isCoop = formData.get("isCoop") === "on";
  const minPlayersRaw = formData.get("minPlayers");
  const maxPlayersRaw = formData.get("maxPlayers");
  const playersInput = playerCountsSchema.safeParse({
    minPlayers: minPlayersRaw ? Number(minPlayersRaw) : 2,
    maxPlayers: maxPlayersRaw ? Number(maxPlayersRaw) : null,
  });
  if (!playersInput.success) {
    return { ok: false, error: "joueurs_invalide" };
  }
  const { minPlayers, maxPlayers } = playersInput.data;

  let name = game.name;
  if (game.source === "MANUAL") {
    const nameRaw = String(formData.get("name") ?? "").trim();
    if (!nameRaw) return { ok: false, error: "nom_requis" };
    name = nameRaw;
  }

  await prisma.game.update({
    where: { id: gameId },
    // Même raison que addManualGame : édition manuelle confirmée par un
    // humain, `playInfoManual: true` protège ces valeurs du backfill IGDB.
    data: { name, isCoop, minPlayers, maxPlayers, playInfoManual: true },
  });

  revalidatePath("/bibliotheque");
  return { ok: true };
}

/**
 * Bouton discret "Marquer/Retirer coop" sur `/bibliotheque` (PR 32,
 * 2.5/4 — Bug 2C) : override manuel rapide, pour corriger un jeu mal
 * catégorisé sans ouvrir le panneau d'édition complet. Marque
 * `playInfoManual: true` comme `updateGame` — protège ce choix du
 * backfill IGDB automatique (Bug 2A) au prochain déploiement.
 */
export async function toggleGameCoop(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "toggleGameCoop")) return;

  const gameIdInput = idSchema.safeParse(formData.get("gameId"));
  if (!gameIdInput.success) return;
  const gameId = gameIdInput.data;

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return;

  const owns = await prisma.userGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId } },
  });
  if (!owns) return;

  await prisma.game.update({
    where: { id: gameId },
    data: { isCoop: !game.isCoop, playInfoManual: true },
  });

  revalidatePath("/bibliotheque");
  revalidatePath("/bibliotheque/groupe");
  revalidatePath("/tierlist");
}

export async function removeUserGame(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "removeUserGame")) return;

  const gameIdInput = idSchema.safeParse(formData.get("gameId"));
  if (!gameIdInput.success) return;
  const gameId = gameIdInput.data;

  await prisma.userGame.deleteMany({ where: { userId: user.id, gameId } });
  revalidatePath("/bibliotheque");
}

/**
 * Réimport manuel (bouton "Réimporter ma bibliothèque Steam" et retry du
 * `<ApiErrorBanner>` sur /profil/parametres). `importSteamLibrary` appelle
 * l'API Steam en direct, sans catch interne — une panne Steam ferait
 * planter cette server action (donc la page) au lieu d'un simple retour
 * avec message. Le `try` ne couvre que l'appel réseau, jamais les
 * `redirect()` (qui fonctionnent en interne par exception `NEXT_REDIRECT`
 * — les englober dans le même `try/catch` les avalerait par erreur).
 */
export async function reimportSteamLibrary() {
  const user = await getCurrentUser();
  if (!user?.steamId64) redirect("/profil/parametres");
  if (!checkRateLimit(user.id, "reimportSteamLibrary")) {
    redirect(`/profil/parametres?steam=${RATE_LIMIT_ERROR_KEY}`);
  }

  let result: ImportSteamLibraryResult;
  try {
    result = await importSteamLibrary(user.id, user.steamId64);
  } catch (error) {
    logger.error("steam", error, { userId: user.id });
    redirect("/profil/parametres?steam=indisponible");
  }

  revalidatePath("/bibliotheque");
  redirect(
    result.status === "imported"
      ? `/profil/parametres?steam=importe&count=${result.count}`
      : "/profil/parametres?steam=prive"
  );
}
