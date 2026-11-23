import { handleDiscordInteraction } from "@/lib/discord-interactions";
import { after } from "next/server";

export const maxDuration = 120;

/**
 * Plafond du corps (audit du 23/11/2026, A05) : la route est PUBLIQUE et le corps était lu en entier avant la vérification de la signature.
 * Les interactions Discord restent très en dessous (une commande tient en quelques ko) : au-delà, 413 sans rien lire de plus.
 */
const MAX_INTERACTION_BODY_BYTES = 64 * 1024;

/**
 * Endpoint d'interactions Discord (URL à renseigner dans le portail développeur,
 * « Interactions Endpoint URL »). Publique : authentifiée uniquement par la
 * signature Ed25519 (voir `discord-interactions.ts`). Le corps est lu BRUT : la
 * signature porte sur les octets exacts reçus.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_INTERACTION_BODY_BYTES) return new Response(null, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_INTERACTION_BODY_BYTES) return new Response(null, { status: 413 });
  const { status, body, runSetup, runRsvp, runTower, runTeam, runRole, runCommunity, runSession, runTournament, runPlayers, runReport } = await handleDiscordInteraction({
    rawBody,
    signature: request.headers.get("x-signature-ed25519"),
    timestamp: request.headers.get("x-signature-timestamp"),
  });
  if (runSetup) after(runSetup);
  if (runRsvp) after(runRsvp);
  if (runTower) after(runTower);
  if (runTeam) after(runTeam);
  if (runRole) after(runRole);
  if (runCommunity) after(runCommunity);
  if (runSession) after(runSession);
  if (runTournament) after(runTournament);
  if (runPlayers) after(runPlayers);
  if (runReport) after(runReport);
  return body === undefined ? new Response(null, { status }) : Response.json(body, { status });
}
