import { handleDiscordInteraction } from "@/lib/discord-interactions";
import { after } from "next/server";

export const maxDuration = 120;

/**
 * Endpoint d'interactions Discord (URL à renseigner dans le portail développeur,
 * « Interactions Endpoint URL »). Publique : authentifiée uniquement par la
 * signature Ed25519 (voir `discord-interactions.ts`). Le corps est lu BRUT : la
 * signature porte sur les octets exacts reçus.
 */
export async function POST(request: Request) {
  const { status, body, runSetup } = await handleDiscordInteraction({
    rawBody: await request.text(),
    signature: request.headers.get("x-signature-ed25519"),
    timestamp: request.headers.get("x-signature-timestamp"),
  });
  if (runSetup) after(runSetup);
  return body === undefined ? new Response(null, { status }) : Response.json(body, { status });
}
