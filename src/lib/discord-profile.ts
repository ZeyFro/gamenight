import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  DiscordTokenEncryptionKeyError,
  encryptToken,
  getEncryptionKey,
  resolveStoredToken,
} from "@/lib/discord-token-crypto";

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

interface DiscordTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Rafraîchit un jeton d'accès Discord expiré (~1h de durée de vie côté
 * Discord) via son `refresh_token` — `POST /oauth2/token`,
 * `grant_type=refresh_token`, authentifié avec les identifiants de
 * l'appli (`DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`, déjà utilisés par
 * le provider next-auth). Discord fait tourner le `refresh_token` à
 * chaque utilisation (l'ancien devient invalide) — l'appelant DOIT
 * toujours persister la nouvelle paire retournée, jamais réutiliser
 * l'ancienne. `null` en cas d'échec (refresh_token révoqué/expiré côté
 * Discord — l'utilisateur devra se reconnecter normalement pour en
 * obtenir un nouveau, ce cron ne peut rien faire de plus pour lui).
 */
async function refreshDiscordAccessToken(
  refreshToken: string
): Promise<DiscordTokenResponse | null> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) return null;

  return (await res.json()) as DiscordTokenResponse;
}

// Marge de sécurité avant `discordTokenExpiresAt` : rafraîchit un peu en
// avance plutôt que d'attendre l'expiration exacte, pour ne jamais tenter
// `/users/@me` avec un jeton qui vient tout juste d'expirer entre la
// lecture en base et l'appel réseau.
const TOKEN_REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

interface OAuthProfileUser {
  discordId: string;
  discordName: string;
  discordAvatar: string | null;
}

/**
 * Fix bug remonté (cron avatars Discord silencieux) — approche
 * privilégiée : réutilise le VRAI jeton OAuth de chaque utilisateur
 * (`User.discordAccessToken`/`discordRefreshToken`, persistés par
 * `auth.ts` à chaque vraie reconnexion, cf. schema.prisma) au lieu du
 * jeton du bot de l'appli (`refreshAllDiscordProfilesViaBotFor` plus bas,
 * gardée en repli ciblé — voir `refreshAllDiscordProfiles`). Rafraîchit le
 * jeton d'accès si besoin (`refreshDiscordAccessToken`) avant d'appeler
 * `/users/@me`, et persiste la nouvelle paire de jetons à chaque
 * rotation (Discord invalide l'ancien `refresh_token` à chaque usage).
 * Ignore silencieusement les users sans `discordRefreshToken` en base
 * (pas encore reconnectés depuis ce déploiement) — comptés à part
 * (`skipped`) plutôt que mélangés aux échecs réels.
 *
 * Chiffrement (PR "Chiffrement des jetons OAuth Discord") :
 * - La clé (`getEncryptionKey`) est validée UNE SEULE FOIS avant la boucle
 *   — jamais par utilisateur — et TOUJOURS avant le premier appel réseau
 *   vers Discord. Si elle est absente/invalide, aucun appel `/users/@me`
 *   ni `/oauth2/token` n'est tenté : tous les jetons stockés sont traités
 *   comme illisibles cette exécution (voir `unreadableUsers` ci-dessous),
 *   un seul log clair au lieu d'un par utilisateur.
 * - Un jeton stocké illisible (enveloppe invalide, mauvaise clé) pour UN
 *   utilisateur ne bloque jamais le traitement des autres — même
 *   `try/catch` par utilisateur qu'avant, `resolveStoredToken` ne lève de
 *   toute façon jamais d'exception pour un problème de donnée.
 * - Lors d'une rotation, Discord répond avec la nouvelle paire complète :
 *   les DEUX valeurs sont chiffrées, puis persistées en un seul `update`
 *   Prisma — jamais l'une sans l'autre.
 * - `unreadableUsers` (jeton présent en base mais illisible cette
 *   exécution, quelle qu'en soit la cause) est distinct de `skipped`
 *   (jeton absent) : `refreshAllDiscordProfiles` bascule CES deux
 *   catégories vers le repli bot, pas seulement la seconde — une colonne
 *   non nulle mais illisible ne doit jamais empêcher le repli.
 */
export async function refreshAllDiscordProfilesViaOAuth(): Promise<{
  checked: number;
  updated: number;
  failed: number;
  skipped: number;
  unreadable: number;
  unreadableUsers: OAuthProfileUser[];
}> {
  const users = await prisma.user.findMany({
    where: { discordRefreshToken: { not: null } },
    select: {
      discordId: true,
      discordName: true,
      discordAvatar: true,
      discordAccessToken: true,
      discordRefreshToken: true,
      discordTokenExpiresAt: true,
    },
  });
  logger.info("discord-profile", `Cron OAuth : ${users.length} utilisateur(s) avec jeton stocké.`);

  let encryptionKey;
  try {
    encryptionKey = getEncryptionKey();
  } catch (error) {
    // Erreur de configuration globale (pas par ligne) — un seul log,
    // aucun appel Discord tenté, tout le monde bascule vers le repli bot
    // (voir `refreshAllDiscordProfiles`) plutôt que de tenter puis
    // échouer N fois de suite pour la même raison.
    const reason = error instanceof DiscordTokenEncryptionKeyError ? "configuration absente/invalide" : "inconnue";
    logger.error(
      "discord-profile",
      `Clé de chiffrement des jetons Discord indisponible (${reason}) — bascule repli bot pour tous les jetons stockés.`
    );
    return {
      checked: users.length,
      updated: 0,
      failed: 0,
      skipped: 0,
      unreadable: users.length,
      unreadableUsers: users.map((u) => ({
        discordId: u.discordId,
        discordName: u.discordName,
        discordAvatar: u.discordAvatar,
      })),
    };
  }

  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let unreadable = 0;
  const unreadableUsers: OAuthProfileUser[] = [];

  for (const user of users) {
    try {
      const storedRefresh = resolveStoredToken(user.discordRefreshToken, encryptionKey);
      if (!storedRefresh.ok) {
        // Enveloppe invalide ou mauvaise clé pour CE jeton précis (pas un
        // problème de configuration globale, déjà écarté ci-dessus) —
        // candidat au repli bot, jamais compté "skipped" (réservé à
        // l'absence pure et simple de jeton en base).
        unreadable += 1;
        unreadableUsers.push({
          discordId: user.discordId,
          discordName: user.discordName,
          discordAvatar: user.discordAvatar,
        });
        logger.warn(
          "discord-profile",
          `Jeton de renouvellement illisible pour ${user.discordId} (enveloppe invalide ou déchiffrement impossible) — repli bot si disponible.`,
          { discordId: user.discordId }
        );
        continue;
      }

      const storedAccess = user.discordAccessToken
        ? resolveStoredToken(user.discordAccessToken, encryptionKey)
        : { ok: false as const };
      let accessToken = storedAccess.ok ? storedAccess.value : null;

      const isExpiredOrSoon =
        !accessToken ||
        !user.discordTokenExpiresAt ||
        user.discordTokenExpiresAt.getTime() - Date.now() < TOKEN_REFRESH_SAFETY_MARGIN_MS;

      if (isExpiredOrSoon) {
        const refreshed = await refreshDiscordAccessToken(storedRefresh.value);
        if (!refreshed) {
          // `refresh_token` révoqué/expiré côté Discord — rien à faire
          // ici, l'utilisateur redonnera un jeton valide à sa prochaine
          // vraie reconnexion (callback `jwt` dans auth.ts).
          failed += 1;
          logger.error(
            "discord-profile",
            `Rafraîchissement du jeton OAuth échoué pour ${user.discordId} — profil ignoré.`,
            { discordId: user.discordId }
          );
          continue;
        }
        accessToken = refreshed.access_token;
        // Chiffre les DEUX valeurs avant d'écrire — un seul `update`
        // Prisma pour la paire complète, jamais l'une sans l'autre.
        await prisma.user.update({
          where: { discordId: user.discordId },
          data: {
            discordAccessToken: encryptToken(refreshed.access_token, encryptionKey),
            discordRefreshToken: encryptToken(refreshed.refresh_token, encryptionKey),
            discordTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
          },
        });
      }

      if (!accessToken) {
        skipped += 1;
        continue;
      }

      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        failed += 1;
        const body = await res.text().catch(() => "");
        logger.error(
          "discord-profile",
          `GET /users/@me a répondu ${res.status} pour ${user.discordId} — profil ignoré.`,
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
      logger.info("discord-profile", `Profil mis à jour (OAuth) : ${user.discordId}.`, {
        discordId: user.discordId,
        oldAvatar: user.discordAvatar,
        newAvatar: freshAvatar,
        oldName: user.discordName,
        newName: freshName,
      });
    } catch (error) {
      failed += 1;
      logger.error("discord-profile", error, { discordId: user.discordId });
    }
  }

  logger.info(
    "discord-profile",
    `Cron OAuth terminé : ${updated} mis à jour, ${failed} échec(s), ${skipped} ignoré(s), ${unreadable} illisible(s) sur ${users.length}.`
  );

  return { checked: users.length, updated, failed, skipped, unreadable, unreadableUsers };
}

/**
 * Point d'entrée unique du cron `refresh-discord-profiles` — combine les
 * deux approches sans faire deux fois le travail sur un même user :
 * OAuth (ci-dessus) pour tout user ayant déjà un `discordRefreshToken` en
 * base (le cas normal une fois le rollout de ce fix propagé — se peuple
 * à chaque vraie reconnexion), et le jeton du bot en repli pour les users
 * qui n'en ont pas encore (comptes pas reconnectés depuis ce déploiement)
 * — couverture progressive sans rien casser pour ceux déjà couverts par
 * l'approche OAuth.
 *
 * Chiffrement (PR "Chiffrement des jetons OAuth Discord") — le repli bot
 * couvre maintenant DEUX catégories, pas une seule : les users sans
 * `discordRefreshToken` en base (comme avant) ET ceux dont la colonne
 * n'est PAS nulle mais dont le jeton s'est révélé illisible cette
 * exécution (`oauth.unreadableUsers` — clé de chiffrement absente/
 * invalide, ou enveloppe corrompue). Un jeton présent mais illisible ne
 * doit jamais être traité comme "couvert par l'OAuth" au seul motif que
 * la colonne n'est pas nulle.
 */
export async function refreshAllDiscordProfiles(): Promise<{
  oauth: {
    checked: number;
    updated: number;
    failed: number;
    skipped: number;
    unreadable: number;
    unreadableUsers: OAuthProfileUser[];
  };
  bot: {
    checked: number;
    updated: number;
    failed: number;
    botTokenConfigured: boolean;
    error?: string;
  };
}> {
  const oauth = await refreshAllDiscordProfilesViaOAuth();

  const usersWithoutTokenInDb = await prisma.user.findMany({
    where: { discordRefreshToken: null },
    select: { discordId: true, discordName: true, discordAvatar: true },
  });

  // Dédoublonne par discordId — un user ne peut apparaître dans les deux
  // listes (`unreadableUsers` exige un `discordRefreshToken` non nul par
  // construction de la requête dans `refreshAllDiscordProfilesViaOAuth`),
  // mais on fusionne proprement plutôt que de supposer l'exclusivité.
  const botCandidates = new Map<string, OAuthProfileUser>();
  for (const user of usersWithoutTokenInDb) botCandidates.set(user.discordId, user);
  for (const user of oauth.unreadableUsers) botCandidates.set(user.discordId, user);
  const usersToCheckViaBot = [...botCandidates.values()];

  if (usersToCheckViaBot.length === 0) {
    logger.info(
      "discord-profile",
      "Tous les users ont un jeton OAuth stocké et lisible — bot Discord non nécessaire cette fois."
    );
    return {
      oauth,
      bot: { checked: 0, updated: 0, failed: 0, botTokenConfigured: true },
    };
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return {
      oauth,
      bot: {
        checked: 0,
        updated: 0,
        failed: 0,
        botTokenConfigured: false,
        error: `DISCORD_BOT_TOKEN non configurée — ${usersToCheckViaBot.length} user(s) sans jeton OAuth stocké/lisible resteront non rafraîchis jusqu'à leur prochaine vraie reconnexion.`,
      },
    };
  }

  const bot = await refreshAllDiscordProfilesViaBotFor(usersToCheckViaBot, botToken);
  return { oauth, bot };
}

/**
 * Rafraîchit `discordName`/`discordAvatar` d'une liste de users donnée
 * via le jeton du BOT de l'application (Developer Portal → Bot, ne périme
 * jamais) — `GET /users/{id}`, endpoint public de l'API Discord qui ne
 * nécessite PAS que le bot partage un serveur avec l'utilisateur
 * (contrairement à un endpoint membre de guilde). Repli ciblé pour
 * `refreshAllDiscordProfiles`, uniquement sur les users sans jeton OAuth
 * stocké (pas encore reconnectés depuis le fix ci-dessus) — jamais tous
 * les users d'un coup, l'approche OAuth prime dès qu'un jeton est
 * disponible.
 */
async function refreshAllDiscordProfilesViaBotFor(
  users: { discordId: string; discordName: string; discordAvatar: string | null }[],
  botToken: string
): Promise<{ checked: number; updated: number; failed: number; botTokenConfigured: boolean }> {
  let updated = 0;
  let failed = 0;
  for (const user of users) {
    try {
      const res = await fetch(`https://discord.com/api/users/${user.discordId}`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (!res.ok) {
        failed += 1;
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
      logger.info("discord-profile", `Profil mis à jour (bot, repli) : ${user.discordId}.`, {
        discordId: user.discordId,
        oldAvatar: user.discordAvatar,
        newAvatar: freshAvatar,
        oldName: user.discordName,
        newName: freshName,
      });
    } catch (error) {
      failed += 1;
      logger.error("discord-profile", error, { discordId: user.discordId });
    }
  }

  return { checked: users.length, updated, failed, botTokenConfigured: true };
}
