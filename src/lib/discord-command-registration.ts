import { createHash, timingSafeEqual } from "node:crypto";
// Logique partagée avec le script `scripts/register-tower-guild-commands.mjs` (aucun effet de bord à l'import).
import { prepareManifest, registerCommands } from "../../scripts/discord-command-registration.mjs";
import manifestRaw from "../../scripts/discord-commands.json";

/**
 * Enregistrement des commandes Discord DEPUIS LE SERVEUR : le jeton du bot ne quitte jamais Vercel.
 * Trois verrous cumulés (route `POST /api/admin/discord-commands`) : l'interrupteur
 * `DISCORD_COMMAND_REGISTRATION_ENABLED` (exactement `true`, OFF par défaut), un administrateur authentifié, et un secret
 * dédié en en-tête (`DISCORD_COMMAND_REGISTRATION_SECRET`, jamais `CRON_SECRET`).
 * Jamais de PUT global, jamais de suppression : mêmes appels que le script (un GET, puis un POST d'upsert par commande).
 */
export const REGISTRATION_SECRET_HEADER = "x-registration-secret";
export type RegistrationMode = "check" | "execute";

type Env = Record<string, string | undefined>;

export function isCommandRegistrationEnabled(env: Env = process.env): boolean {
  return env.DISCORD_COMMAND_REGISTRATION_ENABLED === "true";
}

/** Secret absent ou vide côté serveur = refus (fail-closed). Comparaison à temps constant sur des empreintes. */
export function checkRegistrationSecret(expected: string | undefined, provided: string | null): boolean {
  const secret = expected?.trim();
  if (!secret || !provided) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided.trim()), digest(secret));
}

export function parseRegistrationMode(body: unknown): RegistrationMode | null {
  const mode = typeof body === "object" && body !== null ? (body as { mode?: unknown }).mode : undefined;
  return mode === "check" || mode === "execute" ? mode : null;
}

export type CommandReport = { name: string; kind: "chat" | "message"; status: string };
export type RegistrationReport = {
  mode: RegistrationMode;
  ok: boolean;
  commands: CommandReport[];
  outsideManifest: number | null;
  failure: { stage: string; command?: string; http?: number; code?: string; hint?: string; errorName?: string; retryAfterSeconds?: number } | null;
};

/**
 * Exécute `check` (un GET, lecture seule) ou `execute` (saute les commandes déjà à jour, respecte la limite de débit
 * Discord dans un budget de 45 s, compatible avec `maxDuration` 60 de la route). Le rapport ne contient que des noms de commandes, des statuts,
 * le statut HTTP et le code numérique Discord : jamais le jeton ni une valeur de l'environnement.
 */
export async function runCommandRegistration(
  mode: RegistrationMode,
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
  timing: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}
): Promise<RegistrationReport> {
  const commands = prepareManifest(manifestRaw as object[]);
  const result = await registerCommands({ mode, commands, env, fetchImpl, ...timing });
  const failure = result.failure;
  return {
    mode,
    ok: result.ok,
    commands: result.statuses.map((entry: { name: string; type: number; status: string }) => ({
      name: entry.name,
      kind: entry.type === 3 ? "message" : "chat",
      status: entry.status,
    })),
    outsideManifest: result.outsideManifest,
    failure: failure
      ? {
          stage: failure.stage,
          ...(failure.command !== undefined ? { command: failure.command } : {}),
          ...(failure.http !== undefined ? { http: failure.http } : {}),
          ...(failure.code !== undefined ? { code: failure.code } : {}),
          ...(failure.hint ? { hint: failure.hint } : {}),
          ...(failure.errorName !== undefined ? { errorName: failure.errorName } : {}),
          ...(failure.retryAfterSeconds !== undefined ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
        }
      : null,
  };
}

/**
 * Code HTTP de la réponse de la route selon le résultat. 202 = enregistrement partiel arrêté par la limite de débit
 * Discord (à relancer : les commandes déjà à jour sont sautées), distinct du 429 de la limite propre à la route.
 */
export function registrationHttpStatus(report: RegistrationReport): number {
  if (report.ok) return 200;
  if (report.failure?.stage === "rate_limit") return 202;
  return report.failure?.stage === "config" ? 503 : 502;
}
