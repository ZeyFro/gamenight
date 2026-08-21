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
  callbacks: {
    async signIn({ user, profile }) {
      if (!profile?.id) return false;

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
  },
});
