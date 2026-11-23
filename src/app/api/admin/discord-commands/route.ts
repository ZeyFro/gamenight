import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { logger } from "@/lib/logger";
import { checkSharedRateLimit } from "@/lib/shared-rate-limit";
import { recordSensitiveOperation } from "@/lib/sensitive-operation-log";
import { isVercelPreview } from "@/lib/preview-safety";
import {
  REGISTRATION_SECRET_HEADER,
  checkRegistrationSecret,
  isCommandRegistrationEnabled,
  parseRegistrationMode,
  registrationHttpStatus,
  runCommandRegistration,
} from "@/lib/discord-command-registration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const respond = (body: object, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * Enregistre (ou vérifie) les commandes Discord de The Tower DEPUIS LE SERVEUR, avec le jeton du bot de l'environnement :
 * le jeton ne sort jamais de Vercel et n'apparaît dans aucune réponse ni journal. Corps : `{ "mode": "check" | "execute" | "bulk" }`.
 * Quatre verrous : interrupteur `DISCORD_COMMAND_REGISTRATION_ENABLED` (éteint = 404, même pour un admin), secret dédié en
 * en-tête `x-registration-secret`, administrateur authentifié, jamais sur une Preview. Un POST avec en-tête personnalisé
 * ne peut pas être déclenché depuis un autre site. Jamais de suppression ni de PUT global (docs/SOIREE_ACTIVATION.md § 9 sexies).
 */
export async function POST(request: Request) {
  if (isVercelPreview() || !isCommandRegistrationEnabled()) return respond({ error: "not_found" }, 404);
  const expectedSecret = process.env.DISCORD_COMMAND_REGISTRATION_SECRET;
  // Fonction non configurée (secret absent) : même réponse que « éteinte », jamais ouverte par défaut.
  if (!expectedSecret?.trim()) return respond({ error: "not_found" }, 404);
  // Même réponse pour « secret faux » et « pas administrateur » : aucun oracle.
  if (!checkRegistrationSecret(expectedSecret, request.headers.get(REGISTRATION_SECRET_HEADER))) {
    return respond({ error: "unauthorized" }, 401);
  }
  const admin = await requireAdmin();
  if (!admin) return respond({ error: "unauthorized" }, 401);
  if (!(await checkSharedRateLimit(admin.id, "discordCommandRegistration", { limit: 5, windowMs: 60_000 }))) {
    return respond({ error: "rate_limited" }, 429);
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const mode = parseRegistrationMode(body);
  if (!mode) return respond({ error: "invalid_mode", expected: ["check", "execute", "bulk"] }, 400);

  const report = await runCommandRegistration(mode);
  // Journal d'audit : qui, quel mode, combien de commandes, quel résultat. Jamais de secret.
  logger.info("discord-command-registration", report.ok ? "terminé" : "échec", {
    mode,
    userId: admin.id,
    ok: report.ok,
    commands: report.commands.length,
    stage: report.failure?.stage ?? null,
    http: report.failure?.http ?? null,
  });
  // Journal des opérations sensibles (cahier §19.1) : seul l'enregistrement écrit dans Discord.
  if (mode === "execute" || mode === "bulk") {
    await recordSensitiveOperation({ actorId: admin.id, action: mode === "bulk" ? "discord.commands_bulk" : "discord.commands_execute", outcome: report.ok ? "ok" : report.failure?.stage ?? "failed" });
  }
  return respond(report, registrationHttpStatus(report));
}
