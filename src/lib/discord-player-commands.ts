import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { editSetupResponse } from "@/lib/discord-rest";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { wallClockNow } from "@/lib/wallclock";
import {
  getPlayerClassifiedCommunityId,
  listPlayerClassifieds,
  playerClassifiedExpiresAt,
  playerClassifiedSchema,
} from "@/lib/player-classifieds";
import { resolveGameId } from "@/lib/discord-team-commands";
import type { InteractionOutput } from "@/lib/discord-interactions";

/**
 * `/joueurs` — recherche de partenaires.
 *
 * **Même modèle** que la page `/joueurs` : `PlayerClassified`. Aucune table, aucun
 * stockage parallèle. Lecture et écriture passent par les règles partagées
 * (`playerClassifiedSchema`, `playerClassifiedExpiresAt`, 24 h) et par la même
 * porte communautaire (`getPlayerClassifiedCommunityId`, qui vérifie
 * `playerClassifiedsEnabled`).
 *
 * Limite connue et assumée : le modèle ne porte que `gameId` + `message` (240
 * caractères). Plateforme, nombre de joueurs, niveau et disponibilités n'ont pas
 * de colonne → ils ne sont pas inventés ici (une migration demanderait un accord
 * explicite). `publier` accepte donc le jeu et un message qui peut contenir ces
 * précisions.
 *
 * Les fichiers `src/lib/player-classifieds*.ts` et `src/app/joueurs/**` sont
 * réservés par #408 : ce module les *importe* sans les modifier. Quand #408
 * exposera des services d'écriture partagés, `publier`/`retirer` devront les
 * appeler (une seule copie de la règle).
 */
const EPHEMERAL = 64;
const REPLY_BUDGET_MS = 10_000;
const MAX_CONTENT = 1_900;
const MAX_LISTED = 12;
const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const SUBCOMMANDS = ["chercher", "annonces", "mes-annonces", "publier", "retirer"] as const;
const WRITE_SUBCOMMANDS = new Set<string>(["publier", "retirer"]);

const inputSchema = z.object({
  type: z.literal(2),
  id: snowflake,
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake.optional(),
  member: z.object({ user: z.object({ id: snowflake }).optional() }).optional(),
  user: z.object({ id: snowflake }).optional(),
  data: z.object({
    name: z.literal("joueurs"),
    options: z
      .array(
        z.object({
          name: z.enum(SUBCOMMANDS),
          options: z
            .array(
              z.object({
                name: z.string().min(1).max(40),
                value: z.union([z.string().max(1_000), z.number(), z.boolean()]).optional(),
              })
            )
            .max(4)
            .optional(),
        })
      )
      .max(1)
      .optional(),
  }),
});

const quiet = (content: string): InteractionOutput => ({
  status: 200,
  body: { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } },
});

export function playersCommandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_PLAYER_COMMAND_ENABLED === "true";
}

export function playersWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_PLAYER_WRITE_ENABLED === "true";
}

export type PlayerContext =
  | { status: "OK"; userId: string; communityId: string; communityName: string }
  | { status: "NOT_MEMBER" }
  | { status: "DISABLED" };

export async function resolvePlayerContext(input: {
  guildId: string;
  discordId: string;
}): Promise<PlayerContext> {
  const parsed = z.object({ guildId: snowflake, discordId: snowflake }).safeParse(input);
  if (!parsed.success) return { status: "NOT_MEMBER" };
  const community = await prisma.community.findFirst({
    where: { discordGuildId: parsed.data.guildId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!community) return { status: "NOT_MEMBER" };
  const user = await prisma.user.findUnique({ where: { discordId: parsed.data.discordId }, select: { id: true } });
  if (!user) return { status: "NOT_MEMBER" };
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId || communityId !== community.id) return { status: "DISABLED" };
  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId: community.id, userId: user.id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE") return { status: "NOT_MEMBER" };
  return { status: "OK", userId: user.id, communityId: community.id, communityName: community.name };
}

export interface PlayerListingView {
  id: string;
  game: string;
  message: string;
  authorName: string;
  authorId: string;
  expiresAt: Date;
}

export async function loadPlayerListings(input: {
  userId: string;
  communityId: string;
  onlyMine: boolean;
  gameQuery?: string;
}): Promise<PlayerListingView[]> {
  const rows = await listPlayerClassifieds(input.userId, input.communityId, wallClockNow());
  const normalize = (value: string) =>
    value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
  const needle = normalize(input.gameQuery ?? "");
  return rows
    .filter((row) => (input.onlyMine ? row.createdBy.id === input.userId : true))
    .filter((row) => (needle ? normalize(`${row.game.name} ${row.message}`).includes(needle) : true))
    .slice(0, MAX_LISTED)
    .map((row) => ({
      id: row.id,
      game: row.game.name,
      message: row.message,
      authorName: row.createdBy.discordName,
      authorId: row.createdBy.id,
      expiresAt: row.expiresAt,
    }));
}

export function renderListings(listings: PlayerListingView[], communityName: string, onlyMine: boolean): string {
  if (listings.length === 0) {
    return onlyMine
      ? "Tu n’as aucune annonce active. `/joueurs publier` en crée une pour 24 h."
      : `Aucune annonce active sur **${communityName}**. Sois le premier : \`/joueurs publier\`.`;
  }
  return [
    onlyMine ? "🔎 **Tes annonces**" : `🔎 **Joueurs recherchés — ${communityName}**`,
    ...listings.map(
      (listing) =>
        `• **${listing.game}** — ${listing.message.slice(0, 140)} · ${listing.authorName} · expire le ${listing.expiresAt.toLocaleDateString("fr-FR")} · \`${listing.id}\``
    ),
    "Toutes ces annonces sont aussi visibles sur GameNight, `/joueurs`.",
  ].join("\n").slice(0, MAX_CONTENT);
}

export type PublishResult =
  | { status: "PUBLISHED" }
  | { status: "INVALID" }
  | { status: "GAME_NOT_FOUND" }
  | { status: "GAME_AMBIGUOUS"; names: string[] }
  | { status: "RATE_LIMITED" }
  | { status: "UNAVAILABLE" };

/** Même règle que la page : schéma partagé, expiration 24 h, une annonce par appel. */
export async function publishListing(input: {
  userId: string;
  communityId: string;
  gameId: string;
  message: string;
  now?: Date;
}): Promise<PublishResult> {
  const parsed = playerClassifiedSchema.safeParse({ gameId: input.gameId, message: input.message });
  if (!parsed.success) return { status: "INVALID" };
  if (!checkRateLimit(input.userId, "discord-player-classified", { limit: 5 })) return { status: "RATE_LIMITED" };
  const scopedDb = await getScopedPrisma(input.userId);
  const game = await scopedDb.game.findUnique({ where: { id: parsed.data.gameId }, select: { id: true } });
  if (!game) return { status: "GAME_NOT_FOUND" };
  const createdAt = input.now ?? wallClockNow();
  await scopedDb.playerClassified.create({
    data: {
      communityId: input.communityId,
      gameId: game.id,
      createdById: input.userId,
      message: parsed.data.message,
      createdAt,
      expiresAt: playerClassifiedExpiresAt(createdAt),
    },
  });
  return { status: "PUBLISHED" };
}

/** Retrait par le seul auteur de l'annonce, dans sa communauté. */
export async function removeListing(input: {
  userId: string;
  communityId: string;
  listingId: string;
}): Promise<"removed" | "missing" | "not_owner"> {
  if (!z.string().min(1).max(40).safeParse(input.listingId).success) return "missing";
  const scopedDb = await getScopedPrisma(input.userId);
  const listing = await scopedDb.playerClassified.findFirst({
    where: { id: input.listingId, communityId: input.communityId },
    select: { id: true, createdById: true },
  });
  if (!listing) return "missing";
  if (listing.createdById !== input.userId) return "not_owner";
  const removed = await scopedDb.playerClassified.deleteMany({
    where: { id: listing.id, communityId: input.communityId, createdById: input.userId },
  });
  return removed.count ? "removed" : "missing";
}

export function handleSignedPlayerInteraction(body: unknown, timestamp: string | null): InteractionOutput {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { status: 400 };
  const interaction = parsed.data;
  const seconds = Number(timestamp);
  if (
    !timestamp ||
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300 ||
    interaction.application_id !== process.env.DISCORD_CLIENT_ID
  ) {
    return { status: 400 };
  }
  if (!interaction.guild_id) return quiet("Utilise cette commande dans le serveur de la communauté.");
  if (!playersCommandEnabled()) return quiet("La recherche de joueurs n’est pas encore ouverte sur ce serveur.");
  const subName = interaction.data.options?.[0]?.name ?? "annonces";
  if (WRITE_SUBCOMMANDS.has(subName) && !playersWriteEnabled()) {
    return quiet("Publier ou retirer une annonce depuis Discord n’est pas encore ouvert : tu peux le faire sur GameNight, `/joueurs`.");
  }

  const options = interaction.data.options?.[0]?.options ?? [];
  const text = (name: string): string => {
    const value = options.find((option) => option.name === name)?.value;
    return typeof value === "string" ? value.trim() : "";
  };
  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return { status: 400 };

  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runPlayers: async () => {
      let content: string;
      try {
        const context = await resolvePlayerContext({ guildId: interaction.guild_id!, discordId });
        if (context.status !== "OK") {
          content =
            context.status === "DISABLED"
              ? "Les annonces de joueurs ne sont pas activées pour cette communauté."
              : "Ton compte n’est pas encore membre de cette communauté GameNight. Connecte-toi une fois sur le site.";
        } else if (subName === "publier") {
          const game = await resolveGameId(text("jeu"));
          if (game.kind === "NONE") content = "Jeu introuvable : précise le nom exact du jeu.";
          else if (game.kind === "AMBIGUOUS")
            content = `Plusieurs jeux correspondent : ${game.names.join(", ")}. Précise le nom exact.`;
          else {
            const published = await publishListing({
              userId: context.userId,
              communityId: context.communityId,
              gameId: game.id,
              message: text("description"),
            });
            content =
              published.status === "PUBLISHED"
                ? "✅ Annonce publiée pour 24 h. Elle apparaît sur GameNight (`/joueurs`) et dans `/joueurs annonces`."
                : published.status === "RATE_LIMITED"
                  ? RATE_LIMIT_MESSAGE
                  : published.status === "INVALID"
                    ? "Décris ta recherche en 240 caractères maximum (jeu + envie)."
                    : "L’annonce n’a pas pu être publiée. Réessaie dans un instant.";
          }
        } else if (subName === "retirer") {
          const removed = await removeListing({
            userId: context.userId,
            communityId: context.communityId,
            listingId: text("annonce"),
          });
          content =
            removed === "removed"
              ? "✅ Annonce retirée."
              : removed === "not_owner"
                ? "Cette annonce n’est pas la tienne : seul son auteur peut la retirer."
                : "Annonce introuvable ou déjà expirée.";
        } else {
          content = renderListings(
            await loadPlayerListings({
              userId: context.userId,
              communityId: context.communityId,
              onlyMine: subName === "mes-annonces",
              gameQuery: subName === "chercher" ? text("jeu") : "",
            }),
            context.communityName,
            subName === "mes-annonces"
          );
        }
      } catch (error) {
        logger.warn("discord-joueurs", "Échec du traitement /joueurs.", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        content = "Impossible de traiter les annonces pour le moment. Réessaie dans un instant.";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: content.slice(0, MAX_CONTENT),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-joueurs", "Réponse privée /joueurs non livrée.", { kind: sent.kind });
    },
  };
}
