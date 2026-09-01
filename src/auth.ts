import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/prisma";
import { refreshDiscordProfile } from "@/lib/discord-profile";

/**
 * Fenêtre de rafraîchissement avatar/pseudo depuis l'API Discord (bug
 * remonté : l'ancien avatar restait affiché indéfiniment tant que le JWT
 * de session restait valide, le callback `signIn` ci-dessous ne
 * s'exécutant qu'à une VRAIE reconnexion OAuth). Même ordre de grandeur
 * que le throttle de `touchStreak` (12h) — assez fréquent pour que le
 * changement d'avatar/pseudo Discord se propage vite, assez rare pour ne
 * jamais peser sur la latence des pages protégées.
 */
const DISCORD_PROFILE_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  // Vercel sert l'app derrière un proxy (x-forwarded-host) : sans ça, Auth.js
  // peut rejeter certaines requêtes selon comment l'hôte est détecté.
  trustHost: true,
  callbacks: {
    async signIn({ user, profile }) {
      if (!profile?.id) return false;

      try {
        await prisma.user.upsert({
          where: { discordId: profile.id as string },
          update: {
            discordName: user.name ?? (profile.username as string),
            discordAvatar: user.image ?? null,
          },
          create: {
            discordId: profile.id as string,
            discordName: user.name ?? (profile.username as string),
            discordAvatar: user.image ?? null,
          },
        });
      } catch (error) {
        // Sans ce catch, une erreur Prisma ici remonte comme une
        // `CallbackRouteError` non "client-safe" pour Auth.js, qui
        // l'affiche comme une page générique "Server error / problem with
        // the server configuration" sans donner d'indice à l'utilisateur.
        // On logue l'erreur réelle (visible dans les logs Vercel) et on
        // renvoie `false` pour obtenir un message "AccessDenied" clair.
        console.error("[auth] Échec de l'upsert User au login Discord", error);
        return false;
      }

      return true;
    },
    async jwt({ token, profile, account }) {
      if (profile?.id) {
        token.discordId = profile.id as string;
      }

      // Connexion OAuth fraîche : `signIn` vient d'upserter des données à
      // jour, on peut repousser le prochain rafraîchissement. On garde le
      // jeton d'accès (scope `identify` déjà demandé par le provider) pour
      // pouvoir rappeler `/users/@me` plus tard sans repasser par tout le
      // flux OAuth.
      if (account?.access_token) {
        token.discordAccessToken = account.access_token;
        token.discordSyncedAt = Date.now();
      }

      // Sessions JWT persistantes (jusqu'à 30 jours par défaut) : sans ce
      // rafraîchissement périodique, un avatar/pseudo changé côté Discord
      // ne serait répercuté qu'à la prochaine reconnexion OAuth complète.
      // Best-effort et silencieux (voir `refreshDiscordProfile`) : un
      // jeton expiré (Discord : ~7 jours) ne casse jamais la session, le
      // rafraîchissement reprendra à la prochaine vraie reconnexion.
      const discordId = token.discordId as string | undefined;
      const discordAccessToken = token.discordAccessToken as string | undefined;
      const discordSyncedAt = token.discordSyncedAt as number | undefined;
      const isStale = !discordSyncedAt || Date.now() - discordSyncedAt > DISCORD_PROFILE_SYNC_INTERVAL_MS;
      if (isStale && discordId && discordAccessToken) {
        await refreshDiscordProfile(discordId, discordAccessToken);
        token.discordSyncedAt = Date.now();
      }

      return token;
    },
    async session({ session, token }) {
      if (token.discordId) {
        session.user.discordId = token.discordId as string;
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
      // error=Configuration masque volontairement la vraie cause à
      // l'utilisateur (CallbackRouteError, InvalidCheck, etc. l'enveloppent).
      // On log ici le type + la stack de l'erreur d'origine (`cause.err`)
      // pour pouvoir la retrouver dans les logs Vercel.
      console.error(`[auth][error] ${error.name}: ${error.message}`);
      const cause = (error as { cause?: { err?: unknown } }).cause;
      if (cause?.err instanceof Error) {
        console.error("[auth][cause]", cause.err.stack ?? cause.err.message);
      } else if (error.stack) {
        console.error("[auth][stack]", error.stack);
      }
    },
  },
});
