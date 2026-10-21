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
 * indépendante du bail. Ce budget couvre explicitement la requête ET la
 * lecture du corps de réponse (pas seulement l'attente des en-têtes) :
 * `discordRequest` englobe les deux dans une course contre une minuterie
 * dérivée du même budget, garantie vraie par construction plutôt que
 * supposée d'un comportement implicite de `AbortSignal`.
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
  | "network_uncertain"
  /** Un salon existe (GET réussi) mais n'appartient pas au serveur
   * configuré, ou son type ne supporte pas le parcours annonce+fil (voir
   * `verifyChannelDestination`) — jamais une réponse HTTP d'erreur de
   * Discord, une conclusion tirée d'une réponse 2xx exploitée. Toujours
   * non-retryable : un problème de configuration, jamais transitoire. */
  | "destination_mismatch";

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

function classifyRateLimit(headers: Headers, body: unknown): DiscordRestFailure {
  const bodyRetryAfterSec =
    typeof body === "object" && body !== null && "retry_after" in body
      ? Number((body as Record<string, unknown>).retry_after)
      : undefined;
  const headerRetryAfterSec = headers.get("Retry-After");
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
  webhook?: boolean;
  interaction?: { applicationId: string; token: string };
  method: string;
  path: string;
  body?: unknown;
  deadline: Date;
  now?: Date;
  isDirectMessage?: boolean;
  /** `true` pour un endpoint dont le SUCCÈS attendu est un `204` sans
   * corps (ex. `PUT`/`DELETE .../thread-members/{id}`) — sans ce drapeau,
   * un corps vide sur un statut 2xx est traité comme `network_uncertain`
   * (voir plus bas) : un succès Discord réellement sans contenu ne doit
   * jamais être confondu avec une réponse illisible. */
  allowEmptyBody?: boolean;
  parse: (json: unknown) => T | null;
}

/** Signale que le budget de bail a expiré avant d'obtenir un résultat
 * exploitable — distingué des erreurs réseau/abort natives pour un
 * message précis (voir `discordRequest`). */
class DeadlineExceededError extends Error {
  constructor() {
    super("Budget de bail épuisé avant réponse exploitable de Discord.");
    this.name = "DeadlineExceededError";
  }
}

interface RawHttpResult {
  status: number;
  headers: Headers;
  body: unknown;
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

  const token = opts.webhook || opts.interaction ? null : getBotToken();
  if (!opts.webhook && !opts.interaction && !token) {
    logger.warn("discord-rest", "DISCORD_BOT_TOKEN non configurée — appel non tenté.");
    return {
      ok: false,
      kind: "not_configured",
      message: "DISCORD_BOT_TOKEN non configurée.",
      retryable: false,
    };
  }

  const timeoutMs = Math.min(remaining, MAX_REQUEST_TIMEOUT_MS);
  // Défense en profondeur : annule effectivement la requête réseau
  // sous-jacente (et, en pratique, tout flux de lecture du corps en
  // cours) quand le délai expire.
  const abortSignal = AbortSignal.timeout(timeoutMs);

  async function fetchAndReadBody(): Promise<RawHttpResult> {
    const url = opts.interaction
      ? `${API_BASE}/webhooks/${opts.interaction.applicationId}/${encodeURIComponent(opts.interaction.token)}/messages/@original`
      : opts.webhook ? process.env.DISCORD_WEBHOOK_URL! : `${API_BASE}${opts.path}`;
    const res = await fetch(url, {
      method: opts.method,
      headers: {
        ...(opts.webhook || opts.interaction ? {} : { Authorization: `Bot ${token}` }),
        "Content-Type": "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: abortSignal,
    });
    const body = await safeReadJson(res);
    return { status: res.status, headers: res.headers, body };
  }

  // Le budget doit couvrir la lecture du corps de réponse, pas seulement
  // l'attente des en-têtes — on ne se repose pas uniquement sur
  // l'hypothèse (conforme aux specs des runtimes actuels, mais non
  // vérifiée ici) qu'un AbortSignal annule aussi un flux de lecture en
  // cours : le fetch ET la lecture du corps sont englobés ENSEMBLE dans
  // la course ci-dessous contre une minuterie dérivée du même budget, ce
  // qui rend la garantie vraie par construction plutôt que supposée.
  const fetchPromise = fetchAndReadBody();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlinePromise = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => reject(new DeadlineExceededError()), timeoutMs);
  });
  // Si la minuterie l'emporte, `fetchPromise` peut encore rejeter plus
  // tard (abort effectif) — évite un rejet de promesse non géré côté
  // process, sans jamais influencer le résultat déjà renvoyé.
  fetchPromise.catch(() => {});

  let raw: RawHttpResult;
  try {
    raw = await Promise.race([fetchPromise, deadlinePromise]);
  } catch (error) {
    if (error instanceof DeadlineExceededError) {
      return {
        ok: false,
        kind: "network_uncertain",
        message: error.message,
        retryable: true,
      };
    }
    return {
      ok: false,
      kind: "network_uncertain",
      message: describeNetworkError(error),
      retryable: true,
    };
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }

  const { status, headers, body } = raw;

  if (status === 429) {
    return classifyRateLimit(headers, body);
  }
  if (status >= 500) {
    return {
      ok: false,
      kind: "server_error",
      httpStatus: status,
      message: `Discord a répondu ${status} (erreur serveur).`,
      retryable: true,
    };
  }
  if (status === 401 || status === 403) {
    return classifyForbiddenOrUnauthorized(status, body, opts.isDirectMessage);
  }
  if (status === 404) {
    return {
      ok: false,
      kind: "not_found",
      httpStatus: 404,
      message: "Ressource Discord introuvable (salon, message, fil ou utilisateur supprimé ?).",
      retryable: false,
    };
  }
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      kind: "invalid_request",
      httpStatus: status,
      discordCode: extractDiscordCode(body),
      message: extractDiscordMessage(body) ?? `Discord a répondu ${status} (requête invalide).`,
      retryable: false,
    };
  }

  if (body === undefined) {
    if (opts.allowEmptyBody) {
      const parsedEmpty = opts.parse(undefined);
      if (parsedEmpty !== null) return { ok: true, data: parsedEmpty };
    }
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

const channelInfoResponseSchema = z.object({
  id: z.string(),
  type: z.number(),
  // Absent pour un canal de MP (pas de guilde) — jamais le cas pour les
  // salons de guilde ciblés par `verifyChannelDestination`, mais le champ
  // reste optionnel côté schéma pour ne pas dépendre d'une garantie de
  // l'API non documentée comme contractuelle.
  guild_id: z.string().optional(),
});

export interface ChannelInfo {
  channelId: string;
  /** Type de salon Discord brut (0 = texte de guilde, 5 = annonces, 2 =
   * vocal, 4 = catégorie, 15 = forum...) — voir `THREAD_CAPABLE_CHANNEL_TYPES`
   * pour les seuls types compatibles avec le parcours annonce+fil de ce
   * chantier. */
  type: number;
  guildId: string | null;
}

function parseChannelInfo(json: unknown): ChannelInfo | null {
  const result = channelInfoResponseSchema.safeParse(json);
  if (!result.success) return null;
  return { channelId: result.data.id, type: result.data.type, guildId: result.data.guild_id ?? null };
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

export interface DiscordActionRow {
  type: 1;
  components: { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; disabled?: boolean }[];
}

interface MessageContentInput {
  content?: string;
  embeds?: DiscordRestEmbed[];
  components?: DiscordActionRow[];
  allowedMentions: AllowedMentions;
}

/** Webhook historique de default, livré par l'outbox avec le même budget et les mêmes reprises que le bot. */
export function isRewardWebhookConfigured(): boolean {
  let valid = false;
  try {
    const url = new URL(process.env.DISCORD_WEBHOOK_URL ?? "");
    valid = url.protocol === "https:" && ["discord.com", "discordapp.com"].includes(url.hostname) &&
      /^\/api\/(?:v\d+\/)?webhooks\/\d+\/[^/]+$/.test(url.pathname) && !url.username && !url.password;
  } catch { /* Configuration absente ou invalide : aucun appel réseau. */ }
  return valid;
}

export async function sendRewardWebhook(input: MessageContentInput & { deadline: Date; now?: Date }): Promise<DiscordRestResult<object>> {
  if (!isRewardWebhookConfigured()) return { ok: false, kind: "not_configured", message: "Webhook Discord absent ou invalide.", retryable: false };
  return discordRequest({ webhook: true, method: "POST", path: "", body: buildMessageBody(input),
    deadline: input.deadline, now: input.now, allowEmptyBody: true, parse: () => ({}),
  });
}

function buildMessageBody(input: MessageContentInput) {
  return {
    content: input.content,
    embeds: input.embeds,
    components: input.components,
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

export interface GetChannelInput {
  channelId: string;
  deadline: Date;
  now?: Date;
}

/** `GET /channels/{id}` — lecture seule, mêmes garanties de budget/timeout
 * que tout autre appel de ce module (voir le commentaire de fichier).
 * Utilisée par `verifyChannelDestination` pour confirmer qu'un salon
 * appartient bien au serveur attendu AVANT tout envoi — jamais un appel
 * "gratuit" hors du budget de la livraison qui l'utilise. */
export async function getChannel(input: GetChannelInput): Promise<DiscordRestResult<ChannelInfo>> {
  return discordRequest({
    method: "GET",
    path: `/channels/${input.channelId}`,
    deadline: input.deadline,
    now: input.now,
    parse: parseChannelInfo,
  });
}

const botGuildsResponseSchema = z.array(
  z.object({ id: z.string(), name: z.string(), icon: z.string().nullable().optional() })
);

export interface BotGuild {
  id: string;
  name: string;
  icon: string | null;
}

const permissionBits = z.string().regex(/^\d+$/);
const setupChannelSchema = z.object({
  id: z.string(), name: z.string(), type: z.number(), guild_id: z.string().optional(),
  parent_id: z.string().nullable().optional(), topic: z.string().nullable().optional(),
  permission_overwrites: z.array(z.object({ id: z.string(), type: z.number(), allow: permissionBits, deny: permissionBits })).default([]),
});
export type SetupChannel = z.infer<typeof setupChannelSchema>;
const setupGuildSchema = z.object({
  id: z.string(), name: z.string().min(1), icon: z.string().nullable(),
  roles: z.array(z.object({ id: z.string(), permissions: permissionBits })),
});

export async function getSetupGuild(input: { guildId: string; deadline: Date }) {
  return discordRequest({ method: "GET", path: `/guilds/${input.guildId}`, deadline: input.deadline,
    parse: (json) => { const r = setupGuildSchema.safeParse(json); return r.success ? r.data : null; } });
}

export async function getSetupBot(input: { guildId: string; deadline: Date }): Promise<DiscordRestResult<{ id: string; roles: string[] }>> {
  const self = await discordRequest({ method: "GET", path: "/users/@me", deadline: input.deadline,
    parse: (json) => { const r = z.object({ id: z.string() }).safeParse(json); return r.success ? r.data : null; } });
  if (!self.ok) return self;
  return discordRequest({ method: "GET", path: `/guilds/${input.guildId}/members/${self.data.id}`, deadline: input.deadline,
    parse: (json) => { const r = z.object({ roles: z.array(z.string()) }).safeParse(json); return r.success ? { id: self.data.id, roles: r.data.roles } : null; } });
}

export async function listSetupChannels(input: { guildId: string; deadline: Date }) {
  return discordRequest({ method: "GET", path: `/guilds/${input.guildId}/channels`, deadline: input.deadline,
    parse: (json) => { const r = z.array(setupChannelSchema).safeParse(json); return r.success ? r.data : null; } });
}

export async function createSetupChannel(input: { guildId: string; channel: Omit<SetupChannel, "id" | "guild_id">; deadline: Date }) {
  return discordRequest({ method: "POST", path: `/guilds/${input.guildId}/channels`, body: input.channel, deadline: input.deadline,
    parse: (json) => { const r = setupChannelSchema.safeParse(json); return r.success && r.data.guild_id === input.guildId ? r.data : null; } });
}

export async function editSetupResponse(input: { applicationId: string; token: string; content: string; deadline: Date }) {
  return discordRequest({ interaction: input, method: "PATCH", path: "", deadline: input.deadline,
    body: { content: input.content, allowed_mentions: { parse: [] } }, parse: parseMessage });
}

export interface ListBotGuildsInput {
  /** Pagination : id du dernier serveur de la page précédente (tri croissant). */
  after?: string;
  deadline: Date;
  now?: Date;
}

/** `GET /users/@me/guilds` — serveurs où le bot est présent, 200 par page. */
export async function listBotGuilds(input: ListBotGuildsInput): Promise<DiscordRestResult<{ guilds: BotGuild[] }>> {
  const query = new URLSearchParams({ limit: "200" });
  if (input.after) query.set("after", input.after);
  return discordRequest({
    method: "GET",
    path: `/users/@me/guilds?${query}`,
    deadline: input.deadline,
    now: input.now,
    parse: (json) => {
      const result = botGuildsResponseSchema.safeParse(json);
      if (!result.success) return null;
      return { guilds: result.data.map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null })) };
    },
  });
}

/** Types de salon Discord acceptant `POST .../messages/{id}/threads`
 * (création de fil public à partir d'un message) — texte de guilde (0) et
 * annonces (5). Voir la doc Discord des types de channel ; tout autre
 * type (vocal, catégorie, forum, DM...) ne supporte pas le parcours
 * annonce+fil de ce chantier. */
export const THREAD_CAPABLE_CHANNEL_TYPES: ReadonlySet<number> = new Set([0, 5]);
export const VOICE_CHANNEL_TYPES: ReadonlySet<number> = new Set([2, 13]);

const guildChannelsResponseSchema = z.array(
  z.object({ id: z.string(), name: z.string(), type: z.number(), position: z.number().optional() })
);

export interface GuildChannel {
  id: string;
  name: string;
  type: number;
}

export interface ListGuildChannelsInput {
  guildId: string;
  deadline: Date;
  now?: Date;
}

/** `GET /guilds/{id}/channels` — lecture seule : salons du serveur compatibles avec le parcours annonce+fil
 * pour annonces et vocal, triés par position. Sert à proposer un choix dans l'écran d'administration. */
export async function listGuildChannels(
  input: ListGuildChannelsInput
): Promise<DiscordRestResult<{ channels: GuildChannel[] }>> {
  return discordRequest({
    method: "GET",
    path: `/guilds/${input.guildId}/channels`,
    deadline: input.deadline,
    now: input.now,
    parse: (json) => {
      const result = guildChannelsResponseSchema.safeParse(json);
      if (!result.success) return null;
      const channels = result.data
        .filter((c) => THREAD_CAPABLE_CHANNEL_TYPES.has(c.type) || VOICE_CHANNEL_TYPES.has(c.type))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((c) => ({ id: c.id, name: c.name, type: c.type }));
      return { channels };
    },
  });
}

/** Type de salon Discord `GUILD_PRIVATE_THREAD` — voir `verifyThreadIsPrivate`. */
export const PRIVATE_THREAD_TYPE = 12;

export interface VerifyChannelDestinationInput {
  channelId: string;
  guildId: string;
  deadline: Date;
  now?: Date;
}

export interface VerifiedChannel {
  channelId: string;
}

/**
 * Vérifie, via un `GET` réel (jamais une simple validation de format
 * d'id), qu'un salon appartient bien au serveur `guildId` configuré ET
 * que son type supporte le parcours annonce+fil — AVANT tout envoi.
 * Trois issues distinctes, toutes observables :
 *   - le `GET` échoue (permission, salon supprimé, réseau incertain,
 *     rate limit...) → renvoie CETTE MÊME `DiscordRestFailure`, avec sa
 *     classification `retryable` déjà correcte (héritée telle quelle de
 *     `discordRequest`, jamais réévaluée ici) ;
 *   - le `GET` réussit mais `guild_id` ne correspond pas → `destination_mismatch`,
 *     non-retryable (le salon existe, mais n'est pas dans le bon
 *     serveur — retenter avec la même configuration ne change rien) ;
 *   - le `GET` réussit mais le type de salon ne supporte pas les fils →
 *     `destination_mismatch`, non-retryable, même raisonnement.
 * Consomme le même budget réseau que n'importe quel autre appel de ce
 * client (un seul `deadline` partagé avec l'appelant, voir
 * `sendChannelMessageVerified` pour la composition avec l'envoi).
 */
export async function verifyChannelDestination(
  input: VerifyChannelDestinationInput
): Promise<DiscordRestResult<VerifiedChannel>> {
  const result = await getChannel({ channelId: input.channelId, deadline: input.deadline, now: input.now });
  if (!result.ok) return result;

  if (result.data.guildId !== input.guildId) {
    return {
      ok: false,
      kind: "destination_mismatch",
      message: "Le salon configuré n'appartient pas au serveur Discord configuré.",
      retryable: false,
    };
  }
  if (!THREAD_CAPABLE_CHANNEL_TYPES.has(result.data.type)) {
    return {
      ok: false,
      kind: "destination_mismatch",
      message: `Type de salon Discord (${result.data.type}) incompatible avec le parcours annonce+fil.`,
      retryable: false,
    };
  }
  return { ok: true, data: { channelId: result.data.channelId } };
}

export async function verifyVoiceChannelDestination(
  input: VerifyChannelDestinationInput
): Promise<DiscordRestResult<VerifiedChannel>> {
  const result = await getChannel({ channelId: input.channelId, deadline: input.deadline, now: input.now });
  if (!result.ok) return result;
  if (result.data.guildId !== input.guildId || !VOICE_CHANNEL_TYPES.has(result.data.type)) {
    return { ok: false, kind: "destination_mismatch", message: "Ce salon vocal n'appartient pas à ce serveur.", retryable: false };
  }
  return { ok: true, data: { channelId: result.data.channelId } };
}

export interface SendChannelMessageVerifiedInput extends MessageContentInput {
  channelId: string;
  guildId: string;
  deadline: Date;
  now?: Date;
}

/**
 * Vérifie la destination (`verifyChannelDestination`) PUIS envoie —
 * JAMAIS de `POST` si la vérification échoue, quelle qu'en soit la
 * raison (mauvais serveur, mauvais type, échec/timeout du `GET` lui-même)
 * : aucun message n'est composé ni tenté tant que le salon n'est pas
 * confirmé. Même `deadline`/`now` partagés entre les deux appels, jamais
 * recalculés entre-temps (même garantie de composition que
 * `sendDirectMessage`, qui partage son budget entre ouverture de MP et
 * envoi).
 *
 * Réservée au TOUT PREMIER envoi d'une annonce (voir
 * `tournament-announce.ts`) — une fois la destination confirmée et le
 * message envoyé, les éditions/messages de fil ultérieurs ciblent
 * directement la référence du message RÉELLEMENT créé (channelId/messageId
 * persistés depuis la réponse Discord de ce premier envoi), sans jamais
 * revérifier : ils ne peuvent physiquement pas dériver vers un autre
 * salon, l'id du message cible appartient définitivement au salon où il a
 * été créé.
 */
export async function sendChannelMessageVerified(
  input: SendChannelMessageVerifiedInput
): Promise<DiscordRestResult<SentMessage>> {
  if (!hasContent(input)) {
    return {
      ok: false,
      kind: "invalid_request",
      message: "Aucun contenu ni embed fourni — rien à envoyer.",
      retryable: false,
    };
  }
  const verified = await verifyChannelDestination({
    channelId: input.channelId,
    guildId: input.guildId,
    deadline: input.deadline,
    now: input.now,
  });
  if (!verified.ok) return verified;

  return sendChannelMessage({
    channelId: verified.data.channelId,
    content: input.content,
    embeds: input.embeds,
    components: input.components,
    allowedMentions: input.allowedMentions,
    deadline: input.deadline,
    now: input.now,
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
    components: input.components,
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

/**
 * Archive (et verrouille optionnellement) un fil.
 *
 * Permissions — archivage simple (`locked` omis ou `false`) : un bot qui
 * a lui-même créé le fil (via `startThreadFromMessage`, seul usage prévu
 * de cette fonction dans ce module) peut l'archiver SANS `MANAGE_THREADS`.
 * Cette permission reste nécessaire pour archiver un fil créé par
 * quelqu'un d'autre.
 *
 * Asymétrie à connaître si `locked: true` est demandé : un fil
 * VERROUILLÉ ne peut être DÉSARCHIVÉ ensuite que par un titulaire de
 * `MANAGE_THREADS` — même si ce bot en est le créateur (règle documentée
 * par Discord, pas une particularité de ce client). Verrouiller un fil
 * créé par ce bot sans qu'il détienne `MANAGE_THREADS` risque donc de le
 * rendre irréversible pour ce bot seul. Ne jamais accorder
 * `Administrateur` pour contourner cette limite ; si le verrouillage est
 * réellement nécessaire, accorder `MANAGE_THREADS` explicitement et de
 * façon ciblée sur les salons concernés, rien de plus large.
 */
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

export interface SendDirectMessageInput extends MessageContentInput {
  userId: string;
  deadline: Date;
  now?: Date;
}

/**
 * Ouvre le canal de MP puis y envoie le message, en partageant EXACTEMENT
 * le même `deadline` (et le même `now`, si fourni) entre les deux appels
 * — jamais de recalcul/réinitialisation du budget entre l'ouverture et
 * l'envoi. À préférer à un enchaînement manuel `openDmChannel` +
 * `sendChannelMessage`, où un appelant pourrait par erreur recalculer
 * `deadline` entre les deux appels et doubler le budget réel accordé à
 * l'ensemble de l'invitation MP ; cette composition l'empêche
 * structurellement. Si l'ouverture du canal échoue, l'envoi n'est jamais
 * tenté (pas de second appel réseau sur un échec déjà classifié).
 */
export async function sendDirectMessage(input: SendDirectMessageInput): Promise<DiscordRestResult<SentMessage>> {
  const channel = await openDmChannel({
    userId: input.userId,
    deadline: input.deadline,
    now: input.now,
  });
  if (!channel.ok) return channel;

  return sendChannelMessage({
    channelId: channel.data.channelId,
    content: input.content,
    embeds: input.embeds,
    components: input.components,
    allowedMentions: input.allowedMentions,
    isDirectMessage: true,
    deadline: input.deadline,
    now: input.now,
  });
}

/**
 * Chantier confidentialité des soirées — fils PRIVÉS (`GUILD_PRIVATE_THREAD`,
 * type `12`). Faits vérifiés auprès de la documentation officielle
 * (docs.discord.com/developers/topics/threads et .../resources/channel ;
 * `discord.com`/`docs.discord.com`/`support.discord.com` étant bloqués en
 * sortie réseau dans CETTE session, vérifiés via une copie brute
 * `raw.githubusercontent.com/discord/discord-api-docs` du même contenu
 * source, jamais depuis la mémoire d'entraînement seule) :
 *   - Un fil privé n'existe QUE sous un salon parent `GUILD_TEXT` (jamais
 *     `GUILD_ANNOUNCEMENT`), requiert la permission bot
 *     `CREATE_PRIVATE_THREADS` sur ce salon.
 *   - `POST /channels/{channel.id}/threads` SANS `message_id` crée un fil
 *     jamais rattaché à un message existant — aucune information de
 *     soirée ne transite donc jamais par un message visible du salon
 *     public, contrairement à l'ancien `startThreadFromMessage`.
 *   - `invitable` (uniquement significatif pour un fil privé) : `false`
 *     signifie que SEUL le créateur du fil (ce bot) et les titulaires
 *     Discord de `MANAGE_THREADS` peuvent y ajouter des membres — un
 *     simple invité ne peut donc jamais élargir l'accès depuis Discord
 *     lui-même. Posé à `false` par défaut ici (jamais laissé au défaut
 *     Discord, qui est `true`).
 *   - Limite documentée, honnête, PAS contournable depuis ce client : un
 *     titulaire Discord de `MANAGE_THREADS` (admin/modérateur du serveur)
 *     voit et accède TOUJOURS à un fil privé, quelle que soit la liste de
 *     membres gérée applicativement — voir docs/archive/README_IMPLEMENTATION_HISTORY_2026-10.md.
 */
export interface StartPrivateThreadInput {
  channelId: string;
  name: string;
  /** `false` par défaut — voir le commentaire de fonction. */
  invitable?: boolean;
  autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
  deadline: Date;
  now?: Date;
}

export async function startPrivateThread(input: StartPrivateThreadInput): Promise<DiscordRestResult<ThreadInfo>> {
  return discordRequest({
    method: "POST",
    path: `/channels/${input.channelId}/threads`,
    body: {
      name: normalizeThreadName(input.name),
      type: PRIVATE_THREAD_TYPE,
      invitable: input.invitable ?? false,
      auto_archive_duration: input.autoArchiveDuration ?? 10080,
    },
    deadline: input.deadline,
    now: input.now,
    parse: parseThread,
  });
}

/**
 * Chantier confidentialité des soirées — un `NotificationDelivery` "thread"
 * déjà `SENT` peut, pour une soirée créée AVANT ce chantier, référencer
 * l'ANCIEN fil PUBLIC (créé par `startThreadFromMessage`, jamais retiré
 * ni recréé — l'enqueue de `thread` est à occurrence FIXE, jamais
 * rejouée). Rien dans la base ne distingue de façon fiable "ce fil a été
 * créé avant ou après ce chantier" (pas de nouvelle colonne ajoutée pour
 * ça). Plutôt qu'une heuristique de date fragile, CE client revérifie
 * TOUJOURS, via un `GET` réel, que le fil référencé est bien PRIVÉ
 * (`type: 12`, GUILD_PRIVATE_THREAD) avant d'y poster quoi que ce soit
 * ou d'y gérer des membres — jamais une confiance implicite dans une
 * référence stockée. Surcoût accepté (un `GET` de plus par opération,
 * même pour un fil dont on sait par construction qu'il est déjà privé) :
 * la sûreté prime sur l'économie d'un appel réseau pour une app à
 * cadence d'usage faible (groupe d'amis). Même philosophie que
 * `verifyChannelDestination` ci-dessus, appliquée ici aux fils.
 */
export async function verifyThreadIsPrivate(
  input: { threadId: string; deadline: Date; now?: Date }
): Promise<DiscordRestResult<{ threadId: string }>> {
  const result = await getChannel({ channelId: input.threadId, deadline: input.deadline, now: input.now });
  if (!result.ok) return result;

  if (result.data.type !== PRIVATE_THREAD_TYPE) {
    return {
      ok: false,
      kind: "destination_mismatch",
      message: `Fil Discord référencé de type ${result.data.type} — pas un fil PRIVÉ (12), refus de publier ou de gérer ses membres.`,
      retryable: false,
    };
  }
  return { ok: true, data: { threadId: result.data.channelId } };
}

/** Résultat vide (204) — les deux opérations de membership ci-dessous ne
 * renvoient rien d'exploitable au-delà du succès lui-même. */
export type ThreadMemberOpResult = Record<string, never>;

function parseEmptySuccess(): ThreadMemberOpResult {
  return {};
}

export interface ThreadMemberInput {
  threadId: string;
  /** Id Discord (snowflake) de l'utilisateur, PAS l'id interne GameNight. */
  discordUserId: string;
  deadline: Date;
  now?: Date;
}

/**
 * `PUT /channels/{channel.id}/thread-members/{user.id}` — idempotent par
 * nature côté Discord : `204` que le membre ait déjà été présent ou non,
 * jamais d'erreur pour un ajout répété. Requiert que ce bot puisse
 * envoyer des messages dans le fil (`SEND_MESSAGES_IN_THREADS`).
 */
export async function addThreadMember(input: ThreadMemberInput): Promise<DiscordRestResult<ThreadMemberOpResult>> {
  return discordRequest({
    method: "PUT",
    path: `/channels/${input.threadId}/thread-members/${input.discordUserId}`,
    deadline: input.deadline,
    now: input.now,
    allowEmptyBody: true,
    parse: parseEmptySuccess,
  });
}

/**
 * `DELETE /channels/{channel.id}/thread-members/{user.id}` — sur un fil
 * PRIVÉ créé par CE bot, le statut de créateur suffit (pas besoin de
 * `MANAGE_THREADS` guilde-wide, voir le commentaire de fonction
 * ci-dessus). Un `404` ("déjà absent du fil") N'EST PAS reclassé en
 * succès ICI — ce client reste honnête sur ce que Discord a répondu ; le
 * résolveur appelant (`resolveInviteSync`, session-announce.ts) décide
 * lui-même que ce cas atteint l'état cible visé (retrait), voir son
 * commentaire.
 */
export async function removeThreadMember(input: ThreadMemberInput): Promise<DiscordRestResult<ThreadMemberOpResult>> {
  return discordRequest({
    method: "DELETE",
    path: `/channels/${input.threadId}/thread-members/${input.discordUserId}`,
    deadline: input.deadline,
    now: input.now,
    allowEmptyBody: true,
    parse: parseEmptySuccess,
  });
}

export interface SendThreadMessageVerifiedInput extends MessageContentInput {
  threadId: string;
  deadline: Date;
  now?: Date;
}

/**
 * `verifyThreadIsPrivate` PUIS envoi — voir son commentaire : le fil
 * référencé par une ligne `NotificationDelivery` "thread" `SENT` peut,
 * pour une soirée créée avant ce chantier, être l'ANCIEN fil PUBLIC.
 * JAMAIS de `POST` si la vérification échoue, quelle qu'en soit la
 * raison. Réservée à toute publication dans un fil dont la référence
 * vient d'une lecture en base (annonce, résumé, rappel) — jamais
 * nécessaire pour un fil qu'on vient tout juste de créer soi-même dans le
 * même appel (aucun cas de ce genre dans ce module).
 */
export async function sendThreadMessageVerified(
  input: SendThreadMessageVerifiedInput
): Promise<DiscordRestResult<SentMessage>> {
  if (!hasContent(input)) {
    return {
      ok: false,
      kind: "invalid_request",
      message: "Aucun contenu ni embed fourni — rien à envoyer.",
      retryable: false,
    };
  }
  const verified = await verifyThreadIsPrivate({ threadId: input.threadId, deadline: input.deadline, now: input.now });
  if (!verified.ok) return verified;

  return sendThreadMessage({
    threadId: verified.data.threadId,
    content: input.content,
    embeds: input.embeds,
    components: input.components,
    allowedMentions: input.allowedMentions,
    deadline: input.deadline,
    now: input.now,
  });
}

/** `verifyThreadIsPrivate` PUIS ajout — même raisonnement que
 * `sendThreadMessageVerified` ci-dessus, appliqué à la synchronisation de
 * membres (`resolveInviteSync`, session-announce.ts). */
export async function addThreadMemberVerified(input: ThreadMemberInput): Promise<DiscordRestResult<ThreadMemberOpResult>> {
  const verified = await verifyThreadIsPrivate({ threadId: input.threadId, deadline: input.deadline, now: input.now });
  if (!verified.ok) return { ...verified, message: `Vérification du fil ${input.threadId} : ${verified.message}` };
  const result = await addThreadMember({ ...input, threadId: verified.data.threadId });
  if (!result.ok) return { ...result, message: `Ajout du membre ${input.discordUserId} au fil ${input.threadId} : ${result.message}` };
  return result;
}

/** `verifyThreadIsPrivate` PUIS retrait — même raisonnement. */
export async function removeThreadMemberVerified(input: ThreadMemberInput): Promise<DiscordRestResult<ThreadMemberOpResult>> {
  const verified = await verifyThreadIsPrivate({ threadId: input.threadId, deadline: input.deadline, now: input.now });
  if (!verified.ok) return verified;
  return removeThreadMember({ ...input, threadId: verified.data.threadId });
}

/**
 * Chantier nettoyage réel du stockage (V2) — adhésion automatique aux fils
 * de TOURNOIS (`src/lib/tournament-announce.ts`) utilise directement
 * `addThreadMember` ci-dessus (PAS `addThreadMemberVerified`) : un fil de
 * tournoi a TOUJOURS été un fil PUBLIC créé via `startThreadFromMessage`,
 * jamais migré depuis un ancien fil de type différent contrairement aux
 * soirées — aucune revérification de type n'est donc nécessaire avant d'y
 * ajouter un membre (voir le kind d'action `add_thread_member`,
 * notification-executor.ts, distinct de `add_thread_member_verified`).
 */

/**
 * Chantier nettoyage réel du stockage (V2) — suppression PERMANENTE d'un
 * fil Discord (soirée OU tournoi), distincte d'`archiveThread` (qui ne
 * fait que le figer, réversible, toujours utilisée par
 * `cancelTournament`/annulation — jamais transformée en suppression
 * définitive, cf. demande explicite). `DELETE /channels/{channel.id}` —
 * un fil est un salon côté API Discord (voir le commentaire de fichier),
 * donc le même endpoint que la suppression d'un salon classique
 * s'applique. Supprime le fil ET tous ses messages avec lui (comportement
 * natif Discord, rien à faire de plus côté application) — jamais utilisée
 * sur autre chose qu'un `threadId` persisté et déjà vérifié appartenir à
 * l'entité supprimée (voir les résolveurs `resolveSessionThreadDelete`/
 * `resolveTournamentThreadDelete`, jamais un id dérivé d'une recherche par
 * nom ou approximation).
 *
 * Permission Discord — vérifiée auprès de la documentation officielle
 * (docs.discord.com/developers/resources/channel, section DELETE
 * /channels/{channel.id} ; `discord.com` bloqué en sortie réseau dans
 * cette session, vérifié via `raw.githubusercontent.com/discord/discord-api-docs`,
 * jamais depuis la seule mémoire d'entraînement) : supprimer un THREAD
 * requiert la permission `MANAGE_THREADS` sur le salon parent — CONTRAIREMENT
 * à l'archivage simple (`archiveThread`), qui bénéficie d'une exception pour
 * le créateur du fil sans cette permission. Le bot DOIT donc détenir
 * `MANAGE_THREADS` pour que cette fonctionnalité fonctionne réellement — à
 * accorder explicitement sur les salons #🎮-soirées/#🏆-tournois
 * uniquement (jamais `Administrateur`), voir docs/archive/README_IMPLEMENTATION_HISTORY_2026-10.md pour la procédure.
 * Un fil déjà absent (`404`) N'EST PAS reclassé en succès ICI — même
 * discipline que `removeThreadMember` : c'est au résolveur appelant de
 * décider que ce cas atteint l'état cible visé (fil absent = objectif de
 * suppression déjà atteint), jamais ce client.
 */
export async function deleteThreadPermanently(
  input: { threadId: string; deadline: Date; now?: Date }
): Promise<DiscordRestResult<{ threadId: string }>> {
  return discordRequest({
    method: "DELETE",
    path: `/channels/${input.threadId}`,
    deadline: input.deadline,
    now: input.now,
    allowEmptyBody: true,
    parse: () => ({ threadId: input.threadId }),
  });
}

/**
 * Chantier nettoyage réel du stockage (V2) — suppression du message
 * d'annonce d'un tournoi dans le salon PARENT (jamais un fil, jamais le
 * salon lui-même) après suppression définitive du tournoi — évite de
 * laisser un lien d'inscription cassé pointant vers une page qui n'existe
 * plus (cf. demande explicite). `DELETE /channels/{channel.id}/messages/{message.id}` —
 * le bot supprime TOUJOURS son PROPRE message ici (celui qu'il a lui-même
 * envoyé au premier SEND de l'annonce, jamais un message d'un tiers) :
 * aucune permission supplémentaire (`MANAGE_MESSAGES`) n'est nécessaire
 * pour ce cas précis d'après la documentation officielle (un bot peut
 * toujours supprimer ses propres messages) — seul un salon dont le bot
 * n'a même plus accès en lecture/écriture ferait échouer cet appel
 * (classé `auth_or_permission`, jamais un succès). `messageId`/`channelId`
 * proviennent EXCLUSIVEMENT de la référence PERSISTÉE du message
 * réellement envoyé (voir `findSentDelivery`, tournament-announce.ts),
 * jamais reconstruits ni devinés. Un message déjà absent (`404`) N'EST PAS
 * reclassé en succès ICI — même discipline que `removeThreadMember`.
 */
export async function deleteChannelMessage(
  input: { channelId: string; messageId: string; deadline: Date; now?: Date }
): Promise<DiscordRestResult<{ channelId: string; messageId: string }>> {
  return discordRequest({
    method: "DELETE",
    path: `/channels/${input.channelId}/messages/${input.messageId}`,
    deadline: input.deadline,
    now: input.now,
    allowEmptyBody: true,
    parse: () => ({ channelId: input.channelId, messageId: input.messageId }),
  });
}
