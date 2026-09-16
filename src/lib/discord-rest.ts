import { z } from "zod";
import { logger } from "@/lib/logger";

/**
 * Client Discord REST (bot) — fondations pour les futurs salons/fils/MP
 * (chantier notifications, PR suivante de #95). AUCUN appelant existant
 * n'utilise ce module : `src/lib/discord.ts` (webhook) reste totalement
 * inchangé et actif. Aucune Gateway, aucune commande slash, aucune
 * interaction — uniquement des appels REST sortants (envoi/édition de
 * message, création de fil, ouverture de MP), tous compatibles avec
 * l'exécution serverless Vercel actuelle.
 *
 * Contrat avec les fondations de livraison (`src/lib/notification-delivery.ts`,
 * PR #95) — volontairement PAS d'import direct dans ce sens, pour garder
 * ce module indépendant de la persistance : chaque fonction qui fait un
 * appel réseau prend un paramètre `deadline` (Date) obligatoire. C'est à
 * l'APPELANT (le futur exécuteur) de le dériver de `reservedUntil` — voir
 * `hasSufficientLeaseRemaining`/`MIN_CALL_MARGIN_MS` dans
 * notification-delivery.ts — jamais à ce module de connaître la moindre
 * notion de réservation. Avant tout appel réseau, le budget restant
 * (`deadline - now`) est vérifié ; si insuffisant, AUCUN `fetch` n'est
 * tenté et `insufficient_lease` est renvoyé immédiatement. Sinon, le
 * timeout HTTP (`AbortSignal.timeout`) est borné au budget restant (avec
 * un plafond absolu raisonnable), JAMAIS au-delà — jamais de valeur fixe
 * indépendante du bail.
 *
 * Pas de retry ni d'attente longue caché dans ce module : chaque appel
 * renvoie un résultat typé classifiant précisément l'échec
 * (`DiscordRestErrorKind`) et si l'appelant DEVRAIT retenter
 * (`retryable`) — c'est au mécanisme de livraison (futur exécuteur) de
 * décider quand/si retenter, jamais à ce client de boucler ou d'attendre
 * lui-même.
 *
 * Jamais de succès sans réponse exploitable : un statut HTTP 2xx dont le
 * corps ne peut pas être lu/parsé dans la forme attendue n'est PAS traité
 * comme un succès — Discord a peut-être accepté la requête, mais sans
 * identifiant exploitable (id de message, de fil...) ce module ne peut
 * pas le garantir, et renvoie `network_uncertain` plutôt que de mentir.
 * Aucune garantie "exactement une fois" : une réponse réseau perdue après
 * acceptation par Discord reste un risque résiduel (voir la même limite
 * documentée dans notification-delivery.ts) — ce module ne prétend jamais
 * le contraire.
 */

const API_BASE = "https://discord.com/api/v10";

// Plafond dur : un appel Discord ne devrait jamais légitimement approcher
// cette durée (simple requête REST) — protège contre un `deadline`
// aberrant (bug appelant) qui donnerait un timeout démesuré.
const MAX_REQUEST_TIMEOUT_MS = 10_000;

// En dessous de ce budget restant, tenter l'appel n'a plus de sens (délai
// réseau minimal + traitement Discord) — on renvoie `insufficient_lease`
// sans jamais composer de requête.
const MIN_REQUEST_BUDGET_MS = 1_000;

export type DiscordRestErrorKind =
  | "not_configured"
  | "insufficient_lease"
  | "invalid_request"
  | "auth_or_permission"
  | "dm_unavailable"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "network_uncertain";

export interface DiscordRestFailure {
  ok: false;
  kind: DiscordRestErrorKind;
  httpStatus?: number;
  discordCode?: number;
  /** Jamais de token ni d'en-tête brut — sûr à logger/afficher tel quel. */
  message: string;
  /** `true` = l'appelant PEUT retenter plus tard ; `false` = inutile de
   * retenter tel quel (config, permission, ressource absente...). */
  retryable: boolean;
  /** Uniquement pour `rate_limited` — millisecondes avant nouvelle tentative. */
  retryAfterMs?: number;
}

export interface DiscordRestSuccess<T> {
  ok: true;
  data: T;
}

export type DiscordRestResult<T> = DiscordRestSuccess<T> | DiscordRestFailure;

export interface DiscordRestEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
}

/**
 * Contrôle explicite des mentions — OBLIGATOIRE sur tout appel envoyant du
 * contenu, jamais de valeur implicite côté client (évite un ping
 * involontaire par oubli). `NO_MENTIONS` supprime tout ping ; un appelant
 * qui veut mentionner un rôle/utilisateur précis doit le lister
 * explicitement.
 */
export interface AllowedMentions {
  parse?: Array<"roles" | "users" | "everyone">;
  roles?: string[];
  users?: string[];
  repliedUser?: boolean;
}

export const NO_MENTIONS: AllowedMentions = { parse: [] };

function toDiscordAllowedMentions(input: AllowedMentions) {
  return {
    parse: input.parse ?? [],
    roles: input.roles,
    users: input.users,
    replied_user: input.repliedUser,
  };
}

export interface SentMessage {
  messageId: string;
  channelId: string;
}

export interface ThreadInfo {
  threadId: string;
  parentId: string | null;
  archived: boolean;
}

export interface DmChannel {
  channelId: string;
}

const messageResponseSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
});

const threadResponseSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable().optional(),
  thread_metadata: z.object({ archived: z.boolean().optional() }).partial().optional(),
});

const channelResponseSchema = z.object({
  id: z.string(),
});

function getBotToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN || null;
}

function remainingBudgetMs(deadline: Date, now: Date): number {
  return deadline.getTime() - now.getTime();
}

async function safeReadJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractDiscordCode(body: unknown): number | undefined {
  if (typeof body === "object" && body !== null && "code" in body) {
    const code = (body as Record<string, unknown>).code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

function extractDiscordMessage(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

function describeNetworkError(error: unknown): string {
  if (error instanceof DOMException) {
    return `Erreur réseau (${error.name}) avant réponse de Discord.`;
  }
  if (error instanceof Error) {
    return `Erreur réseau (${error.name}) avant réponse de Discord.`;
  }
  return "Erreur réseau inconnue avant réponse de Discord.";
}

// Codes d'erreur Discord confirmés pour un envoi de MP refusé — la
// documentation Discord elle-même précise que ce code recouvre PLUSIEURS
// causes distinctes (utilisateur ayant bloqué le bot, MP fermés,
// utilisateur ayant quitté le serveur) sans les distinguer dans la
// réponse — voir classifyForbidden ci-dessous, jamais de fausse certitude
// sur la cause exacte.
const DM_BLOCKED_CODES = new Set([50007]);

function classifyForbiddenOrUnauthorized(
  status: number,
  body: unknown,
  isDirectMessage: boolean | undefined
): DiscordRestFailure {
  const code = extractDiscordCode(body);
  if (isDirectMessage && code !== undefined && DM_BLOCKED_CODES.has(code)) {
    return {
      ok: false,
      kind: "dm_unavailable",
      httpStatus: status,
      discordCode: code,
      message:
        "Envoi de MP refusé par Discord — cause non déterminable (bloqué, MP fermés, ou a quitté le serveur : Discord renvoie le même code dans les trois cas, voir docs.discord.com/developers/reference).",
      retryable: false,
    };
  }
  return {
    ok: false,
    kind: "auth_or_permission",
    httpStatus: status,
    discordCode: code,
    message: extractDiscordMessage(body) ?? `Discord a répondu ${status} (authentification ou permission).`,
    retryable: false,
  };
}

function classifyRateLimit(res: Response, body: unknown): DiscordRestFailure {
  const bodyRetryAfterSec =
    typeof body === "object" && body !== null && "retry_after" in body
      ? Number((body as Record<string, unknown>).retry_after)
      : undefined;
  const headerRetryAfterSec = res.headers.get("Retry-After");
  const retryAfterSec =
    bodyRetryAfterSec !== undefined && Number.isFinite(bodyRetryAfterSec)
      ? bodyRetryAfterSec
      : headerRetryAfterSec !== null && Number.isFinite(Number(headerRetryAfterSec))
        ? Number(headerRetryAfterSec)
        : undefined;
  return {
    ok: false,
    kind: "rate_limited",
    httpStatus: 429,
    message: "Limite de débit Discord atteinte.",
    retryable: true,
    retryAfterMs: retryAfterSec !== undefined ? Math.round(retryAfterSec * 1000) : undefined,
  };
}

interface RequestOptions<T> {
  method: string;
  path: string;
  body?: unknown;
  deadline: Date;
  now?: Date;
  isDirectMessage?: boolean;
  parse: (json: unknown) => T | null;
}

/**
 * Cœur du client — TOUTE requête Discord passe par ici. Jamais de retry
 * interne, jamais d'attente au-delà du budget de bail. Voir le
 * commentaire en tête de fichier pour le contrat complet.
 */
async function discordRequest<T>(opts: RequestOptions<T>): Promise<DiscordRestResult<T>> {
  const now = opts.now ?? new Date();
  const remaining = remainingBudgetMs(opts.deadline, now);
  if (remaining < MIN_REQUEST_BUDGET_MS) {
    return {
      ok: false,
      kind: "insufficient_lease",
      message: "Budget de bail restant insuffisant — appel Discord non tenté.",
      retryable: true,
    };
  }

  const token = getBotToken();
  if (!token) {
    logger.warn("discord-rest", "DISCORD_BOT_TOKEN non configurée — appel non tenté.");
    return {
      ok: false,
      kind: "not_configured",
      message: "DISCORD_BOT_TOKEN non configurée.",
      retryable: false,
    };
  }

  const timeoutMs = Math.min(remaining, MAX_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${opts.path}`, {
      method: opts.method,
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return {
      ok: false,
      kind: "network_uncertain",
      message: describeNetworkError(error),
      retryable: true,
    };
  }

  if (res.status === 429) {
    return classifyRateLimit(res, await safeReadJson(res));
  }
  if (res.status >= 500) {
    return {
      ok: false,
      kind: "server_error",
      httpStatus: res.status,
      message: `Discord a répondu ${res.status} (erreur serveur).`,
      retryable: true,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return classifyForbiddenOrUnauthorized(res.status, await safeReadJson(res), opts.isDirectMessage);
  }
  if (res.status === 404) {
    return {
      ok: false,
      kind: "not_found",
      httpStatus: 404,
      message: "Ressource Discord introuvable (salon, message, fil ou utilisateur supprimé ?).",
      retryable: false,
    };
  }
  if (!res.ok) {
    const body = await safeReadJson(res);
    return {
      ok: false,
      kind: "invalid_request",
      httpStatus: res.status,
      discordCode: extractDiscordCode(body),
      message: extractDiscordMessage(body) ?? `Discord a répondu ${res.status} (requête invalide).`,
      retryable: false,
    };
  }

  const body = await safeReadJson(res);
  if (body === undefined) {
    return {
      ok: false,
      kind: "network_uncertain",
      message:
        "Discord a répondu avec un statut succès mais un corps illisible — impossible de confirmer un résultat exploitable.",
      retryable: true,
    };
  }
  const parsed = opts.parse(body);
  if (parsed === null) {
    return {
      ok: false,
      kind: "network_uncertain",
      message: "Réponse Discord dans un format inattendu — résultat non exploitable.",
      retryable: true,
    };
  }
  return { ok: true, data: parsed };
}

function parseMessage(json: unknown): SentMessage | null {
  const result = messageResponseSchema.safeParse(json);
  if (!result.success) return null;
  return { messageId: result.data.id, channelId: result.data.channel_id };
}

function parseThread(json: unknown): ThreadInfo | null {
  const result = threadResponseSchema.safeParse(json);
  if (!result.success) return null;
  return {
    threadId: result.data.id,
    parentId: result.data.parent_id ?? null,
    archived: result.data.thread_metadata?.archived ?? false,
  };
}

function parseChannel(json: unknown): DmChannel | null {
  const result = channelResponseSchema.safeParse(json);
  if (!result.success) return null;
  return { channelId: result.data.id };
}

// Discord limite le nom d'un fil à 100 caractères — tronqué défensivement
// (avec avertissement) plutôt que de dépenser un appel pour un 400
// évitable.
const THREAD_NAME_MAX_LENGTH = 100;

function normalizeThreadName(name: string): string {
  if (name.length <= THREAD_NAME_MAX_LENGTH) return name;
  logger.warn("discord-rest", "Nom de fil tronqué à 100 caractères.", { originalLength: name.length });
  return name.slice(0, THREAD_NAME_MAX_LENGTH);
}

interface MessageContentInput {
  content?: string;
  embeds?: DiscordRestEmbed[];
  allowedMentions: AllowedMentions;
}

function buildMessageBody(input: MessageContentInput) {
  return {
    content: input.content,
    embeds: input.embeds,
    allowed_mentions: toDiscordAllowedMentions(input.allowedMentions),
  };
}

function hasContent(input: MessageContentInput): boolean {
  return Boolean(input.content) || Boolean(input.embeds && input.embeds.length > 0);
}

export interface SendMessageInput extends MessageContentInput {
  channelId: string;
  /** `true` si `channelId` est un canal de MP — affine la classification
   * d'un éventuel refus 403 (voir `classifyForbiddenOrUnauthorized`). */
  isDirectMessage?: boolean;
  deadline: Date;
  now?: Date;
}

/** Envoie un message dans un salon (guilde, fil, ou canal de MP — même
 * endpoint pour les trois, voir `sendThreadMessage`). */
export async function sendChannelMessage(input: SendMessageInput): Promise<DiscordRestResult<SentMessage>> {
  if (!hasContent(input)) {
    return {
      ok: false,
      kind: "invalid_request",
      message: "Aucun contenu ni embed fourni — rien à envoyer.",
      retryable: false,
    };
  }
  return discordRequest({
    method: "POST",
    path: `/channels/${input.channelId}/messages`,
    body: buildMessageBody(input),
    deadline: input.deadline,
    now: input.now,
    isDirectMessage: input.isDirectMessage,
    parse: parseMessage,
  });
}

export interface EditMessageInput extends MessageContentInput {
  channelId: string;
  messageId: string;
  isDirectMessage?: boolean;
  deadline: Date;
  now?: Date;
}

/** Édite un message déjà envoyé — uniquement un message dont l'auteur est
 * ce bot (comportement Discord standard, non contournable côté client). */
export async function editChannelMessage(input: EditMessageInput): Promise<DiscordRestResult<SentMessage>> {
  if (!hasContent(input)) {
    return {
      ok: false,
      kind: "invalid_request",
      message: "Aucun contenu ni embed fourni — rien à éditer.",
      retryable: false,
    };
  }
  return discordRequest({
    method: "PATCH",
    path: `/channels/${input.channelId}/messages/${input.messageId}`,
    body: buildMessageBody(input),
    deadline: input.deadline,
    now: input.now,
    isDirectMessage: input.isDirectMessage,
    parse: parseMessage,
  });
}

export interface StartThreadInput {
  channelId: string;
  messageId: string;
  name: string;
  /** Minutes avant archivage automatique en l'absence d'activité — 1440
   * (24h) par défaut si omis, seules valeurs acceptées par Discord. */
  autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
  deadline: Date;
  now?: Date;
}

/** Crée un fil public à partir d'un message déjà envoyé — le fil et le
 * message source partagent le même id côté Discord. */
export async function startThreadFromMessage(input: StartThreadInput): Promise<DiscordRestResult<ThreadInfo>> {
  return discordRequest({
    method: "POST",
    path: `/channels/${input.channelId}/messages/${input.messageId}/threads`,
    body: {
      name: normalizeThreadName(input.name),
      auto_archive_duration: input.autoArchiveDuration ?? 1440,
    },
    deadline: input.deadline,
    now: input.now,
    parse: parseThread,
  });
}

export interface SendThreadMessageInput extends MessageContentInput {
  threadId: string;
  deadline: Date;
  now?: Date;
}

/** Un fil est un salon côté API Discord — délègue directement à
 * `sendChannelMessage`, jamais de MP possible sur un fil donc pas de
 * paramètre `isDirectMessage` ici. */
export async function sendThreadMessage(input: SendThreadMessageInput): Promise<DiscordRestResult<SentMessage>> {
  return sendChannelMessage({
    channelId: input.threadId,
    content: input.content,
    embeds: input.embeds,
    allowedMentions: input.allowedMentions,
    deadline: input.deadline,
    now: input.now,
  });
}

export interface ArchiveThreadInput {
  threadId: string;
  locked?: boolean;
  deadline: Date;
  now?: Date;
}

/** Archive (et verrouille optionnellement) un fil déjà créé par ce bot —
 * `MANAGE_THREADS` n'est nécessaire que pour archiver un fil créé par
 * quelqu'un d'autre ; un bot qui archive ses propres fils n'en a pas
 * besoin (créateur du fil). */
export async function archiveThread(input: ArchiveThreadInput): Promise<DiscordRestResult<ThreadInfo>> {
  return discordRequest({
    method: "PATCH",
    path: `/channels/${input.threadId}`,
    body: { archived: true, locked: input.locked },
    deadline: input.deadline,
    now: input.now,
    parse: parseThread,
  });
}

export interface OpenDmChannelInput {
  userId: string;
  deadline: Date;
  now?: Date;
}

/** Ouvre (ou récupère, si déjà ouvert) le canal de MP avec un utilisateur.
 * Réussit presque toujours même si l'utilisateur a bloqué le bot ou fermé
 * ses MP — le refus effectif ne se manifeste qu'à l'envoi
 * (`sendChannelMessage` avec `isDirectMessage: true`), jamais ici. */
export async function openDmChannel(input: OpenDmChannelInput): Promise<DiscordRestResult<DmChannel>> {
  return discordRequest({
    method: "POST",
    path: `/users/@me/channels`,
    body: { recipient_id: input.userId },
    deadline: input.deadline,
    now: input.now,
    parse: parseChannel,
  });
}
