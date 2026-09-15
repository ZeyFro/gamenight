import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importSteamLibrary } from "@/lib/steam";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * Fix bug remonté : quand un pote achète un nouveau jeu Steam, rien ne le
 * détectait — `importSteamLibrary` traite pourtant déjà TOUS les jeux
 * renvoyés par Steam à chaque appel (upsert, jamais un simple ajout des
 * seuls jeux manquants), un nouvel achat aurait donc été importé
 * correctement... si quelque chose appelait cette fonction sans action
 * explicite de l'utilisateur. Ce n'était le cas qu'au lien initial du
 * compte et via le bouton "Réimporter" — cette route comble ce trou,
 * appelée par un cron externe toutes les 1h, même mécanisme de
 * protection (`CRON_SECRET`) que les autres crons du projet.
 *
 * Boucle "best-effort par user" (une panne Steam sur un compte ne doit
 * jamais empêcher de traiter les autres) — même philosophie que
 * `processOpenRoulettes`/`closeOverdueScheduledSessions`.
 *
 * Fix (repli `GetRecentlyPlayedGames`) — cette route pouvait déjà dépasser
 * 30s pour plusieurs users AVANT le repli (un appel Steam par user). Le
 * repli ajoute au pire UN second appel par user, jamais systématique (voir
 * `importSteamLibrary`) — `maxDuration` n'était pourtant pas déclaré ici
 * (contrairement à `reminders`/`igdb-coop`/`steam-store`/`game-news`, qui
 * l'exposent déjà toutes explicitement à 60s, la limite dure du plan
 * Vercel Hobby) : sans elle, la route tournait sous la limite par défaut,
 * plus courte. L'ajouter ici suit la même convention déjà en place
 * ailleurs, pas un mécanisme nouveau.
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

  const users = await prisma.user.findMany({
    where: { steamId64: { not: null } },
    select: { id: true, steamId64: true },
  });

  const results: { userId: string; newGames: number }[] = [];

  for (const user of users) {
    try {
      const result = await importSteamLibrary(user.id, user.steamId64!);
      if (result.status !== "imported") continue;

      if (result.newCount > 0) {
        logger.info(
          "cron:steam-library-sync",
          `${result.newCount} nouveau(x) jeu(x) Steam pour ${user.id}.`
        );
      }
      results.push({ userId: user.id, newGames: result.newCount });
    } catch (error) {
      logger.error("cron:steam-library-sync", error, { userId: user.id });
    }
  }

  return NextResponse.json({ checked: users.length, results });
}
