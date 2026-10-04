import { z } from "zod";
import { logger } from "@/lib/logger";
import { verifyDiscordSignature } from "@/lib/discord-signature";
import { provisionCommunityFromGuild } from "@/lib/community-provisioning";

/**
 * Multi-communautés, PR2 — événements webhook Discord
 * (`POST /api/discord/webhook-events`). Route PUBLIQUE : seule la signature
 * Ed25519 l'authentifie (fail-closed : clé absente = 503, signature invalide =
 * 401, avant tout parsing). `APPLICATION_AUTHORIZED` pour une installation
 * serveur avec le scope `bot` crée une communauté PENDING ; éteint par défaut
 * (`COMMUNITY_AUTO_CREATE_ENABLED` exactement `true`). Discord attend un 204
 * en moins de 3 s ; un 5xx déclenche ses nouvelles tentatives.
 */

const GUILD_NAME_MAX = 100;

const envelopeSchema = z.object({
  type: z.number(),
  event: z.object({ type: z.string(), data: z.unknown().optional() }).optional(),
});

const authorizedDataSchema = z.object({
  integration_type: z.number().optional(),
  scopes: z.array(z.string()).optional(),
  user: z.object({ id: z.string().optional() }).optional(),
  guild: z
    .object({ id: z.string(), name: z.string(), icon: z.string().nullable().optional() })
    .optional(),
});

export interface WebhookEventInput {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
}

export async function handleDiscordWebhookEvent(input: WebhookEventInput): Promise<{ status: number }> {
  const publicKeyHex = process.env.DISCORD_APP_PUBLIC_KEY?.trim();
  if (!publicKeyHex) {
    logger.error("discord-webhook", "DISCORD_APP_PUBLIC_KEY non configurée — route désactivée.");
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
    logger.warn("discord-webhook", "Signature invalide — 401.");
    return { status: 401 };
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400 };
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) return { status: 400 };

  // type 0 = PING (vérification de l'URL par Discord), type 1 = événement.
  if (envelope.data.type !== 1 || envelope.data.event?.type !== "APPLICATION_AUTHORIZED") {
    return { status: 204 };
  }
  if (process.env.COMMUNITY_AUTO_CREATE_ENABLED !== "true") {
    logger.info("discord-webhook", "APPLICATION_AUTHORIZED reçu, création automatique désactivée.");
    return { status: 204 };
  }

  const data = authorizedDataSchema.safeParse(envelope.data.event.data);
  if (!data.success) {
    logger.warn("discord-webhook", "APPLICATION_AUTHORIZED de forme inattendue — ignoré.");
    return { status: 204 };
  }
  const { integration_type, scopes, user, guild } = data.data;
  // Installation serveur (0 ou absent) avec le bot : sinon le bot n'est pas dans le serveur.
  if ((integration_type ?? 0) !== 0 || !guild || !scopes?.includes("bot") || !/^\d+$/.test(guild.id)) {
    return { status: 204 };
  }

  try {
    const result = await provisionCommunityFromGuild(
      { id: guild.id, name: guild.name.slice(0, GUILD_NAME_MAX), icon: guild.icon ?? null },
      user?.id && /^\d+$/.test(user.id) ? user.id : null
    );
    logger.info("discord-webhook", `APPLICATION_AUTHORIZED traité (${result.action}).`, {
      communityId: result.communityId,
    });
    return { status: 204 };
  } catch (error) {
    logger.error("discord-webhook", error, { guildId: guild.id });
    return { status: 500 };
  }
}
