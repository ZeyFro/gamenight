import { prisma } from "@/lib/prisma";
import { ACCENT_COLOR, type DiscordEmbed, type PostToDiscordResult } from "@/lib/discord";
import { postToCommunity } from "@/lib/community-announce";
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
  achievement: Pick<GroupAchievement, "name" | "icon" | "description">,
  communityId: string,
): Promise<PostToDiscordResult> {
  const users = await prisma.user.findMany({
    where: { memberships: { some: { communityId, status: "ACTIVE", community: { status: "ACTIVE" } } } },
    select: { id: true },
  });

  await createNotifications(
    users.map((u) => ({
      userId: u.id,
      communityId,
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

  return postToCommunity(communityId, embed);
}
