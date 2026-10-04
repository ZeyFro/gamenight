import { handleDiscordWebhookEvent } from "@/lib/discord-webhook-events";

/**
 * Webhook d'événements Discord (URL à renseigner dans le portail développeur,
 * « Webhooks » → événement `APPLICATION_AUTHORIZED`). Publique : authentifiée
 * uniquement par la signature Ed25519 (voir `discord-webhook-events.ts`). Le
 * corps est lu BRUT : la signature porte sur les octets exacts reçus.
 */
export async function POST(request: Request) {
  const { status } = await handleDiscordWebhookEvent({
    rawBody: await request.text(),
    signature: request.headers.get("x-signature-ed25519"),
    timestamp: request.headers.get("x-signature-timestamp"),
  });
  return new Response(null, { status });
}
