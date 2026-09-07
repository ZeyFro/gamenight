import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Réplique exactement le mapping avatar/nom du provider Discord next-auth
 * (`@auth/core/providers/discord.ts`, fonction `profile()`) — utilisé ici
 * pour rafraîchir `discordAvatar`/`discordName` en dehors du flux OAuth
 * initial (callback `signIn`), qui ne se redéclenche pas tant que le JWT
 * de session reste valide (jusqu'à 30 jours par défaut chez Auth.js).
 * Sans ce rafraîchissement périodique, un changement d'avatar/pseudo côté
 * Discord ne serait répercuté qu'à la prochaine reconnexion OAuth
 * complète — potentiellement des semaines plus tard. Toute divergence
 * avec le mapping du provider casserait la cohérence entre l'avatar posé
 * à la connexion et celui posé ici.
 */
function discordAvatarUrl(id: string, avatar: string | null, discriminator: string): string {
  if (avatar === null) {
    const defaultAvatarNumber =
      discriminator === "0" ? Number(BigInt(id) >> BigInt(22)) % 6 : parseInt(discriminator) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`;
  }
  const format = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${format}`;
}

interface DiscordSelfResponse {
  id: string;
  username: string;
  global_name: string | null;
  discriminator: string;
  avatar: string | null;
}

/**
 * Rafraîchit `discordName`/`discordAvatar` en base depuis l'API Discord
 * (`GET /users/@me`, scope `identify` déjà demandé par le provider) —
 * appelé par `auth.ts` (callback `jwt`), throttlé côté appelant.
 * Best-effort : un jeton d'accès expiré (Discord : ~7 jours de durée de
 * vie) ou une erreur réseau ne doit jamais casser la session — on logue
 * et on laisse les données en base telles quelles, elles seront de toute
 * façon rafraîchies à la prochaine vraie reconnexion Discord (callback
 * `signIn`, qui upsert déjà `discordName`/`discordAvatar` à chaque
 * authentification complète).
 */
export async function refreshDiscordProfile(discordId: string, accessToken: string): Promise<void> {
  try {
    const res = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;

    const profile = (await res.json()) as DiscordSelfResponse;
    await prisma.user.update({
      where: { discordId },
      data: {
        discordName: profile.global_name ?? profile.username,
        discordAvatar: discordAvatarUrl(profile.id, profile.avatar, profile.discriminator),
      },
    });
  } catch (error) {
    logger.error("discord-profile", error, { discordId });
  }
}

/**
 * Fix bug remonté : le rafraîchissement ci-dessus dépend du jeton d'accès
 * OAuth d'un user précis, disponible uniquement DANS SA propre session JWT
 * — un jeton Discord expire au bout de ~7 jours, et sans reconnexion
 * complète entre-temps `refreshDiscordProfile` échoue silencieusement en
 * boucle (`res.ok` faux) jusqu'à la prochaine vraie reconnexion. Cette
 * fonction rafraîchit TOUT LE MONDE depuis un cron, sans dépendre d'une
 * session active ni d'un jeton individuel : `GET /users/{id}` avec le
 * jeton du BOT de l'application (Developer Portal → Bot), qui ne périme
 * jamais. Nécessite que le bot soit membre du serveur Discord du groupe.
 * `DISCORD_BOT_TOKEN` optionnelle — même philosophie que
 * `DEEPL_API_KEY`/`BLOB_READ_WRITE_TOKEN` : no-op silencieux (avec un
 * warning loggé une fois par appel) si non configurée, jamais une erreur
 * qui casserait le cron.
 */
export async function refreshAllDiscordProfilesViaBot(): Promise<{
  checked: number;
  updated: number;
}> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    logger.warn(
      "discord-profile",
      "DISCORD_BOT_TOKEN non configurée — rafraîchissement cron ignoré."
    );
    return { checked: 0, updated: 0 };
  }

  const users = await prisma.user.findMany({
    select: { discordId: true, discordName: true, discordAvatar: true },
  });
  logger.info("discord-profile", `Cron bot : ${users.length} utilisateur(s) à vérifier.`);

  let updated = 0;
  for (const user of users) {
    try {
      const res = await fetch(`https://discord.com/api/users/${user.discordId}`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.error(
          "discord-profile",
          `GET /users/${user.discordId} a répondu ${res.status} — profil ignoré.`,
          { discordId: user.discordId, status: res.status, body: body.slice(0, 300) }
        );
        continue;
      }

      const profile = (await res.json()) as DiscordSelfResponse;
      const freshName = profile.global_name ?? profile.username;
      const freshAvatar = discordAvatarUrl(profile.id, profile.avatar, profile.discriminator);
      if (freshName === user.discordName && freshAvatar === user.discordAvatar) continue;

      await prisma.user.update({
        where: { discordId: user.discordId },
        data: { discordName: freshName, discordAvatar: freshAvatar },
      });
      updated += 1;
      logger.info("discord-profile", `Profil mis à jour : ${user.discordId}.`, {
        discordId: user.discordId,
        oldAvatar: user.discordAvatar,
        newAvatar: freshAvatar,
        oldName: user.discordName,
        newName: freshName,
      });
    } catch (error) {
      logger.error("discord-profile", error, { discordId: user.discordId });
    }
  }

  return { checked: users.length, updated };
}
