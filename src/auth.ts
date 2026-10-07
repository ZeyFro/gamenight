import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/prisma";
import { encryptToken, getEncryptionKey } from "@/lib/discord-token-crypto";
import { logger as appLogger } from "@/lib/logger";
import { parseAdminDiscordIds } from "@/lib/admin-rules";
import { listOAuthUserGuildIds } from "@/lib/discord-user-guilds";
import { shouldSyncOAuthMemberships, syncOAuthMemberships } from "@/lib/community-oauth";
import { ensureDefaultCommunityRecord } from "@/lib/default-community";
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Discord({
      issuer: "https://discord.com",
      authorization: { params: { scope: "identify email guilds" } },
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  // Vercel sert l'app derrière un proxy (x-forwarded-host) : sans ça, Auth.js
  // peut rejeter certaines requêtes selon comment l'hôte est détecté.
  trustHost: true,
  callbacks: {
    async signIn({ user, profile, account }) {
      if (!profile?.id) return false;

      const verifiedAt = new Date();
      const sync = shouldSyncOAuthMemberships();
      let guildIds: string[] = [];
      let known = false;
      if (sync) {
        try {
          if (!account?.access_token || !account.scope?.split(/\s+/).includes("guilds")) {
            throw new Error("OAuth guilds scope missing");
          }
          guildIds = await listOAuthUserGuildIds(account.access_token);
          await ensureDefaultCommunityRecord();
          known = parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS).has(profile.id as string) ||
            (await prisma.user.findUnique({ where: { discordId: profile.id as string }, select: { id: true } })) !== null;
        } catch {
          // Never log API bodies, OAuth tokens or network error messages.
          appLogger.warn("auth", "OAuth guild snapshot unavailable; login denied, memberships unchanged.");
          return false;
        }
      }

      try {
        const profileData = {
          discordName: user.name ?? (profile.username as string),
          discordAvatar: user.image ?? null,
        };
        const upsertUser = (db: Pick<typeof prisma, "user">) =>
          db.user.upsert({
            where: { discordId: profile.id as string },
            update: profileData,
            create: { discordId: profile.id as string, ...profileData },
            select: { id: true },
          });

        if (!sync) {
          await upsertUser(prisma);
        } else {
          await prisma.$transaction(async (tx) => {
            const { id: userId } = await upsertUser(tx);
            const activeIds = await syncOAuthMemberships(tx, userId, guildIds, verifiedAt);
            if (process.env.AUTH_REQUIRE_GUILD_MEMBER === "true" && !known && activeIds.length === 0) {
              throw new Error("No authorized community");
            }
          });
        }
      } catch (error) {
        // Sans ce catch, une erreur Prisma ici remonte comme une
        // `CallbackRouteError` non "client-safe" pour Auth.js, qui
        // l'affiche comme une page générique "Server error / problem with
        // the server configuration" sans donner d'indice à l'utilisateur.
        // On logue l'erreur réelle (visible dans les logs Vercel) et on
        // renvoie `false` pour obtenir un message "AccessDenied" clair.
        appLogger.error("auth", error, { discordId: profile.id });
        return false;
      }

      return true;
    },
    async jwt({ token, profile, account }) {
      if (profile?.id) {
        token.discordId = profile.id as string;
      }

      // Connexion OAuth fraîche : `signIn` vient d'upserter des données à
      // jour, on peut repousser le prochain rafraîchissement. Le jeton
      // d'accès n'est volontairement PAS copié dans le JWT (cookie) : aucun
      // lecteur, et un secret de moins dans le cookie. Seule sa copie
      // chiffrée en base (ci-dessous) est utilisée, par le cron.
      if (account?.access_token) {
        token.discordSyncedAt = Date.now();

        // Feature "forcer la reconnexion globale" — posé une seule fois,
        // à cette connexion OAuth fraîche (jamais réécrit tant que la
        // session JWT vit, jusqu'à 30 jours). `getCurrentUser` compare
        // cette valeur à `User.forceReloginAt` pour décider si CE token
        // précède un déclenchement de reconnexion forcée.
        token.sessionCreatedAt = Date.now();

        // Fix bug remonté (cron avatars Discord silencieux) — persiste
        // aussi `refresh_token`/`expires_at` EN BASE (pas seulement dans
        // ce JWT) : c'est la seule façon pour le cron
        // `refresh-discord-profiles` (hors de toute session) de rappeler
        // l'API Discord au nom de cet utilisateur plus tard, y compris
        // après expiration de son jeton d'accès (~1h côté Discord — le
        // rafraîchir via `refresh_token` est le seul moyen d'y arriver
        // sans repasser par tout le flux OAuth). Best-effort : ne doit
        // jamais faire échouer la connexion.
        //
        // Chiffrement (PR "Chiffrement des jetons OAuth Discord") — les
        // deux valeurs sont chiffrées AVANT l'écriture, dans la même
        // transaction implicite qu'un seul `update` : soit les deux sont
        // persistées chiffrées, soit rien n'est écrit (`getEncryptionKey`
        // lève si la clé est absente/invalide — capturé par le catch
        // ci-dessous comme n'importe quelle autre erreur best-effort).
        if (profile?.id && account.refresh_token) {
          try {
            const key = getEncryptionKey();
            await prisma.user.update({
              where: { discordId: profile.id as string },
              data: {
                discordAccessToken: encryptToken(account.access_token, key),
                discordRefreshToken: encryptToken(account.refresh_token, key),
                discordTokenExpiresAt: account.expires_at
                  ? new Date(account.expires_at * 1000)
                  : null,
              },
            });
          } catch {
            appLogger.warn("auth", "Discord token persistence failed.");
          }
        }
      }

      // PAS de rafraîchissement périodique du profil ici : `auth()` appelé
      // depuis un composant serveur / une server action n'écrit pas le
      // cookie de session (Auth.js jette les `Set-Cookie`), donc un
      // `discordSyncedAt` posé dans ce callback ne serait jamais persisté
      // et le JWT resterait « périmé » : l'API Discord serait appelée à
      // CHAQUE requête authentifiée (voir `auth.jwt.test.ts`). Avatar et
      // pseudo sont rafraîchis (1) à la connexion (`signIn` ci-dessus) et
      // (2) toutes les heures pour tout le monde par le cron
      // `/api/cron/refresh-discord-profiles`.
      return token;
    },
    async session({ session, token }) {
      if (token.discordId) {
        session.user.discordId = token.discordId as string;
      }
      if (token.sessionCreatedAt) {
        session.user.sessionCreatedAt = token.sessionCreatedAt as number;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
    error: "/",
  },
  logger: {
    error(error) {
      // Auth.js causes can contain callback parameters: no code/token/body.
      appLogger.warn("auth", "Auth.js authentication failed.", { type: error.name });
    },
  },
});
