import { z } from "zod";
import { logger } from "@/lib/logger";
import type { InteractionOutput } from "@/lib/discord-interactions";
import { editSetupResponse } from "@/lib/discord-rest";
import { loadCommunityProfile, type CommunityProfileView } from "@/lib/discord-community-profile";
import { renderBoosterAdvantages } from "@/lib/boost-perks";
import { readBoosterStatus } from "@/lib/discord-boost";

/**
 * Commandes Discord de découverte et d'identité, en LECTURE SEULE :
 * - `/aide` : quelles commandes existent, et lesquelles sont réellement
 *   activées (lues sur les mêmes variables que les handlers, jamais recopiées) ;
 * - `/profil` : étage, niveau, rang, XP, badges, jeux et équipes du membre,
 *   tels que GameNight les affiche déjà (aucune donnée privée : ni identifiant
 *   Discord, ni e-mail, ni jeton).
 *
 * Aucune de ces deux commandes n'écrit dans Discord ni en base, ne crée de
 * rôle ni de salon et ne peut accorder de permission administrative.
 * Noms enregistrables : `aide`, `profil` (voir scripts/discord-commands.json).
 */
const EPHEMERAL = 64;
const REPLY_BUDGET_MS = 10_000;
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
    name: z.enum(["aide", "profil", "boost"]),
    options: z.array(z.object({ name: z.string(), type: z.number().optional() })).max(5).optional(),
  }),
});

const quiet = (content: string): InteractionOutput => ({
  status: 200,
  body: { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } },
});

/** État lu sur les variables réellement utilisées par les handlers. */
export function commandStates(env: NodeJS.ProcessEnv = process.env) {
  return {
    role: env.DISCORD_ROLE_COMMAND_ENABLED === "true",
    tower: env.TOWER_CHALLENGES_ENABLED === "true",
    setup: env.COMMUNITY_SETUP_COMMAND_ENABLED === "true",
    profile: env.DISCORD_PROFILE_COMMAND_ENABLED === "true",
    boost: env.DISCORD_BOOSTER_ENABLED === "true",
    teams: env.DISCORD_TEAM_COMMAND_ENABLED === "true",
    sessions: env.DISCORD_SESSION_COMMAND_ENABLED === "true",
    tournaments: env.DISCORD_TOURNAMENT_COMMAND_ENABLED === "true",
    players: env.DISCORD_PLAYER_COMMAND_ENABLED === "true",
    projects: env.DISCORD_PROJECT_COMMAND_ENABLED === "true",
  };
}

const state = (enabled: boolean) => (enabled ? "actif" : "en attente d’activation");

/** Contenu de `/aide` — pur, donc testable sans interaction. */
export function buildHelpContent(env: NodeJS.ProcessEnv = process.env): string {
  const flags = commandStates(env);
  return [
    "🎮 **GameNight — commandes disponibles**",
    "**Pour toi**",
    `• \`/aide\` — cette liste.`,
    `• \`/profil\` — ton étage, ton niveau, tes badges et tes équipes (${state(flags.profile)}).`,
    `• \`/role\` — chercher, obtenir ou retirer un rôle de jeu, sans passer par un modérateur (${state(flags.role)}).`,
    `• \`/boost\` — tes avantages Booster Discord (${state(flags.boost)}).`,
    `• \`/tower\` — \`defi\`, \`progression\`, \`classement\`, \`vote\`, \`equipe\` (${state(flags.tower)}).`,
    "**Réservé à la modération**",
    `• \`/gamenight setup\` — activer GameNight sur le serveur (${state(flags.setup)}).`,
    "• \`/tower-admin\` — catalogue des défis The Tower.",
    `• \`/equipe\` — \`liste\`, \`moi\`, \`voir\`, \`creer\`, \`rejoindre\`, \`quitter\`, \`recrutement\`, \`capitaine\`, \`membres\`, \`transferer\`, \`exclure\`, \`invitations\`, \`espace\` (${state(flags.teams)}).`,
    `• \`/projet\` — projets multigaming sur les mêmes équipes : \`liste\`, \`voir\`, \`creer\`, \`rejoindre\`, \`quitter\`, \`recrutement\` (${state(flags.projects)}).`,
    `• \`/soiree\` — soirées : \`liste\`, \`voir\`, \`creer\`, \`rejoindre\`, \`quitter\` (${state(flags.sessions)}).`,
    `• \`/tournoi\` — tournois : \`liste\`, \`voir\`, \`inscription\`, \`desinscription\`, \`mes-inscriptions\` (${state(flags.tournaments)}).`,
    `• \`/joueurs\` — recherche de partenaires : \`chercher\`, \`annonces\`, \`mes-annonces\`, \`publier\`, \`retirer\` (${state(flags.players)}).`,
    "Une commande marquée « fermé » ne lit ni n’écrit rien : elle explique où agir sur GameNight. Aucune de ces commandes n’est simulée.",
    "Aucune commande ne donne de permission administrative : les rôles créés par GameNight sont toujours sans permission Discord.",
  ].join("\n");
}

function formatNumber(value: number | string): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric.toLocaleString("fr-FR") : String(value);
}

/** Contenu de `/profil` — pur, testable sur une vue factice. */
export function renderProfile(profile: CommunityProfileView): string {
  const lines = [
    `🏰 **${profile.displayName}** · ${profile.communityName}`,
    `Étage **${profile.floor}** · Niveau ${profile.level} (${profile.levelTitle}) · Rang ${profile.rankName}`,
    `XP communauté : ${formatNumber(profile.xpTotal)} · encore ${formatNumber(profile.xpToNextFloor)} avant l’étage ${profile.floor + 1}`,
  ];
  if (profile.floorsWon !== null) {
    lines.push(`Étages gagnés par les défis : ${formatNumber(profile.floorsWon)}`);
  }
  lines.push(`Badges : ${profile.badges} · Jeux dans ta bibliothèque : ${profile.games}`);
  if (profile.teams.length === 0) {
    lines.push("Équipes : aucune pour le moment.");
  } else {
    lines.push(
      "Équipes : " +
        profile.teams
          .map((team) => `**${team.name}** (${team.game})${team.captain ? " · capitaine" : ""} · ${team.members}/${team.maxMembers}`)
          .join(" · ")
    );
  }
  return lines.join("\n");
}

/** Exclusivement appelé après la vérification Ed25519 du corps brut. */
export function handleSignedCommunityInteraction(body: unknown, timestamp: string | null): InteractionOutput {
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
  // Ces commandes ne s'utilisent que dans un serveur : rien de communautaire en MP.
  if (!interaction.guild_id) return quiet("Utilise cette commande dans le serveur de la communauté.");

  if (interaction.data.name === "aide") return quiet(buildHelpContent());

  if (interaction.data.name === "boost") {
    if (process.env.DISCORD_BOOSTER_ENABLED !== "true") {
      return quiet(renderBoosterAdvantages({ active: false, since: null, enabled: false }));
    }
    const boostDiscordId = interaction.member?.user?.id ?? interaction.user?.id;
    if (!boostDiscordId) return { status: 400 };
    const boostGuildId = interaction.guild_id;
    return {
      status: 200,
      body: { type: 5, data: { flags: EPHEMERAL } },
      runCommunity: async () => {
        let content: string;
        try {
          const boost = await readBoosterStatus({ guildId: boostGuildId, discordId: boostDiscordId });
          content =
            boost.status === "UNAVAILABLE"
              ? "Impossible de vérifier ton statut Booster pour le moment. Réessaie dans un instant."
              : renderBoosterAdvantages({
                  enabled: true,
                  active: boost.status === "ACTIVE",
                  since: boost.status === "ACTIVE" ? boost.since : null,
                });
        } catch (error) {
          logger.warn("discord-community", "Échec de la lecture du statut Booster.", {
            errorType: error instanceof Error ? error.name : "unknown",
          });
          content = "Impossible de vérifier ton statut Booster pour le moment. Réessaie dans un instant.";
        }
        const sent = await editSetupResponse({
          applicationId: interaction.application_id,
          token: interaction.token,
          content: content.slice(0, 1900),
          deadline: new Date(Date.now() + REPLY_BUDGET_MS),
        });
        if (!sent.ok) logger.error("discord-community", "Réponse privée Boost non livrée.", { kind: sent.kind });
      },
    };
  }

  if (process.env.DISCORD_PROFILE_COMMAND_ENABLED !== "true") {
    return quiet("La commande /profil n’est pas encore ouverte sur ce serveur.");
  }
  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return { status: 400 };
  const guildId = interaction.guild_id;

  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runCommunity: async () => {
      let content: string;
      try {
        const result = await loadCommunityProfile({ guildId, discordId });
        content =
          result.status === "PROFILE"
            ? renderProfile(result.profile)
            : result.status === "NOT_MEMBER"
              ? "Ton compte n’est pas encore membre de cette communauté GameNight. Connecte-toi une première fois sur le site de la communauté, puis réessaie."
              : "Cette demande est invalide. Réessaie depuis le serveur de la communauté.";
      } catch (error) {
        logger.warn("discord-community", "Échec du chargement du profil.", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        content = "Impossible de lire ton profil pour le moment. Réessaie dans un instant.";
      }
      const sent = await editSetupResponse({
        applicationId: interaction.application_id,
        token: interaction.token,
        content: content.slice(0, 1900),
        deadline: new Date(Date.now() + REPLY_BUDGET_MS),
      });
      if (!sent.ok) logger.error("discord-community", "Réponse privée non livrée.", { kind: sent.kind });
    },
  };
}
