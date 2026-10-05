import { z } from "zod";
import { logger } from "@/lib/logger";
import { verifyDiscordSignature } from "@/lib/discord-signature";
import { setupCommunityFromGuild } from "@/lib/community-setup";

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
  guild_id: z.string().optional(),
  member: z
    .object({
      permissions: z.string().optional(),
      user: z.object({ id: z.string().optional() }).optional(),
    })
    .optional(),
  data: z
    .object({
      name: z.string().optional(),
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
  // Seules les commandes d'application sont gérées (pas de composants ni de modales).
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

  try {
    const result = await setupCommunityFromGuild(guildId, invokerId);
    logger.info("discord-interactions", `/gamenight setup traité (${result.action}).`, {
      communityId: result.communityId,
    });
    if (result.action === "activated") {
      return reply("✅ Ce serveur est activé : les membres peuvent maintenant se connecter à GameNight.");
    }
    if (result.action === "already_active") return reply("Ce serveur est déjà activé.");
    return reply("Ce serveur ne peut pas être activé (suspendu ou archivé). Contacte un admin GameNight.");
  } catch (error) {
    logger.error("discord-interactions", error, { guildId });
    return reply("Une erreur est survenue, réessaie dans un instant.");
  }
}
