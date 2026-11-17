import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { editSetupResponse } from "@/lib/discord-rest";
import type { InteractionOutput } from "@/lib/discord-interactions";

/**
 * `/tournoi` — LECTURE SEULE sur les tournois GameNight existants
 * (`Tournament` / `TournamentParticipant`).
 *
 * Aucun second système, aucune écriture : la création, les inscriptions, les
 * scores et les annonces restent sur GameNight. Cette v1 ne fait que rendre les
 * tournois visibles depuis Discord, dans la communauté du serveur.
 *
 * Portée : uniquement les tournois de la communauté du serveur Discord, et
 * seulement pour un membre ACTIF — les mêmes données que `/tournois` côté site,
 * sans exposer d'identifiant Discord ni de donnée privée.
 */
const EPHEMERAL = 64;
const REPLY_BUDGET_MS = 10_000;
const MAX_CONTENT = 1_900;
const MAX_LISTED = 10;
const snowflake = z.string().regex(/^[0-9]{16,20}$/);

const STATUS_FILTERS = ["avenir", "encours", "termines", "tous"] as const;
const SUBCOMMANDS = ["liste", "voir"] as const;

const inputSchema = z.object({
  type: z.literal(2),
  id: snowflake,
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake.optional(),
  member: z
    .object({
      user: z.object({ id: snowflake, username: z.string().min(1).max(100), bot: z.literal(false).optional() }).optional(),
    })
    .optional(),
  user: z.object({ id: snowflake }).optional(),
  data: z.object({
    name: z.literal("tournoi"),
    options: z
      .array(
        z.object({
          name: z.enum(SUBCOMMANDS),
          type: z.literal(1).optional(),
          options: z
            .array(
              z.object({
                name: z.string().min(1).max(40),
                type: z.number().optional(),
                value: z.union([z.string().max(200), z.number()]).optional(),
              })
            )
            .max(2)
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

export function tournamentCommandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_TOURNAMENT_COMMAND_ENABLED === "true";
}

export type TournamentStatus = "REGISTRATION" | "IN_PROGRESS" | "DONE" | "CANCELLED";

const STATUS_LABELS: Record<TournamentStatus, string> = {
  REGISTRATION: "inscriptions ouvertes",
  IN_PROGRESS: "en cours",
  DONE: "terminé",
  CANCELLED: "annulé",
};

const FORMAT_LABELS: Record<string, string> = { INDIVIDUAL: "solo", TEAMS: "par équipes" };

export interface TournamentView {
  id: string;
  name: string;
  game: string;
  status: TournamentStatus;
  statusLabel: string;
  format: string;
  players: number;
  maxPlayers: number;
  creatorName: string;
  championName: string | null;
  championTeamName: string | null;
}

export type TournamentContext =
  | { status: "OK"; communityId: string; communityName: string }
  | { status: "NOT_MEMBER" }
  | { status: "INVALID" };

export async function resolveTournamentContext(input: {
  guildId: string;
  discordId: string;
}): Promise<TournamentContext> {
  const parsed = z.object({ guildId: snowflake, discordId: snowflake }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" };
  const community = await prisma.community.findFirst({
    where: { discordGuildId: parsed.data.guildId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!community) return { status: "NOT_MEMBER" };
  const user = await prisma.user.findUnique({ where: { discordId: parsed.data.discordId }, select: { id: true } });
  if (!user) return { status: "NOT_MEMBER" };
  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId: community.id, userId: user.id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE") return { status: "NOT_MEMBER" };
  return { status: "OK", communityId: community.id, communityName: community.name };
}

const tournamentSelect = {
  id: true,
  name: true,
  status: true,
  format: true,
  maxPlayers: true,
  game: { select: { name: true } },
  createdBy: { select: { discordName: true } },
  champion: { select: { discordName: true } },
  championTeam: { select: { name: true } },
  _count: { select: { participants: true } },
} as const;

type TournamentRow = {
  id: string;
  name: string;
  status: TournamentStatus;
  format: string;
  maxPlayers: number;
  game: { name: string };
  createdBy: { discordName: string };
  champion: { discordName: string } | null;
  championTeam: { name: string } | null;
  _count: { participants: number };
};

const toView = (row: TournamentRow): TournamentView => ({
  id: row.id,
  name: row.name,
  game: row.game.name,
  status: row.status,
  statusLabel: STATUS_LABELS[row.status],
  format: FORMAT_LABELS[row.format] ?? row.format.toLowerCase(),
  players: row._count.participants,
  maxPlayers: row.maxPlayers,
  creatorName: row.createdBy.discordName,
  championName: row.champion?.discordName ?? null,
  championTeamName: row.championTeam?.name ?? null,
});

/** Statuts affichés selon le filtre demandé (défaut : à venir + en cours). */
export function statusesForFilter(filter: string): TournamentStatus[] {
  switch (filter) {
    case "avenir":
      return ["REGISTRATION"];
    case "encours":
      return ["IN_PROGRESS"];
    case "termines":
      return ["DONE", "CANCELLED"];
    case "tous":
      return ["REGISTRATION", "IN_PROGRESS", "DONE", "CANCELLED"];
    default:
      return ["REGISTRATION", "IN_PROGRESS"];
  }
}

export async function loadTournaments(input: {
  communityId: string;
  filter?: string;
}): Promise<TournamentView[]> {
  const rows = await prisma.tournament.findMany({
    where: { communityId: input.communityId, status: { in: statusesForFilter(input.filter ?? "") } },
    select: tournamentSelect,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: MAX_LISTED,
  });
  return rows.map((row) => toView(row as TournamentRow));
}

export async function loadTournamentDetail(input: {
  communityId: string;
  tournamentId: string;
}): Promise<TournamentView | null> {
  if (!z.string().min(1).max(40).safeParse(input.tournamentId).success) return null;
  const row = await prisma.tournament.findFirst({
    where: { id: input.tournamentId, communityId: input.communityId },
    select: tournamentSelect,
  });
  return row ? toView(row as TournamentRow) : null;
}

export function renderTournamentList(tournaments: TournamentView[], communityName: string): string {
  if (tournaments.length === 0) {
    return `Aucun tournoi à afficher sur **${communityName}**. La création se fait sur GameNight.`;
  }
  return [
    `🏆 **Tournois — ${communityName}**`,
    ...tournaments.map(
      (tournament) =>
        `• **${tournament.name}** (${tournament.game}) — ${tournament.statusLabel} · ${tournament.players}/${tournament.maxPlayers} · ${tournament.format} · \`${tournament.id}\``
    ),
    "Lecture seule : inscriptions, scores et annonces restent sur GameNight.",
  ].join("\n").slice(0, MAX_CONTENT);
}

export function renderTournamentDetail(tournament: TournamentView): string {
  const champion = tournament.championTeamName ?? tournament.championName;
  return [
    `🏆 **${tournament.name}**`,
    `${tournament.game} · ${tournament.statusLabel} · ${tournament.format}`,
    `Participants : ${tournament.players}/${tournament.maxPlayers}`,
    `Organisateur : ${tournament.creatorName}`,
    tournament.status === "DONE" && champion ? `Vainqueur : ${champion}` : "",
    "Lecture seule : cette commande n’inscrit personne et ne modifie aucun score.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CONTENT);
}

export function handleSignedTournamentInteraction(body: unknown, timestamp: string | null): InteractionOutput {
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
  if (!tournamentCommandEnabled()) return quiet("La commande /tournoi n’est pas encore ouverte sur ce serveur.");

  const sub = interaction.data.options?.[0];
  const subName = sub?.name ?? "liste";
  const options = sub?.options ?? [];
  const text = (name: string): string => {
    const value = options.find((option) => option.name === name)?.value;
    return typeof value === "string" ? value.trim() : "";
  };
  const filterValue = text("statut");

  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return { status: 400 };
  const guildId = interaction.guild_id;

  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runTournament: async () => {
      let content: string;
      try {
        const context = await resolveTournamentContext({ guildId, discordId });
        if (context.status !== "OK") {
          content =
            context.status === "NOT_MEMBER"
              ? "Ton compte n’est pas encore membre de cette communauté GameNight. Connecte-toi une première fois sur le site."
              : "Cette demande est invalide. Réessaie depuis le serveur de la communauté.";
        } else if (subName === "liste") {
          content = renderTournamentList(
            await loadTournaments({ communityId: context.communityId, filter: filterValue }),
            context.communityName
          );
        } else {
          const id = text("tournoi");
          const detail = id ? await loadTournamentDetail({ communityId: context.communityId, tournamentId: id }) : null;
          content = detail ? renderTournamentDetail(detail) : "Tournoi introuvable sur cette communauté.";
        }
      } catch (error) {
        logger.warn("discord-tournament", "Échec de la lecture des tournois.", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        content = "Impossible de lire les tournois pour le moment. Réessaie dans un instant.";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: content.slice(0, MAX_CONTENT),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-tournament", "Réponse privée /tournoi non livrée.", { kind: sent.kind });
    },
  };
}

export const TOURNAMENT_STATUS_FILTERS = STATUS_FILTERS;
