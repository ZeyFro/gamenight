import { prisma } from "@/lib/prisma";
import { postToDiscord, ACCENT_COLOR, type DiscordEmbed, type PostToDiscordResult } from "@/lib/discord";
import { logger } from "@/lib/logger";

export interface ForceReloginResult {
  usersAffected: number;
  discord: PostToDiscordResult;
}

function absoluteAppUrl(): string {
  return (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Déclenche une reconnexion forcée pour TOUT le monde (nécessaire pour que
 * le cron `refresh-discord-profiles` — voir PR 74 — puisse persister le
 * jeton OAuth de chaque user : ce jeton ne se pose qu'à une vraie
 * connexion, jamais pendant la durée de vie d'une session JWT existante,
 * cf. commentaire sur `User.forceReloginAt`).
 *
 * Deux effets, dans cet ordre : 1) poser `forceReloginAt` en base sur tous
 * les users (`getCurrentUser` déconnecte alors toute session dont le token
 * précède ce timestamp, voir ce fichier) ; 2) notifier Discord UNE SEULE
 * FOIS (cet appel unique EST le seul déclenchement — pas de logique de
 * déduplication supplémentaire nécessaire, c'est un bouton admin déclenché
 * manuellement, pas un cron répété).
 *
 * Best-effort côté Discord (même convention que le reste du projet) : un
 * échec d'envoi ne doit jamais annuler la reconnexion forcée elle-même,
 * déjà actée en base à ce stade.
 */
export async function triggerGlobalRelogin(): Promise<ForceReloginResult> {
  const now = new Date();

  const { count } = await prisma.user.updateMany({
    data: { forceReloginAt: now },
  });

  logger.info("force-relogin", `Reconnexion forcée déclenchée — ${count} user(s) affecté(s).`, {
    usersAffected: count,
  });

  const embed: DiscordEmbed = {
    title: "🔄 Mise à jour de l'app",
    description: "Reconnectez-vous pour profiter des dernières features !",
    color: ACCENT_COLOR,
    fields: [{ name: "Lien", value: absoluteAppUrl() }],
  };

  const discord = await postToDiscord(
    embed,
    `🔄 Mise à jour de l'app — reconnectez-vous pour profiter des dernières features ! 👉 ${absoluteAppUrl()}`
  );

  return { usersAffected: count, discord };
}
