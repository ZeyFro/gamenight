import { profileTagName } from "@/lib/discord-guild-roles";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Synchronisation profil GameNight pour `/role` (v1, sans migration).
 *
 * Le rôle Discord obtenu suit le joueur dans GameNight sous forme de centre
 * d'intérêt (`Tag` + `UserTag`, les deux modèles existants). Aucune table
 * nouvelle : `UserTag` a `@@id([userId, tagId])`, donc l'upsert est
 * naturellement idempotent — rejouer la commande ne crée ni doublon de tag
 * ni doublon d'association.
 *
 * Un compte non relié n'est jamais créé automatiquement : `/role` ne doit pas
 * fabriquer de profil fantôme depuis un simple clic Discord.
 */
export type RoleProfileSync =
  | { status: "synced"; tagName: string }
  | { status: "not_linked" }
  | { status: "failed" };

/**
 * Le joueur ne suit plus ce jeu : on retire l'association `UserTag` (pas le
 * `Tag`, partagé par d'autres joueurs). Aucune autre préférence n'est modifiée.
 */
export async function unsyncGameRoleFromProfile(input: {
  discordId: string;
  gameName: string;
}): Promise<RoleProfileSync> {
  const tagName = profileTagName(input.gameName);
  if (!tagName) return { status: "failed" };
  try {
    const user = await prisma.user.findUnique({
      where: { discordId: input.discordId },
      select: { id: true },
    });
    if (!user) return { status: "not_linked" };
    const tag = await prisma.tag.findUnique({ where: { name: tagName }, select: { id: true } });
    if (!tag) return { status: "synced", tagName };
    await prisma.userTag.deleteMany({ where: { userId: user.id, tagId: tag.id } });
    return { status: "synced", tagName };
  } catch (error) {
    logger.warn("discord-role", "Retrait du centre d’intérêt impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed" };
  }
}

export async function syncGameRoleToProfile(input: {
  discordId: string;
  gameName: string;
}): Promise<RoleProfileSync> {
  const tagName = profileTagName(input.gameName);
  if (!tagName) return { status: "failed" };
  try {
    const user = await prisma.user.findUnique({
      where: { discordId: input.discordId },
      select: { id: true },
    });
    if (!user) return { status: "not_linked" };
    const tag = await prisma.tag.upsert({
      where: { name: tagName },
      update: {},
      create: { name: tagName },
      select: { id: true },
    });
    await prisma.userTag.upsert({
      where: { userId_tagId: { userId: user.id, tagId: tag.id } },
      update: {},
      create: { userId: user.id, tagId: tag.id },
    });
    return { status: "synced", tagName };
  } catch (error) {
    // Jamais bloquant : le rôle Discord est déjà attribué à ce stade.
    logger.warn("discord-role", "Synchronisation du centre d’intérêt impossible.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { status: "failed" };
  }
}
