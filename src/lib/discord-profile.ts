import { prisma } from "@/lib/prisma";

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
    console.error("[auth] Échec du rafraîchissement du profil Discord", error);
  }
}
