import { z } from "zod";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { editSetupResponse } from "@/lib/discord-rest";
import { listCommunityTeams } from "@/lib/community-teams";
import type { InteractionOutput } from "@/lib/discord-interactions";

/**
 * `/equipe` — LECTURE SEULE sur les équipes déjà gérées par GameNight
 * (`CommunityTeam` / `CommunityTeamMember`).
 *
 * Périmètre volontairement borné :
 * - aucune écriture, aucune création d'équipe, de salon ou de rôle ;
 * - aucune donnée privée : ni identifiant Discord, ni e-mail, ni jeton ;
 * - les équipes ne sont visibles qu'aux membres ACTIFS de la communauté, et
 *   seulement si `Community.communityTeamsEnabled` est actif — les mêmes règles
 *   que `/equipes` sur le site, via `listCommunityTeams`.
 *
 * La création automatique d'équipes, de salons et de rôles reste l'objectif
 * final, mais rien ici ne la simule : `/aide` continue de l'annoncer en
 * préparation.
 */
const EPHEMERAL = 64;
const REPLY_BUDGET_MS = 10_000;
const MAX_CONTENT = 1_900;
const MAX_LISTED_TEAMS = 12;
const MAX_LISTED_MEMBERS = 15;

const snowflake = z.string().regex(/^[0-9]{16,20}$/);

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
    name: z.literal("equipe"),
    options: z
      .array(
        z.object({
          name: z.enum(["liste", "moi", "voir"]),
          type: z.literal(1).optional(),
          options: z
            .array(z.object({ name: z.literal("equipe"), type: z.literal(3), value: z.string().min(1).max(120) }))
            .max(1)
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

export function teamsCommandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_TEAM_COMMAND_ENABLED === "true";
}

/** Vue compacte : ce qui est déjà public sur `/equipes`, rien de plus. */
export interface CommunityTeamView {
  id: string;
  name: string;
  game: string;
  platform: string;
  description: string;
  isRecruiting: boolean;
  maxMembers: number;
  membersCount: number;
  captainName: string;
  memberNames: string[];
  memberIds: string[];
}

export type CommunityTeamsResult =
  | { status: "TEAMS"; communityName: string; teams: CommunityTeamView[] }
  | { status: "NOT_MEMBER" }
  | { status: "TEAMS_DISABLED" }
  | { status: "INVALID" };

export async function loadCommunityTeams(input: {
  guildId: string;
  discordId: string;
}): Promise<CommunityTeamsResult> {
  const parsed = z.object({ guildId: snowflake, discordId: snowflake }).safeParse(input);
  if (!parsed.success) return { status: "INVALID" };
  const { guildId, discordId } = parsed.data;

  const community = await prisma.community.findFirst({
    where: { discordGuildId: guildId, status: "ACTIVE" },
    select: { id: true, name: true, communityTeamsEnabled: true },
  });
  if (!community) return { status: "NOT_MEMBER" };

  const user = await prisma.user.findUnique({ where: { discordId }, select: { id: true } });
  if (!user) return { status: "NOT_MEMBER" };

  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId: community.id, userId: user.id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE") return { status: "NOT_MEMBER" };
  if (!community.communityTeamsEnabled) return { status: "TEAMS_DISABLED" };

  const teams = await listCommunityTeams(user.id, community.id);
  return {
    status: "TEAMS",
    communityName: community.name,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      game: team.game.name,
      platform: team.platform,
      description: team.description,
      isRecruiting: team.isRecruiting,
      maxMembers: team.maxMembers,
      membersCount: team.members.length,
      captainName: team.createdBy.discordName,
      memberNames: team.members.map((member) => member.user.discordName),
      memberIds: team.members.map((member) => member.userId),
    })),
  };
}

const short = (line: string, max = MAX_CONTENT) => (line.length > max ? `${line.slice(0, max - 1)}…` : line);

function teamLine(team: CommunityTeamView): string {
  const status = team.isRecruiting ? " · recrute" : "";
  return `• **${team.name}** (${team.game}) — ${team.membersCount}/${team.maxMembers}${status} · chef : ${team.captainName}`;
}

/** Contenu de `/equipe liste` — pur. */
export function renderTeamList(teams: CommunityTeamView[], communityName: string): string {
  if (teams.length === 0) {
    return `Aucune équipe n’existe encore sur **${communityName}**. La création d’équipe reste en préparation : rien n’est simulé ici.`;
  }
  const shown = teams.slice(0, MAX_LISTED_TEAMS);
  return short(
    [
      `🛡️ **Équipes de ${communityName}** — ${teams.length}`,
      ...shown.map(teamLine),
      teams.length > shown.length ? `… et ${teams.length - shown.length} autre(s) : précise un nom avec \`/equipe voir\`.` : "",
      "Lecture seule : aucune équipe, aucun salon et aucun rôle ne sont créés par cette commande.",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

/** Contenu de `/equipe moi` — pur. */
export function renderMyTeams(teams: CommunityTeamView[], userId: string): string {
  const mine = teams.filter((team) => team.memberIds.includes(userId));
  if (mine.length === 0) {
    return "Tu ne fais partie d’aucune équipe pour le moment. Rejoindre une équipe se fait sur le site, pas depuis Discord.";
  }
  return short(
    [
      "🛡️ **Tes équipes**",
      ...mine.map((team) => `${teamLine(team)}${team.memberIds[0] === userId ? " · capitaine" : ""}`),
      "Lecture seule : rien n’est modifié par cette commande.",
    ].join("\n")
  );
}

/** Contenu de `/equipe voir` — pur ; `null` quand l’équipe est inconnue. */
export function renderTeamDetail(teams: CommunityTeamView[], query: string): string | null {
  const needle = query.trim().toLowerCase();
  const exact = teams.find((team) => team.id === query.trim());
  const byName = teams.filter((team) => team.name.toLowerCase() === needle);
  const partial = teams.filter((team) => team.name.toLowerCase().includes(needle));
  const found = exact ?? (byName.length === 1 ? byName[0] : partial.length === 1 ? partial[0] : null);
  if (!found) {
    if (byName.length > 1 || partial.length > 1) {
      return short(
        [
          "Plusieurs équipes correspondent à ce nom :",
          ...(byName.length > 1 ? byName : partial).slice(0, MAX_LISTED_TEAMS).map(teamLine),
          "Précise le nom exact.",
        ].join("\n")
      );
    }
    return "Aucune équipe ne porte ce nom sur cette communauté.";
  }
  const members = found.memberNames.slice(0, MAX_LISTED_MEMBERS);
  return short(
    [
      `🛡️ **${found.name}**`,
      `${found.game} · ${found.platform} · ${found.membersCount}/${found.maxMembers}${found.isRecruiting ? " · recrute" : " · complète"}`,
      found.description.trim() ? found.description.trim().slice(0, 400) : "_Pas de description._",
      `Chef d’équipe : ${found.captainName}`,
      members.length > 0 ? `Membres : ${members.join(", ")}${found.memberNames.length > members.length ? "…" : ""}` : "Aucun membre actif.",
      "Lecture seule : aucune donnée privée, aucun identifiant Discord.",
    ].join("\n")
  );
}

/** Exclusivement appelé après la vérification Ed25519 du corps brut. */
export function handleSignedTeamInteraction(body: unknown, timestamp: string | null): InteractionOutput {
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
  if (!teamsCommandEnabled()) {
    return quiet("La commande /equipe n’est pas encore ouverte sur ce serveur.");
  }

  const sub = interaction.data.options?.[0];
  const subName = sub?.name ?? "liste";
  const query = sub?.options?.[0]?.value ?? "";

  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return { status: 400 };
  const guildId = interaction.guild_id;

  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runTeams: async () => {
      let content: string;
      try {
        const result = await loadCommunityTeams({ guildId, discordId });
        if (result.status === "TEAMS") {
          const user = await prisma.user.findUnique({ where: { discordId }, select: { id: true } });
          const userId = user?.id ?? "";
          content =
            subName === "liste"
              ? renderTeamList(result.teams, result.communityName)
              : subName === "moi"
                ? renderMyTeams(result.teams, userId)
                : renderTeamDetail(result.teams, query) ??
                  "Indique le nom de l’équipe : `/equipe voir equipe:<nom>`.";
        } else if (result.status === "TEAMS_DISABLED") {
          content = "Les équipes ne sont pas activées sur cette communauté.";
        } else if (result.status === "NOT_MEMBER") {
          content =
            "Ton compte n’est pas encore membre de cette communauté GameNight. Connecte-toi une première fois sur le site, puis réessaie.";
        } else {
          content = "Cette demande est invalide. Réessaie depuis le serveur de la communauté.";
        }
      } catch (error) {
        logger.warn("discord-team", "Échec du chargement des équipes.", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        content = "Impossible de lire les équipes pour le moment. Réessaie dans un instant.";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: content.slice(0, MAX_CONTENT),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-team", "Réponse privée /equipe non livrée.", { kind: sent.kind });
    },
  };
}
