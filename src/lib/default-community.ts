import type { Community, CommunityRole } from "@prisma/client";
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
 * Seuls les utilisateurs sans AUCUN Membership (comptes historiques) sont
 * rattachés à la communauté par défaut.
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

/**
 * Ligne `Community` par défaut seule (sans Memberships) : crée la communauté
 * si elle manque et complète `discordGuildId` depuis `DISCORD_BOT_GUILD_ID`
 * tant qu'il est vide. Ne modifie jamais le statut ni un serveur déjà
 * renseigné. Appelée aussi par la porte de connexion (`src/auth.ts`) : avant
 * le premier passage de `seed-reconcile`, sans elle la communauté par défaut
 * n'aurait pas de serveur et tout nouveau compte serait refusé.
 */
export async function ensureDefaultCommunityRecord(): Promise<Community & { justCreated?: boolean }> {
  const guildId = process.env.DISCORD_BOT_GUILD_ID?.trim() || null;

  const existing = await prisma.community.findUnique({ where: { slug: DEFAULT_COMMUNITY_SLUG } });
  if (existing) {
    if (!existing.discordGuildId && guildId) {
      return prisma.community.update({ where: { id: existing.id }, data: { discordGuildId: guildId } });
    }
    return existing;
  }

  try {
    const community = await prisma.community.create({
      data: {
        slug: DEFAULT_COMMUNITY_SLUG,
        name: DEFAULT_COMMUNITY_NAME,
        status: "ACTIVE",
        activatedAt: new Date(),
        discordGuildId: guildId,
      },
    });
    return Object.assign(community, { justCreated: true });
  } catch (error) {
    // Deux appels simultanés (premières connexions, ou cron) : le slug est
    // unique, le perdant relit la ligne du gagnant.
    if ((error as { code?: string }).code !== "P2002") throw error;
    const winner = await prisma.community.findUnique({ where: { slug: DEFAULT_COMMUNITY_SLUG } });
    if (!winner) throw error;
    return winner;
  }
}

export async function ensureDefaultCommunity(): Promise<EnsureDefaultCommunityResult> {
  const { justCreated, ...community } = await ensureDefaultCommunityRecord();
  const created = justCreated === true;
  const communityId = community.id;

  // Seuls les utilisateurs SANS AUCUN Membership (comptes historiques) sont
  // rattachés à la communauté par défaut : un compte confirmé uniquement sur
  // un autre serveur (porte de connexion multi-serveurs) n'y entre pas.
  const usersWithout = await prisma.user.findMany({
    where: { memberships: { none: {} } },
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

let cachedDefaultCommunityId: string | null = null;

/**
 * Identifiant de la communauté par défaut (créée si elle manque). Mis en cache
 * pour le processus : la ligne n'est jamais supprimée ni renommée (le slug est
 * réservé). Sert aux tables dont `communityId` est obligatoire (PR9) quand
 * l'isolation est éteinte : tout y reste rattaché à la communauté par défaut.
 */
export async function getDefaultCommunityId(): Promise<string> {
  if (cachedDefaultCommunityId) return cachedDefaultCommunityId;
  const community = await ensureDefaultCommunityRecord();
  cachedDefaultCommunityId = community.id;
  return community.id;
}

/** Pour les tests : oublie l'identifiant mis en cache (la base est vidée entre deux tests). */
export function resetDefaultCommunityIdCache(): void {
  cachedDefaultCommunityId = null;
}
