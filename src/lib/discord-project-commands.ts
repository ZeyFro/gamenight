import { z } from "zod";
import { logger } from "@/lib/logger";
import { editSetupResponse } from "@/lib/discord-rest";
import {
  createCommunityTeam,
  joinCommunityTeam,
  leaveCommunityTeam,
  setCommunityTeamRecruitment,
} from "@/lib/community-teams";
import {
  findTeam,
  loadCommunityTeams,
  renderTeamDetail,
  renderTeamList,
  resolveGameId,
  validateTeamCreationInput,
} from "@/lib/discord-team-commands";
import type { InteractionOutput } from "@/lib/discord-interactions";

/**
 * `/projet` — aventure multigaming, guilde ou projet coopératif.
 *
 * **Façade assumée sur `CommunityTeam`** : mêmes données que `/equipe`, mêmes
 * services (`createCommunityTeam`, `joinCommunityTeam`, `leaveCommunityTeam`,
 * `setCommunityTeamRecruitment`), mêmes règles (recrutement, capacité 2–20,
 * une équipe par joueur, 3 créations/24 h, capitaine = `createdById`).
 * Aucun modèle Prisma, aucun second système : un projet créé ici apparaît dans
 * `/equipes` et inversement ; `/equipe` et `/projet` ne peuvent pas diverger.
 *
 * Ce que `/projet` ajoute, et seulement cela : un vocabulaire de projet
 * (`objectif` au lieu de description) et un affichage orienté « qui recrute ».
 *
 * Interdits tenus : aucune création de salon/ rôle Discord, aucune permission,
 * aucun XP ni étage attribué.
 */
const EPHEMERAL = 64;
const REPLY_BUDGET_MS = 10_000;
const MAX_CONTENT = 1_900;
const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const SUBCOMMANDS = ["creer", "liste", "voir", "rejoindre", "quitter", "recrutement"] as const;
const WRITE_SUBCOMMANDS = new Set<string>(["creer", "rejoindre", "quitter", "recrutement"]);

const inputSchema = z.object({
  type: z.literal(2),
  id: snowflake,
  application_id: snowflake,
  token: z.string().min(1).max(2048),
  guild_id: snowflake.optional(),
  member: z.object({ user: z.object({ id: snowflake }).optional() }).optional(),
  user: z.object({ id: snowflake }).optional(),
  data: z.object({
    name: z.literal("projet"),
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
            .max(6)
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

export function projectCommandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_PROJECT_COMMAND_ENABLED === "true";
}

export function projectWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISCORD_PROJECT_WRITE_ENABLED === "true";
}

export function renderProjectDetail(teams: Parameters<typeof renderTeamDetail>[0], query: string): string | null {
  const detail = renderTeamDetail(teams, query);
  if (!detail) return null;
  return ["🗂️ **Projet**", ...detail.split("\n").filter((line) => !line.startsWith("🛡️"))]
    .join("\n")
    .slice(0, MAX_CONTENT);
}

export function handleSignedProjectInteraction(body: unknown, timestamp: string | null): InteractionOutput {
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
  if (!projectCommandEnabled()) {
    return quiet("`/projet` n’est pas encore ouvert sur ce serveur. `/equipe` donne déjà accès aux mêmes équipes.");
  }
  const subName = interaction.data.options?.[0]?.name ?? "liste";
  if (WRITE_SUBCOMMANDS.has(subName) && !projectWriteEnabled()) {
    return quiet(
      "Créer, rejoindre ou recruter depuis `/projet` n’est pas encore ouvert. `/equipe` reste disponible sur GameNight."
    );
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
    runProject: async () => {
      let content: string;
      try {
        const loaded = await loadCommunityTeams({ guildId: interaction.guild_id!, discordId });
        if (loaded.status !== "TEAMS") {
          content =
            loaded.status === "TEAMS_DISABLED"
              ? "Les projets ne sont pas activés pour cette communauté."
              : "Ton compte n’est pas encore membre de cette communauté GameNight. Connecte-toi une fois sur le site.";
        } else if (subName === "liste") {
          content = renderTeamList(
            loaded.teams.filter((team) => team.isRecruiting),
            loaded.communityName
          )
            .replace("🛡️", "🗂️")
            .replace("Équipes de", "Projets ouverts au recrutement sur")
        } else if (subName === "voir") {
          content = renderProjectDetail(loaded.teams, text("projet")) ?? "Projet introuvable sur cette communauté.";
        } else if (subName === "creer") {
          const rawPlaces = options.find((option) => option.name === "places")?.value;
          const places = typeof rawPlaces === "number" ? Math.trunc(rawPlaces) : Number(rawPlaces);
          const invalid = validateTeamCreationInput({
            name: text("nom"),
            description: text("objectif"),
            platform: text("plateforme"),
            places,
          });
          if (invalid) {
            content = `Projet invalide : ${invalid}`;
          } else {
            const game = await resolveGameId(text("jeu"));
            if (game.kind === "NONE") content = "Jeu introuvable : précise le nom exact.";
            else if (game.kind === "AMBIGUOUS")
              content = `Plusieurs jeux correspondent : ${game.names.join(", ")}. Précise le nom exact.`;
            else {
              // Même service que `/equipe creer` et `/equipes` : aucune règle dupliquée.
              const created = await createCommunityTeam({
                userId: loaded.userId,
                communityId: loaded.communityId,
                gameId: game.id,
                name: text("nom"),
                description: text("objectif"),
                platform: text("plateforme"),
                maxMembers: places,
              });
              content =
                created === "created"
                  ? "✅ Projet créé : il apparaît dans GameNight (`/equipes`) et dans `/projet liste`. Ouvre le recrutement avec `/projet recrutement`."
                  : created === "limit"
                    ? "Tu as déjà créé 3 projets ces dernières 24 h."
                    : created === "invalid_game"
                      ? "Jeu invalide pour cette communauté."
                      : "Le projet n’a pas pu être créé : vérifie que tu es membre et que les projets sont activés.";
            }
          }
        } else if (subName === "rejoindre" || subName === "quitter") {
          const found = findTeam(loaded.teams, text("projet"));
          if (found.kind !== "FOUND") content = "Projet introuvable ou nom ambigu : utilise `/projet liste`.";
          else if (subName === "rejoindre") {
            const joined = await joinCommunityTeam(loaded.userId, loaded.communityId, found.team.id);
            content =
              joined === "joined"
                ? `✅ Tu as rejoint **${found.team.name}**. Il apparaît dans ton profil et dans GameNight.`
                : joined === "already"
                  ? "Tu participes déjà à ce projet."
                  : joined === "closed"
                    ? "Ce projet ne recrute pas pour le moment."
                    : joined === "full"
                      ? "Ce projet est complet."
                      : joined === "missing"
                        ? "Projet introuvable : il a peut-être été supprimé."
                        : "Tu ne peux pas rejoindre ce projet (communauté ou compte non éligible).";
          } else {
            const left = await leaveCommunityTeam(loaded.userId, loaded.communityId, found.team.id);
            content =
              left === "left"
                ? `Tu as quitté **${found.team.name}**.`
                : left === "leader"
                  ? "Tu portes ce projet : la sortie du capitaine se gère sur GameNight (`/equipes`)."
                  : "Projet introuvable ou tu n’y participais pas.";
          }
        } else {
          const found = findTeam(loaded.teams, text("projet"));
          if (found.kind !== "FOUND") content = "Projet introuvable ou nom ambigu : utilise `/projet liste`.";
          else {
            const open = options.find((option) => option.name === "ouvert")?.value;
            const saved = await setCommunityTeamRecruitment(
              loaded.userId,
              loaded.communityId,
              found.team.id,
              open === true
            );
            content =
              saved === "saved"
                ? open === true
                  ? `✅ **${found.team.name}** recrute : il apparaît en tête de \`/projet liste\`.`
                  : `✅ **${found.team.name}** ne recrute plus.`
                : saved === "full"
                  ? "Ce projet est complet : libère une place avant de recruter."
                  : "Seul le capitaine peut changer le recrutement, et le projet doit exister.";
          }
        }
      } catch (error) {
        logger.warn("discord-projet", "Échec du traitement /projet.", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        content = "Impossible de traiter le projet pour le moment. Réessaie dans un instant.";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: content.slice(0, MAX_CONTENT),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-projet", "Réponse privée /projet non livrée.", { kind: sent.kind });
    },
  };
}
