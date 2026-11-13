import { z } from "zod";
import { getCommunityTeamsCommunityId, joinCommunityTeam, listCommunityTeams } from "@/lib/community-teams";
import { editSetupResponse } from "@/lib/discord-rest";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { InteractionOutput } from "@/lib/discord-interactions";

const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const interactionSchema = z.object({
  type: z.literal(2),
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake.optional(),
  member: z.object({ user: z.object({ id: snowflake, bot: z.literal(false).optional() }) }).optional(),
  data: z.object({
    name: z.literal("equipe"),
    options: z.array(z.object({
      type: z.literal(1),
      name: z.enum(["liste", "moi", "rejoindre"]),
      options: z.array(z.object({ name: z.string(), type: z.number(), value: z.unknown().optional() })).optional(),
    })).length(1),
  }),
});

const ephemeral = (content: string): InteractionOutput => ({
  status: 200,
  body: { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } },
});

async function commandResult(guildId: string, discordId: string, action: "liste" | "moi" | "rejoindre", teamId?: string) {
  const user = await prisma.user.findUnique({ where: { discordId }, select: { id: true } });
  if (!user) return "Associe d’abord ton compte Discord à GameNight pour utiliser les équipes.";

  const communityId = await getCommunityTeamsCommunityId(user.id);
  if (!communityId) return "Les équipes ne sont pas disponibles pour ton compte GameNight.";
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { discordGuildId: true, status: true, communityTeamsEnabled: true },
  });
  if (community?.discordGuildId !== guildId || community.status !== "ACTIVE" || !community.communityTeamsEnabled) {
    return "Sélectionne ce serveur dans GameNight avant d’utiliser cette commande.";
  }

  if (action === "rejoindre") {
    if (!teamId) return "Indique l’identifiant de l’équipe affiché par `/equipe liste`.";
    const result = await joinCommunityTeam(user.id, communityId, teamId);
    return {
      joined: "Tu as rejoint l’équipe.",
      already: "Tu fais déjà partie de cette équipe.",
      closed: "Le recrutement de cette équipe est fermé.",
      full: "Cette équipe est complète.",
      missing: "Cette équipe n’est pas accessible dans ce serveur.",
      unavailable: "Les équipes ne sont pas disponibles pour ton compte GameNight.",
      already_team: "Tu fais déjà partie d’une équipe de cette communauté.",
      cooldown: "Tu dois attendre la fin de ton délai avant de rejoindre une autre équipe.",
    }[result];
  }

  const teams = await listCommunityTeams(user.id, communityId);
  const visible = action === "moi"
    ? teams.filter(team => team.members.some(member => member.userId === user.id))
    : teams.filter(team => team.isRecruiting && team._count.members < team.maxMembers);
  if (visible.length === 0) return action === "moi" ? "Tu n’as pas d’équipe active dans ce serveur." : "Aucune équipe ne recrute pour le moment.";

  return `${action === "moi" ? "Tes équipes" : "Équipes qui recrutent"} :\n${visible.slice(0, 12).map(team => {
    const count = team._count.members;
    return `• ${team.name.replace(/[\r\n]/g, " ")} — ${team.game.name} · ${team.platform} · ${count}/${team.maxMembers} · ID ${team.id}`;
  }).join("\n")}`.slice(0, 1900);
}

export function handleSignedTeamCommand(input: unknown): InteractionOutput {
  const parsed = interactionSchema.safeParse(input);
  if (!parsed.success) return ephemeral("Commande invalide.");
  const interaction = parsed.data;
  if (!interaction.guild_id || !interaction.member?.user.id) return ephemeral("Cette commande s’utilise dans un serveur.");

  const subcommand = interaction.data.options[0];
  const options = subcommand.options ?? [];
  let teamId: string | undefined;
  if (subcommand.name === "rejoindre") {
    if (options.length !== 1 || options[0].name !== "equipe_id" || options[0].type !== 3 || typeof options[0].value !== "string") {
      return ephemeral("Indique l’identifiant de l’équipe affiché par `/equipe liste`.");
    }
    const id = z.string().trim().min(1).max(191).safeParse(options[0].value);
    if (!id.success) return ephemeral("Identifiant d’équipe invalide.");
    teamId = id.data;
  } else if (options.length !== 0) {
    return ephemeral("Commande invalide.");
  }

  const applicationId = interaction.application_id;
  const token = interaction.token;
  const guildId = interaction.guild_id;
  const discordId = interaction.member.user.id;
  const action = subcommand.name;
  // Compteur en mémoire par instance : ne garantit PAS une limite distribuée
  // (remis à zéro à chaque cold start, un compteur par instance serverless).
  if (!checkRateLimit(discordId, `discord-equipe:${action}`, { limit: 5, windowMs: 60_000 })) {
    return ephemeral("Trop de requêtes, réessaie dans une minute.");
  }
  return {
    status: 200,
    body: { type: 5, data: { flags: 64 } },
    runTeam: async () => {
      let content: string;
      try {
        content = await commandResult(guildId, discordId, action, teamId);
      } catch (error) {
        logger.error("discord-team-command", error, { guildId });
        content = "La commande n’a pas pu aboutir. Vérifie ton équipe dans GameNight avant de réessayer.";
      }
      const sent = await editSetupResponse({ applicationId, token, content, deadline: new Date(Date.now() + 10_000) });
      if (!sent.ok) logger.error("discord-team-command", "Réponse éphémère Discord non livrée.", { guildId, kind: sent.kind });
    },
  };
}
