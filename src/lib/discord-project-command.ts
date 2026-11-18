import { z } from "zod";
import { logger } from "@/lib/logger";
import { editSetupResponse } from "@/lib/discord-rest";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createCommunityTeam,
  joinCommunityTeam,
  leaveCommunityTeam,
  listCommunityTeams,
  setCommunityTeamRecruitment,
} from "@/lib/community-teams";
import { communityTeamSchema } from "@/lib/community-teams-rules";
import { resolveTeamCommandContext } from "@/lib/discord-team-command";
import { resolveGameId } from "@/lib/discord-game-lookup";
import { requestTeamSpaceMemberSync } from "@/lib/discord-team-space-hooks";
import { enqueueTeamSpaceSync, teamSpaceQueueEnabled } from "@/lib/discord-team-space-queue";
import { readTeamSpaceLink } from "@/lib/discord-team-space-service";
import type { InteractionOutput } from "@/lib/discord-interactions";

/**
 * `/projet` : vocabulaire « projet » (aventure multigaming, guilde, coop) sur les
 * équipes EXISTANTES (`CommunityTeam`). Façade assumée : mêmes données, mêmes
 * services de `community-teams.ts` (#370 : 2 à 8 joueurs, une équipe par joueur et
 * par communauté, délai de 7 jours, capitaine `captainId ?? createdById`) et même
 * contexte que `/equipe` (`resolveTeamCommandContext`, `discord-team-command.ts`).
 * Aucune règle ni modèle dupliqué : un projet créé ici apparaît dans `/equipe liste`
 * et sur `/equipes`, et inversement.
 *
 * Interdits tenus : aucun appel Discord pour un salon ou un rôle (la sous-commande
 * `espace` ne fait qu'enfiler une demande, exécutée par l'executor derrière
 * `DISCORD_TEAM_SPACES_ENABLED`), aucun XP, aucun étage.
 *
 * Verrous : `DISCORD_PROJECT_COMMAND_ENABLED` (lecture) puis
 * `DISCORD_PROJECT_WRITE_ENABLED` (créer, rejoindre, quitter, recrutement, espace).
 */
const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const SUBCOMMANDS = ["liste", "voir", "rejoindre", "quitter", "creer", "recrutement", "espace"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];
const WRITE_SUBCOMMANDS = new Set<Subcommand>(["rejoindre", "quitter", "creer", "recrutement", "espace"]);
const MAX_CONTENT = 1_900;

const interactionSchema = z.object({
  type: z.literal(2),
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake.optional(),
  member: z.object({ user: z.object({ id: snowflake, bot: z.literal(false).optional() }) }).optional(),
  data: z.object({
    name: z.literal("projet"),
    options: z
      .array(
        z.object({
          type: z.literal(1),
          name: z.enum(SUBCOMMANDS),
          options: z
            .array(z.object({ name: z.string().min(1).max(40), type: z.number(), value: z.union([z.string().max(1_000), z.number(), z.boolean()]).optional() }))
            .max(6)
            .optional(),
        })
      )
      .length(1),
  }),
});

const ephemeral = (content: string): InteractionOutput => ({
  status: 200,
  body: { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } },
});

export const projectCommandEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.DISCORD_PROJECT_COMMAND_ENABLED === "true";
export const projectWriteEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.DISCORD_PROJECT_WRITE_ENABLED === "true";

type Team = Awaited<ReturnType<typeof listCommunityTeams>>[number];
type Options = Array<{ name: string; value?: string | number | boolean }>;

const clean = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const text = (options: Options, name: string): string => {
  const value = options.find((option) => option.name === name)?.value;
  return typeof value === "string" ? value.trim() : "";
};

/** Identifiant exact ou nom exact (sans casse) ; un nom partagé par plusieurs projets est refusé. */
export function findProject(teams: Team[], query: string): { kind: "FOUND"; team: Team } | { kind: "NONE" } {
  const needle = query.trim().toLocaleLowerCase("fr-FR");
  if (!needle) return { kind: "NONE" };
  const byId = teams.find((team) => team.id === query.trim());
  if (byId) return { kind: "FOUND", team: byId };
  const byName = teams.filter((team) => team.name.toLocaleLowerCase("fr-FR") === needle);
  return byName.length === 1 ? { kind: "FOUND", team: byName[0] } : { kind: "NONE" };
}

export function renderProjectList(teams: Team[]): string {
  const open = teams.filter((team) => team.isRecruiting && team._count.members < team.maxMembers);
  if (open.length === 0) return "Aucun projet ne recrute pour le moment.";
  return `🗂️ Projets qui recrutent :\n${open
    .slice(0, 12)
    .map((team) => `• ${clean(team.name)} — ${team.game.name} · ${clean(team.platform)} · ${team._count.members}/${team.maxMembers} · ID ${team.id}`)
    .join("\n")}`.slice(0, MAX_CONTENT);
}

export function renderProjectDetail(team: Team): string {
  const captain = team.captain?.discordName ?? team.createdBy.discordName;
  return [
    `🗂️ **${clean(team.name)}** — ${team.game.name} · ${clean(team.platform)}`,
    `Objectif : ${clean(team.description ?? "")}`.slice(0, 600),
    `Places : ${team._count.members}/${team.maxMembers} · ${team.isRecruiting ? "recrute" : "ne recrute pas"}`,
    `Capitaine : ${clean(captain)}`,
    `Membres : ${team.members.map((member) => clean(member.user.discordName)).join(", ") || "aucun"}`,
    `ID ${team.id}`,
  ].join("\n").slice(0, MAX_CONTENT);
}

const JOIN_MESSAGES = {
  joined: "✅ Tu as rejoint le projet. Il apparaît dans ton profil et dans GameNight.",
  already: "Tu participes déjà à ce projet.",
  closed: "Ce projet ne recrute pas pour le moment.",
  full: "Ce projet est complet.",
  missing: "Projet introuvable dans ce serveur.",
  unavailable: "Les projets ne sont pas disponibles pour ton compte GameNight.",
  already_team: "Tu fais déjà partie d’une équipe de cette communauté.",
  cooldown: "Tu dois attendre la fin de ton délai avant de rejoindre une autre équipe.",
} as const;

const CREATE_MESSAGES = {
  created: "✅ Projet créé : il apparaît dans GameNight (`/equipes`) et dans `/projet liste`. Ouvre le recrutement avec `/projet recrutement`.",
  limit: "Tu as déjà créé 3 projets ces dernières 24 h.",
  invalid_game: "Jeu invalide pour cette communauté.",
  unavailable: "Le projet n’a pas pu être créé : vérifie que tu es membre et que les équipes sont activées.",
  already_team: "Tu fais déjà partie d’une équipe de cette communauté.",
  cooldown: "Tu dois attendre la fin de ton délai avant de rejoindre une autre équipe.",
} as const;

async function createProject(userId: string, communityId: string, options: Options): Promise<string> {
  const places = options.find((option) => option.name === "places")?.value;
  const parsed = communityTeamSchema.omit({ gameId: true }).safeParse({
    name: text(options, "nom"),
    description: text(options, "objectif"),
    platform: text(options, "plateforme"),
    maxMembers: places,
  });
  if (!parsed.success) {
    return "Projet invalide : nom de 3 à 80 caractères, objectif de 10 à 1000, plateforme renseignée, 2 à 8 places. 3 créations par 24 h, une seule équipe par joueur.";
  }
  const game = await resolveGameId(text(options, "jeu"));
  if (game.kind === "NONE") return "Jeu introuvable : précise le nom exact.";
  if (game.kind === "AMBIGUOUS") return `Plusieurs jeux correspondent : ${game.names.join(", ")}. Précise le nom exact.`;
  // Même service que `/equipes` : aucune règle dupliquée.
  return CREATE_MESSAGES[await createCommunityTeam({ userId, communityId, gameId: game.id, ...parsed.data })];
}

async function requestSpace(userId: string, communityId: string, team: Team): Promise<string> {
  if ((team.captainId ?? team.createdById) !== userId) return "Seul le capitaine peut demander l’espace Discord du projet.";
  if (!teamSpaceQueueEnabled()) return "L’espace Discord des projets n’est pas encore ouvert.";
  const link = await readTeamSpaceLink({ teamId: team.id, communityId });
  if (link.status === "migration_required") return "L’espace Discord n’est pas encore disponible (association non migrée).";
  const result = await enqueueTeamSpaceSync({ teamId: team.id, communityId, intent: link.status === "linked" ? "reconcile" : "provision" });
  return result === "queued"
    ? "✅ Demande enregistrée : le salon privé et son rôle seront préparés par GameNight dans quelques minutes (rien n’est créé en direct)."
    : "L’espace Discord n’a pas pu être demandé : le serveur de la communauté n’est pas relié ou les équipes sont désactivées.";
}

async function commandResult(guildId: string, discordId: string, subcommand: Subcommand, options: Options): Promise<string> {
  const context = await resolveTeamCommandContext(guildId, discordId);
  if (!context.ok) return context.message;
  const { userId, communityId } = context;
  if (subcommand === "creer") return createProject(userId, communityId, options);

  const teams = await listCommunityTeams(userId, communityId);
  if (subcommand === "liste") return renderProjectList(teams);
  const found = findProject(teams, text(options, "projet"));
  if (found.kind === "NONE") return "Projet introuvable ou nom ambigu : utilise `/projet liste` (ou l’ID affiché).";
  const { team } = found;

  if (subcommand === "voir") return renderProjectDetail(team);
  if (subcommand === "rejoindre") {
    const result = await joinCommunityTeam(userId, communityId, team.id);
    if (result === "joined") await requestTeamSpaceMemberSync({ communityId, teamId: team.id, discordId });
    return JOIN_MESSAGES[result];
  }
  if (subcommand === "quitter") {
    const result = await leaveCommunityTeam(userId, communityId, team.id);
    if (result === "left") {
      await requestTeamSpaceMemberSync({ communityId, teamId: team.id, discordId });
      return `Tu as quitté **${clean(team.name)}**. Un délai de 7 jours s’applique avant de rejoindre une autre équipe.`;
    }
    return result === "leader"
      ? "Tu es seul dans ce projet : dissous-le depuis GameNight (`/equipes/gestion`)."
      : "Projet introuvable ou tu n’y participais pas.";
  }
  if (subcommand === "recrutement") {
    const open = options.find((option) => option.name === "ouvert")?.value;
    if (typeof open !== "boolean") return "Indique `ouvert` : oui ou non.";
    const saved = await setCommunityTeamRecruitment(userId, communityId, team.id, open);
    if (saved === "saved") return open ? `✅ **${clean(team.name)}** recrute.` : `✅ **${clean(team.name)}** ne recrute plus.`;
    return saved === "full" ? "Ce projet est complet : libère une place avant de recruter." : "Seul le capitaine peut changer le recrutement.";
  }
  return requestSpace(userId, communityId, team);
}

/** Réponse différée (`runTeam`) : même callback que `/equipe`, aucun accès SQL/Discord avant l'ACK. */
export function handleSignedProjectCommand(input: unknown): InteractionOutput {
  const parsed = interactionSchema.safeParse(input);
  if (!parsed.success) return ephemeral("Commande invalide.");
  const interaction = parsed.data;
  if (!interaction.guild_id || !interaction.member?.user.id) return ephemeral("Cette commande s’utilise dans un serveur.");
  if (!projectCommandEnabled()) return ephemeral("`/projet` n’est pas encore ouvert sur ce serveur. `/equipe` donne déjà accès aux mêmes équipes.");
  const subcommand = interaction.data.options[0];
  if (WRITE_SUBCOMMANDS.has(subcommand.name) && !projectWriteEnabled()) {
    return ephemeral("Créer, rejoindre, quitter ou recruter depuis `/projet` n’est pas encore ouvert. `/equipe` reste disponible.");
  }
  const options: Options = (subcommand.options ?? []).map(({ name, value }) => ({ name, value }));
  const { application_id: applicationId, token, guild_id: guildId } = interaction;
  const discordId = interaction.member.user.id;
  // Compteur en mémoire par instance : pas de limite distribuée (voir `/equipe`).
  if (!checkRateLimit(discordId, `discord-projet:${subcommand.name}`, { limit: 5, windowMs: 60_000 })) {
    return ephemeral("Trop de requêtes, réessaie dans une minute.");
  }
  return {
    status: 200,
    body: { type: 5, data: { flags: 64 } },
    runTeam: async () => {
      let content: string;
      try {
        content = await commandResult(guildId, discordId, subcommand.name, options);
      } catch (error) {
        logger.error("discord-projet", error, { guildId });
        content = "La commande n’a pas pu aboutir. Vérifie ton projet dans GameNight avant de réessayer.";
      }
      const sent = await editSetupResponse({ applicationId, token, content: content.slice(0, MAX_CONTENT), deadline: new Date(Date.now() + 10_000) });
      if (!sent.ok) logger.error("discord-projet", "Réponse éphémère Discord non livrée.", { guildId, kind: sent.kind });
    },
  };
}
