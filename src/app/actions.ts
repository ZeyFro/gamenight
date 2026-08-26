"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { importSteamLibrary } from "@/lib/steam";
import { checkLibraryBadges } from "@/lib/badges";

export async function addManualGame(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const igdbIdRaw = formData.get("igdbId");
  const igdbId = igdbIdRaw ? Number(igdbIdRaw) : null;
  const coverUrl = formData.get("coverUrl")
    ? String(formData.get("coverUrl"))
    : null;
  const isCoop = formData.get("isCoop") === "on";
  const minPlayersRaw = formData.get("minPlayers");
  const maxPlayersRaw = formData.get("maxPlayers");
  const minPlayers = minPlayersRaw ? Number(minPlayersRaw) : 2;
  const maxPlayers = maxPlayersRaw ? Number(maxPlayersRaw) : null;

  // Bug corrigé : une saisie manuelle sans borne (ex. minPlayers=999) faussait
  // le calcul "jouable" de F5. minPlayers doit rester un nombre de joueurs
  // plausible, et maxPlayers (si renseigné) ne peut pas être sous minPlayers.
  const invalidMin =
    !Number.isFinite(minPlayers) || minPlayers < 1 || minPlayers > 100;
  const invalidMax =
    maxPlayers !== null &&
    (!Number.isFinite(maxPlayers) || maxPlayers < minPlayers);
  if (invalidMin || invalidMax) {
    redirect("/bibliotheque/ajouter?error=joueurs_invalide");
  }

  const gameData = { name, coverUrl, isCoop, minPlayers, maxPlayers };

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

  await prisma.userGame.upsert({
    where: { userId_gameId: { userId: user.id, gameId: game.id } },
    update: { owned: true },
    create: { userId: user.id, gameId: game.id, owned: true },
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

  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) return { ok: false, error: "missing_game" };

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return { ok: false, error: "not_found" };

  const owns = await prisma.userGame.findUnique({
    where: { userId_gameId: { userId: user.id, gameId } },
  });
  if (!owns) return { ok: false, error: "not_owned" };

  const isCoop = formData.get("isCoop") === "on";
  const minPlayersRaw = formData.get("minPlayers");
  const maxPlayersRaw = formData.get("maxPlayers");
  const minPlayers = minPlayersRaw ? Number(minPlayersRaw) : 2;
  const maxPlayers = maxPlayersRaw ? Number(maxPlayersRaw) : null;

  const invalidMin =
    !Number.isFinite(minPlayers) || minPlayers < 1 || minPlayers > 100;
  const invalidMax =
    maxPlayers !== null &&
    (!Number.isFinite(maxPlayers) || maxPlayers < minPlayers);
  if (invalidMin || invalidMax) {
    return { ok: false, error: "joueurs_invalide" };
  }

  let name = game.name;
  if (game.source === "MANUAL") {
    const nameRaw = String(formData.get("name") ?? "").trim();
    if (!nameRaw) return { ok: false, error: "nom_requis" };
    name = nameRaw;
  }

  await prisma.game.update({
    where: { id: gameId },
    data: { name, isCoop, minPlayers, maxPlayers },
  });

  revalidatePath("/bibliotheque");
  return { ok: true };
}

export async function removeUserGame(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId) return;

  await prisma.userGame.deleteMany({ where: { userId: user.id, gameId } });
  revalidatePath("/bibliotheque");
}

export async function reimportSteamLibrary() {
  const user = await getCurrentUser();
  if (!user?.steamId64) redirect("/profil/parametres");

  const result = await importSteamLibrary(user.id, user.steamId64);
  revalidatePath("/bibliotheque");
  redirect(
    result.status === "imported"
      ? `/profil/parametres?steam=importe&count=${result.count}`
      : "/profil/parametres?steam=prive"
  );
}
