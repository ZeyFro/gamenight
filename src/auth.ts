import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/prisma";
import { encryptToken, getEncryptionKey } from "@/lib/discord-token-crypto";
import { logger as appLogger } from "@/lib/logger";
import { parseAdminDiscordIds } from "@/lib/admin-rules";
import { isGuildMember } from "@/lib/guild-member";
import { ensureDefaultCommunityRecord } from "@/lib/default-community";
import type { Prisma } from "@prisma/client";

/**
 * Ids des communautés ACTIVE (avec un serveur Discord) dont `discordId` est
 * membre, vérifiées en parallèle. Une vérification indécise (erreur, 5xx,
 * timeout) ne confirme rien : elle n'ouvre ni l'accès ni un Membership, mais
 * ne bloque pas un serveur confirmé par ailleurs. Liste vide = refus.
 */
async function confirmedCommunities(discordId: string): Promise<string[]> {
  // Cas 0 communauté : sans passage préalable de `seed-reconcile`, la
  // communauté par défaut n'existe pas ou n'a pas son serveur.
  await ensureDefaultCommunityRecord();
  const communities = await prisma.community.findMany({
    where: { status: "ACTIVE", discordGuildId: { not: null } },
    select: { id: true, discordGuildId: true },
  });
  const results = await Promise.allSettled(
    communities.map((c) => isGuildMember(discordId, c.discordGuildId as string))
  );
  const confirmed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      if (result.value) confirmed.push(communities[i].id);
    } else {
      appLogger.error("auth", result.reason, { discordId, communityId: communities[i].id });
    }
  });
  return confirmed;
}

/**
 * Membership ACTIVE pour chaque communauté confirmée. `createMany` +
 * `skipDuplicates` ne réécrit jamais un Membership existant (REMOVED reste
 * REMOVED, ACTIVE inchangé) ; seule la réactivation ciblée d'un LEFT passe par
 * `updateMany` filtré sur ce statut.
 */
async function activateMemberships(
  tx: Prisma.TransactionClient,
  userId: string,
  communityIds: string[]
): Promise<void> {
  await tx.membership.createMany({
    data: communityIds.map((communityId) => ({ communityId, userId })),
    skipDuplicates: true,
  });
  await tx.membership.updateMany({
    where: { userId, communityId: { in: communityIds }, status: "LEFT" },
    data: { status: "ACTIVE", leftAt: null },
  });
}

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

      // Porte d'accès (opt-in, `true` exact) : un NOUVEAU compte doit être
      // membre d'au moins un serveur Discord d'une communauté ACTIVE. Comptes
      // existants et admins passent toujours ; aucun serveur confirmé ou
      // toute erreur de vérification refuse (fail-closed).
      let confirmedCommunityIds: string[] = [];
      if (process.env.AUTH_REQUIRE_GUILD_MEMBER === "true") {
        try {
          const discordId = profile.id as string;
          const known =
            parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS).has(discordId) ||
            (await prisma.user.findUnique({ where: { discordId }, select: { id: true } })) !== null;
          if (!known) {
            confirmedCommunityIds = await confirmedCommunities(discordId);
            if (confirmedCommunityIds.length === 0) {
              appLogger.warn("auth", "Connexion refusée : nouveau compte confirmé sur aucun serveur.");
              return false;
            }
          }
        } catch (error) {
          appLogger.error("auth", error, { discordId: profile.id });
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

        if (confirmedCommunityIds.length === 0) {
          await upsertUser(prisma);
        } else {
          // Un seul bloc : un compte créé sans ses Membership deviendrait
          // « existant » et contournerait la porte à la connexion suivante.
          await prisma.$transaction(async (tx) => {
            const { id: userId } = await upsertUser(tx);
            await activateMemberships(tx, userId, confirmedCommunityIds);
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
          } catch (error) {
            appLogger.error("auth", error, { discordId: profile.id });
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
      // error=Configuration masque volontairement la vraie cause à
      // l'utilisateur (CallbackRouteError, InvalidCheck, etc. l'enveloppent).
      // On log ici le type + la stack de l'erreur d'origine (`cause.err`)
      // pour pouvoir la retrouver dans les logs Vercel.
      appLogger.error("auth", error);
      const cause = (error as { cause?: { err?: unknown } }).cause;
      if (cause?.err instanceof Error) {
        appLogger.error("auth:cause", cause.err);
      }
    },
  },
});
