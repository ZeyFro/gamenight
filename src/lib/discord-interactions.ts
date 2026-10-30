import { z } from "zod";
import { logger } from "@/lib/logger";
import { verifyDiscordSignature } from "@/lib/discord-signature";
import { setupCommunityFromGuild } from "@/lib/community-setup";
import { editSetupResponse } from "@/lib/discord-rest";
import { parseSessionRsvpId } from "@/lib/session-rsvp-components";
import { respondToSessionRsvp } from "@/lib/discord-session-rsvp";
import { parseInstantSessionRsvpId } from "@/lib/instant-session-rsvp-components";
import { respondToInstantSessionRsvp } from "@/lib/discord-instant-session-rsvp";
import { parseTournamentRsvpId } from "@/lib/tournament-rsvp-components";
import { respondToTournamentRsvp } from "@/lib/discord-tournament-rsvp";

/**
 * Multi-communautés, PR6 — endpoint d'interactions Discord
 * (`POST /api/discord/interactions`), commande `/gamenight setup`. Route
 * PUBLIQUE : seule la signature Ed25519 l'authentifie (fail-closed : clé
 * absente = 503, signature invalide = 401, avant tout parsing). Le PING de
 * validation de l'URL est toujours acquitté (sinon le portail refuse d'enregistrer
 * l'URL) ; la commande elle-même n'agit que si `COMMUNITY_SETUP_COMMAND_ENABLED`
 * vaut exactement `true`. Discord exige une réponse en moins de 3 s.
 *
 * `default_member_permissions` n'est qu'un réglage d'affichage modifiable par les
 * admins du serveur : la permission `MANAGE_GUILD` (ou `ADMINISTRATOR`) est donc
 * revérifiée ici, sur `member.permissions` du payload signé.
 */

const MANAGE_GUILD = BigInt(0x20);
const ADMINISTRATOR = BigInt(0x8);
const EPHEMERAL = 64;

const interactionSchema = z.object({
  type: z.number(),
  id: z.string().optional(),
  application_id: z.string().optional(),
  token: z.string().optional(),
  guild_id: z.string().optional(),
  channel_id: z.string().optional(),
  user: z.object({ id: z.string() }).optional(),
  message: z.object({ id: z.string() }).optional(),
  member: z
    .object({
      permissions: z.string().optional(),
      user: z.object({ id: z.string().optional() }).optional(),
    })
    .optional(),
  data: z
    .object({
      name: z.string().optional(),
      custom_id: z.string().optional(),
      component_type: z.number().optional(),
      options: z.array(z.object({ name: z.string(), type: z.number().optional() })).optional(),
    })
    .optional(),
});

export interface InteractionInput {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
}

export interface InteractionOutput {
  status: number;
  body?: unknown;
  runSetup?: () => Promise<void>;
  runRsvp?: () => Promise<void>;
  runTower?: () => Promise<void>;
}

const reply = (content: string): InteractionOutput => ({
  status: 200,
  body: { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } },
});

function canManageGuild(permissions: string | undefined): boolean {
  if (!permissions || !/^\d+$/.test(permissions)) return false;
  return (BigInt(permissions) & (MANAGE_GUILD | ADMINISTRATOR)) !== BigInt(0);
}

export async function handleDiscordInteraction(input: InteractionInput): Promise<InteractionOutput> {
  const publicKeyHex = process.env.DISCORD_APP_PUBLIC_KEY?.trim();
  if (!publicKeyHex) {
    logger.error("discord-interactions", "DISCORD_APP_PUBLIC_KEY non configurée — route désactivée.");
    return { status: 503 };
  }
  if (
    !verifyDiscordSignature({
      publicKeyHex,
      signatureHex: input.signature,
      timestamp: input.timestamp,
      rawBody: input.rawBody,
    })
  ) {
    logger.warn("discord-interactions", "Signature invalide — 401.");
    return { status: 401 };
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400 };
  }
  const parsed = interactionSchema.safeParse(json);
  if (!parsed.success) return { status: 400 };
  const interaction = parsed.data;

  if (interaction.type === 1) return { status: 200, body: { type: 1 } };
  if (interaction.type === 2 && interaction.data?.name === "tower-admin") {
    const { handleSignedTowerAdminInteraction } = await import("@/lib/discord-tower-admin");
    return handleSignedTowerAdminInteraction(json, input.timestamp);
  }
  if (interaction.data?.custom_id?.startsWith("gn:tower:") || (interaction.type === 2 && interaction.data?.name === "tower")) {
    const { handleSignedTowerInteraction } = await import("@/lib/discord-tower-challenges");
    return handleSignedTowerInteraction(json, input.timestamp);
  }
  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id ?? "";
    const rsvp = parseSessionRsvpId(customId);
    const instantRsvp = parseInstantSessionRsvpId(customId);
    const tournamentRsvp = parseTournamentRsvpId(customId);
    const resolvedRsvp = rsvp ?? instantRsvp;
    const isInstantRsvp = !rsvp && Boolean(instantRsvp);
    const applicationId = interaction.application_id;
    const token = interaction.token;
    const discordId = interaction.guild_id ? interaction.member?.user?.id : interaction.user?.id;
    const { id, channel_id: channelId } = interaction;
    const messageId = interaction.message?.id;
    // La signature seule n'expire pas : un corps signé ancien n'est jamais rejoué.
    const timestamp = Number(input.timestamp);
    if ((!resolvedRsvp && !tournamentRsvp) || interaction.data?.component_type !== 2 || !applicationId || applicationId !== process.env.DISCORD_CLIENT_ID || !token || !id || !discordId || !channelId || !messageId || ![applicationId, id, discordId, channelId, messageId].every(value => /^\d+$/.test(value)) || (interaction.guild_id !== undefined && !/^\d+$/.test(interaction.guild_id)) || !Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return { status: 400 };
    if ((isInstantRsvp || tournamentRsvp) && !interaction.guild_id) return { status: 400 };
    // Aucun accès SQL/Discord avant l'ACK : réponse privée en < 3 s.
    return { status: 200, body: { type: 5, data: { flags: EPHEMERAL } }, runRsvp: async () => {
      let content: string;
      try {
        const origin = { interactionId: id, discordId, guildId: interaction.guild_id, channelId, messageId };
        content = tournamentRsvp
          ? await respondToTournamentRsvp(tournamentRsvp.tournamentId, origin)
          : isInstantRsvp
            ? await respondToInstantSessionRsvp(resolvedRsvp!.sessionId, resolvedRsvp!.kind, origin)
            : await respondToSessionRsvp(resolvedRsvp!.sessionId, resolvedRsvp!.kind, origin);
      } catch (error) {
        logger.error("discord-rsvp", error, { customId });
        content = "Ta réponse n’a pas pu être confirmée. Vérifie ton inscription dans GameNight, puis réessaie si nécessaire.";
      }
      const sent = await editSetupResponse({ applicationId, token, content, deadline: new Date(Date.now() + 10_000) });
      if (!sent.ok) logger.error("discord-rsvp", "Confirmation Discord non livrée ; consulter GameNight avant de réessayer.", { kind: sent.kind });
    } };
  }
  if (interaction.type !== 2) return { status: 400 };

  if (interaction.data?.name !== "gamenight" || interaction.data.options?.[0]?.name !== "setup") {
    return reply("Commande inconnue.");
  }
  if (process.env.COMMUNITY_SETUP_COMMAND_ENABLED !== "true") {
    return reply("La configuration par commande n'est pas activée pour le moment.");
  }

  const guildId = interaction.guild_id;
  const invokerId = interaction.member?.user?.id;
  if (!guildId || !/^\d+$/.test(guildId) || !invokerId || !/^\d+$/.test(invokerId)) {
    return reply("Cette commande s'utilise dans un serveur.");
  }
  if (!canManageGuild(interaction.member?.permissions)) {
    return reply("Il faut la permission « Gérer le serveur » pour configurer GameNight.");
  }

  const applicationId = interaction.application_id;
  const token = interaction.token;
  if (!applicationId || !/^\d+$/.test(applicationId) || !token) return { status: 400 };
  // ACK within Discord's 3 s window; the route runs this with Next after().
  return {
    status: 200,
    body: { type: 5, data: { flags: EPHEMERAL } },
    runSetup: async () => {
      let content: string;
      try {
        const result = await setupCommunityFromGuild(guildId, invokerId);
        logger.info("discord-interactions", `/gamenight setup traité (${result.action}).`, { communityId: result.communityId });
        if (result.action === "activated") {
          content = "✅ Ce serveur est activé et ses salons sont configurés : les membres peuvent se connecter à GameNight.";
        } else if (result.action === "already_active") {
          content = "✅ Ce serveur est déjà activé ; les noms et la configuration des salons sont à jour.";
        } else if (result.action === "incomplete" || result.action === "in_progress") {
          content = result.message ?? "Installation incomplète. Relance /gamenight setup.";
        } else {
          content = "Ce serveur ne peut pas être activé (suspendu ou archivé). Contacte un admin GameNight.";
        }
      } catch (error) {
        logger.error("discord-interactions", error, { guildId });
        content = "Une erreur est survenue. Les salons déjà créés sont conservés ; relance /gamenight setup.";
      }
      const sent = await editSetupResponse({ applicationId, token, content, deadline: new Date(Date.now() + 10_000) });
      if (!sent.ok) logger.error("discord-interactions", "Réponse de setup non livrée.", { guildId, kind: sent.kind });
    },
  };
}
