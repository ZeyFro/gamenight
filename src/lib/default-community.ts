import type { Community } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
 * Aucun Membership n'est créé ici (connexion fermée par défaut, S0) : seule une
 * connexion avec instantané Discord complet (`syncOAuthMemberships`, appelé par
 * `src/auth.ts`) crée une appartenance, dont la communauté par défaut si le
 * serveur du compte correspond. Les comptes historiques sans appartenance
 * reviennent donc par leur prochaine connexion.
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

  // Aucun rattachement automatique : seule une connexion avec instantané
  // Discord complet (`syncOAuthMemberships`, src/auth.ts) crée une appartenance.
  return { communityId, created, membershipsCreated: 0 };
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
