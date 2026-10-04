import type { CommunityRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseAdminDiscordIds } from "@/lib/admin-rules";

/**
 * Multi-communautés, PR A — la communauté historique devient la communauté
 * « par défaut ». Idempotent : appelé à chaque passage de
 * `/api/backfill/seed-reconcile` (12e tâche de `runSeedReconciliation`), il
 * crée ce qui manque et ne modifie JAMAIS l'existant (statut de la
 * communauté, Memberships déjà présents : un LEFT reste LEFT, un rôle changé
 * à la main reste tel quel). Seule exception : `discordGuildId` est complété
 * depuis `DISCORD_BOT_GUILD_ID` tant qu'il est vide (décision : la communauté
 * par défaut garde sa configuration d'environnement au début).
 *
 * Rôles des nouveaux Memberships : le premier `ADMIN_DISCORD_IDS` présent en
 * base devient OWNER s'il n'y a pas déjà un OWNER actif (un seul, garanti
 * ici et non en base) ; les autres admins (variable ou `User.role`) → ADMIN ;
 * le reste → MEMBER.
 */

export const DEFAULT_COMMUNITY_SLUG = "default";
const DEFAULT_COMMUNITY_NAME = "GameNight";

export interface EnsureDefaultCommunityResult {
  communityId: string;
  created: boolean;
  membershipsCreated: number;
}

export async function ensureDefaultCommunity(): Promise<EnsureDefaultCommunityResult> {
  const guildId = process.env.DISCORD_BOT_GUILD_ID?.trim() || null;

  // ponytail: deux passages strictement simultanés peuvent se heurter sur le
  // slug unique ; le second échoue (journalisé par seed-reconcile) et le
  // passage suivant réussit. Cron quotidien : un verrou n'en vaut pas la peine.
  let community = await prisma.community.findUnique({ where: { slug: DEFAULT_COMMUNITY_SLUG } });
  let created = false;
  if (!community) {
    community = await prisma.community.create({
      data: {
        slug: DEFAULT_COMMUNITY_SLUG,
        name: DEFAULT_COMMUNITY_NAME,
        status: "ACTIVE",
        activatedAt: new Date(),
        discordGuildId: guildId,
      },
    });
    created = true;
  } else if (!community.discordGuildId && guildId) {
    community = await prisma.community.update({
      where: { id: community.id },
      data: { discordGuildId: guildId },
    });
  }
  const communityId = community.id;

  const usersWithout = await prisma.user.findMany({
    where: { memberships: { none: { communityId } } },
    select: { id: true, discordId: true, role: true },
  });
  if (usersWithout.length === 0) return { communityId, created, membershipsCreated: 0 };

  const adminIds = parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS);
  const hasActiveOwner =
    (await prisma.membership.count({ where: { communityId, role: "OWNER", status: "ACTIVE" } })) > 0;
  const ownerDiscordId = hasActiveOwner
    ? null
    : ([...adminIds].find((id) => usersWithout.some((u) => u.discordId === id)) ?? null);

  const roleOf = (u: (typeof usersWithout)[number]): CommunityRole => {
    if (u.discordId === ownerDiscordId) return "OWNER";
    if (adminIds.has(u.discordId) || u.role === "ADMIN") return "ADMIN";
    return "MEMBER";
  };

  const { count } = await prisma.membership.createMany({
    data: usersWithout.map((u) => ({ communityId, userId: u.id, role: roleOf(u) })),
    skipDuplicates: true,
  });
  return { communityId, created, membershipsCreated: count };
}
