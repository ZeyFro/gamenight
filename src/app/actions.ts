"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { GameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { importSteamLibrary } from "@/lib/steam";

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

  revalidatePath("/bibliotheque");
  redirect("/bibliotheque");
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
  if (!user?.steamId64) redirect("/profil");

  const result = await importSteamLibrary(user.id, user.steamId64);
  revalidatePath("/bibliotheque");
  redirect(
    result.status === "imported"
      ? `/profil?steam=importe&count=${result.count}`
      : "/profil?steam=prive"
  );
}
