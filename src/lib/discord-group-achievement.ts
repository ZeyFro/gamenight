import { prisma } from "@/lib/prisma";
import { postToDiscord, ACCENT_COLOR, type DiscordEmbed, type PostToDiscordResult } from "@/lib/discord";
import { createNotifications } from "@/lib/notifications";
import type { GroupAchievement } from "@prisma/client";

/**
 * Annonce d'un trophée de GROUPE débloqué (Sprint 3 suite) — contrairement
 * à `announceBadgeUnlocked` (une seule personne concernée), tout le monde
 * est notifié ici : `createNotifications` en une seule requête batch pour
 * chaque membre du groupe, même schéma fixe (pas de `MessageTemplate`)
 * que les autres annonces "événement système" du chantier (roulette,
 * annulation…).
 */
export async function announceGroupAchievementUnlocked(
  achievement: Pick<GroupAchievement, "name" | "icon" | "description">
): Promise<PostToDiscordResult> {
  const users = await prisma.user.findMany({ select: { id: true } });

  await createNotifications(
    users.map((u) => ({
      userId: u.id,
      type: "ACHIEVEMENT" as const,
      title: `${achievement.icon} ${achievement.name}`,
      message: achievement.description,
    }))
  );

  const embed: DiscordEmbed = {
    title: `${achievement.icon} Trophée débloqué : ${achievement.name} !`,
    description: achievement.description,
    color: ACCENT_COLOR,
  };

  return postToDiscord(embed);
}
