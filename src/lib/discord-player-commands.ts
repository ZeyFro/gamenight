import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { editSetupResponse } from "@/lib/discord-rest";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { getPlayerClassifiedCommunityId } from "@/lib/player-classifieds";
import {
  createPlayerListing,
  deletePlayerListing,
  filterListings,
  listCommunityListings,
  listOwnListings,
  type PlayerListing,
} from "@/lib/player-listings";
import { withGameNightLink } from "@/lib/discord-links";
import { playerListingComponents } from "@/lib/discord-player-listing-components";
import type { DiscordActionRow } from "@/lib/discord-rest";
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

/**
 * Annonces lisibles ici : même lecture que la page `/joueurs`
 * (`listPlayerClassifieds`), plus ses propres annonces expirées.
 */
export async function loadPlayerListings(input: {
  userId: string;
  communityId: string;
  onlyMine: boolean;
  gameQuery?: string;
}): Promise<PlayerListing[]> {
  const rows = input.onlyMine
    ? await listOwnListings({ userId: input.userId, communityId: input.communityId })
    : await listCommunityListings({ userId: input.userId, communityId: input.communityId });
  return filterListings(rows, {
    query: input.gameQuery,
    includeExpired: input.onlyMine,
  }).slice(0, MAX_LISTED);
}

export function renderListings(listings: PlayerListing[], communityName: string, onlyMine: boolean): string {
  if (listings.length === 0) {
    return onlyMine
      ? "Tu n’as aucune annonce. `/joueurs publier` crée une annonce de 24 h (jeu + message, 240 caractères)."
      : `Aucune annonce active sur **${communityName}**. Sois le premier : \`/joueurs publier\` (24 h, 5 publications par fenêtre).`;
  }
  return [
    onlyMine ? "🔎 **Tes annonces**" : `🔎 **Joueurs recherchés — ${communityName}**`,
    ...listings.map((listing) => {
      const when = listing.expired
        ? "⏳ expirée"
        : `expire le ${listing.expiresAt.toLocaleDateString("fr-FR")}`;
      return `• **${listing.game}** — ${listing.message.slice(0, 140)} · ${listing.authorName} · ${when} · \`${listing.id}\``;
    }),
    onlyMine
      ? "Retire une annonce avec `/joueurs retirer`."
      : "Filtre par jeu avec `/joueurs chercher`; la page GameNight `/joueurs` donne le détail complet.",
  ].join("\n").slice(0, MAX_CONTENT);
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
      // Boutons réellement envoyés dans le payload : une rangée par annonce active.
      const components: DiscordActionRow[] = [];
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
            // Service partagé : même validation, même expiration, même anti-doublon
            // que l’action web dès que le patch #408 est appliqué.
            const published = await createPlayerListing({
              userId: context.userId,
              communityId: context.communityId,
              gameId: game.id,
              message: text("description"),
            });
            if (published.status === "created" || published.status === "duplicate") {
              components.push(...playerListingComponents({ listingId: published.id }));
            }
            content =
              published.status === "created"
                ? "✅ Annonce publiée pour 24 h. Elle apparaît sur GameNight (`/joueurs`) et dans `/joueurs annonces`."
                : published.status === "duplicate"
                  ? "Tu as déjà publié exactement la même annonce : elle reste active."
                  : published.status === "rate_limited"
                    ? RATE_LIMIT_MESSAGE
                    : published.status === "invalid"
                      ? "Décris ta recherche en 240 caractères maximum (jeu + envie)."
                      : "L’annonce n’a pas pu être publiée. Réessaie dans un instant.";
          }
        } else if (subName === "retirer") {
          const removed = await deletePlayerListing({
            userId: context.userId,
            communityId: context.communityId,
            listingId: text("annonce"),
          });
          // Chaque issue du service a sa réponse : aucun cas ne prétend avoir
          // supprimé quelque chose quand `deletePlayerListing` n’a rien écrit.
          content =
            removed === "deleted"
              ? "✅ Annonce retirée : elle disparaît aussi de GameNight (`/joueurs`)."
              : removed === "not_owner"
                ? "Cette annonce n’est pas la tienne : seul son auteur peut la retirer."
                : removed === "rate_limited"
                  ? RATE_LIMIT_MESSAGE
                  : "Annonce introuvable ou déjà retirée : rien n’a été modifié.";
        } else {
          const listings = await loadPlayerListings({
            userId: context.userId,
            communityId: context.communityId,
            onlyMine: subName === "mes-annonces",
            gameQuery: subName === "chercher" ? text("jeu") : "",
          });
          content = withGameNightLink(
            renderListings(listings, context.communityName, subName === "mes-annonces"),
            "/joueurs"
          );
          // Discord plafonne à 5 rangées : 4 annonces au maximum, et jamais une
          // annonce expirée (aucun bouton actif sur une annonce morte).
          for (const listing of listings.filter((candidate) => !candidate.expired).slice(0, 4)) {
            components.push(...playerListingComponents({ listingId: listing.id }));
          }
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
        ...(components.length ? { components } : {}),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-joueurs", "Réponse privée /joueurs non livrée.", { kind: sent.kind });
    },
  };
}
