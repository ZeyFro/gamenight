import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/prisma";

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
    async jwt({ token, profile }) {
      if (profile?.id) {
        token.discordId = profile.id as string;
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
