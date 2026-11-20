import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Connexions Discord → identifiants de plateformes (sujet J).
 *
 * Le scope OAuth `connections` n'est demandé que si `DISCORD_CONNECTIONS_SCOPE_ENABLED=true`
 * (exactement `true`) ET après un consentement explicite, optionnel, donné depuis les paramètres du
 * profil : la connexion ordinaire reste `identify email guilds`. Les valeurs lues ne deviennent que
 * des SUGGESTIONS : elles ne sont jamais écrites dans les identifiants du profil sans accord, et le
 * jeton OAuth n'est ni journalisé ni conservé (il sert une seule lecture, pendant la connexion).
 */
export const CONNECTIONS_SCOPE = "connections";
export const DISCORD_CONNECTIONS_SCOPES = "identify email guilds connections";

export function isDiscordConnectionsScopeEnabled(): boolean {
  return process.env.DISCORD_CONNECTIONS_SCOPE_ENABLED === "true";
}

/** Plateformes Discord prises en charge → champ de profil (L3-01) ; `steam` n'a pas de champ déclaratif. */
export const CONNECTION_TARGETS = {
  xbox: "xboxGamertag",
  playstation: "psnId",
  epicgames: "epicDisplayName",
  battlenet: "battleTag",
  riotgames: "riotId",
  steam: null,
} as const;

export type ConnectionPlatform = keyof typeof CONNECTION_TARGETS;
export type ConnectionTargetField = Exclude<(typeof CONNECTION_TARGETS)[ConnectionPlatform], null>;

export const CONNECTION_LABELS: Record<ConnectionPlatform, string> = {
  xbox: "Xbox",
  playstation: "PlayStation",
  epicgames: "Epic Games",
  battlenet: "Battle.net",
  riotgames: "Riot Games",
  steam: "Steam",
};

export function isConnectionPlatform(value: string): value is ConnectionPlatform {
  return Object.prototype.hasOwnProperty.call(CONNECTION_TARGETS, value);
}

export function scopeIncludesConnections(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/\s+/).includes(CONNECTIONS_SCOPE);
}

const connectionSchema = z.object({
  type: z.string(),
  id: z.string().max(200),
  name: z.string().max(200),
});

export interface ConnectionSuggestion {
  platform: ConnectionPlatform;
  value: string;
}

/** Une ligne d'identifiant sur une seule ligne, 100 caractères maximum (mêmes règles que L3-01). */
function cleanValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) return null;
  return [...trimmed].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) ? trimmed : null;
}

/**
 * Transforme la réponse de `GET /users/@me/connections` en suggestions, une par plateforme prise en
 * charge (la première connexion valide gagne). Pour Steam, la valeur proposée est l'identifiant
 * public ; elle ne lie rien : la liaison Steam garde son parcours OpenID.
 */
export function mapConnectionsToSuggestions(connections: unknown): ConnectionSuggestion[] {
  const parsed = z.array(z.unknown()).safeParse(connections);
  if (!parsed.success) return [];
  const result = new Map<ConnectionPlatform, string>();
  for (const raw of parsed.data) {
    const item = connectionSchema.safeParse(raw);
    if (!item.success || !isConnectionPlatform(item.data.type) || result.has(item.data.type)) continue;
    const value = cleanValue(item.data.type === "steam" ? item.data.id : item.data.name);
    if (value) result.set(item.data.type, value);
  }
  return [...result].map(([platform, value]) => ({ platform, value }));
}

export type FetchConnectionsResult = { ok: true; suggestions: ConnectionSuggestion[] } | { ok: false };

/** Lecture unique, bornée en temps ; le jeton est utilisé tel quel et jamais journalisé. */
export async function fetchDiscordConnections(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<FetchConnectionsResult> {
  let response: Response;
  try {
    response = await fetchImpl("https://discord.com/api/v10/users/@me/connections", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false };
  }
  return { ok: true, suggestions: mapConnectionsToSuggestions(body) };
}

/** Remplace les suggestions du membre par la lecture la plus récente (aucune écriture dans User). */
export async function storeConnectionSuggestions(userId: string, suggestions: ConnectionSuggestion[]): Promise<void> {
  await prisma.$transaction([
    prisma.platformConnectionSuggestion.deleteMany({ where: { userId } }),
    ...(suggestions.length
      ? [prisma.platformConnectionSuggestion.createMany({ data: suggestions.map((s) => ({ userId, platform: s.platform, value: s.value })) })]
      : []),
  ]);
}

/**
 * Valeur à préremplir pour un champ du profil : l'identifiant déjà saisi prime TOUJOURS ; la
 * suggestion n'est proposée que si le champ est vide (le membre l'enregistre ou la corrige).
 */
export function prefillIdentifier(current: string | null | undefined, suggestion: string | null | undefined): { value: string; suggested: boolean } {
  if (current && current.length > 0) return { value: current, suggested: false };
  if (suggestion) return { value: suggestion, suggested: true };
  return { value: "", suggested: false };
}

/**
 * Appelée par `signIn` APRÈS toutes les gardes d'admission (connexion fermée S0 inchangée) et
 * seulement si le flag est actif ET que le scope `connections` a réellement été accordé. Ne lève
 * jamais et ne bloque jamais la connexion ; ne journalise ni jeton ni corps de réponse.
 */
export async function importConnectionSuggestionsAtLogin(input: {
  discordId: string;
  accessToken: string | null | undefined;
  scope: string | null | undefined;
}): Promise<"skipped" | "stored" | "unavailable"> {
  if (!isDiscordConnectionsScopeEnabled() || !scopeIncludesConnections(input.scope) || !input.accessToken) return "skipped";
  const fetched = await fetchDiscordConnections(input.accessToken);
  if (!fetched.ok) {
    logger.warn("auth", "Discord connections unavailable; suggestions unchanged.");
    return "unavailable";
  }
  try {
    const user = await prisma.user.findUnique({ where: { discordId: input.discordId }, select: { id: true } });
    if (!user) return "unavailable";
    await storeConnectionSuggestions(user.id, fetched.suggestions);
    return "stored";
  } catch {
    logger.warn("auth", "Discord connection suggestions could not be stored.");
    return "unavailable";
  }
}
