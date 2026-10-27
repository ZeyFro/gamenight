import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TARGET_GUILD_ID = "553922938101825536";
export const DISCORD_API_BASE = "https://discord.com/api/v10";
const API_ORIGIN = new URL(DISCORD_API_BASE).origin;
const API_PREFIX = new URL(DISCORD_API_BASE).pathname;
const API_TIMEOUT_MS = 15_000;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;
const DEFAULT_OUTPUT_DIR = ".private-audit/discord";

/** @typedef {{ resource_type: string, id: string | null, name: string | null, suggested_action: string, reason: string, merge_into: string | null }} DiscordAuditItem */
/** @typedef {{ recommendations: { items: DiscordAuditItem[] } }} DiscordAuditCsvReport */
/** @typedef {{ schema_version: number, captured_at: string, target: { guild_id: string, guild_name: string | null }, source: { api: string, version: string, methods: string[] }, privacy: Record<string, boolean | number>, guild: Record<string, unknown>, roles: Record<string, unknown>[], channels: Record<string, unknown>[], scheduled_events: Record<string, unknown>[], settings: Record<string, unknown>, recommendations: { summary: Record<string, number>, items: DiscordAuditItem[], by_action: Record<string, DiscordAuditItem[]>, policy: Record<string, unknown>, generated_at: string } }} DiscordAuditReport */

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const textOrNull = (value) => (typeof value === "string" ? value : null);
const idOrNull = (value) => (typeof value === "string" && /^\d{1,20}$/.test(value) ? value : null);
const normalizeName = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Réponse Discord invalide (${label}).`);
  return value.filter(isRecord);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response, body) {
  const seconds =
    Number(response.headers.get("retry-after")) ||
    Number(body?.retry_after) ||
    Number(response.headers.get("x-ratelimit-reset-after"));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : null;
}

function createDiscordGet({ token, fetchImpl, sleep }) {
  return async function discordGet(route, { optional = false } = {}) {
    if (!route.startsWith("/guilds/") || route.startsWith("//") || route.includes("..")) {
      throw new Error("Route d’audit Discord non autorisée.");
    }
    const url = new URL(`${API_PREFIX}${route}`, API_ORIGIN);

    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bot ${token}`, Accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
      } catch {
        throw new Error(`Échec réseau Discord (${url.pathname}).`);
      }

      if (response.status === 429) {
        const body = await response.json().catch(() => null);
        const waitMs = retryDelayMs(response, body);
        if (attempt >= MAX_RATE_LIMIT_RETRIES || waitMs === null || waitMs > MAX_RATE_LIMIT_WAIT_MS) {
          throw new Error(`Limite de débit Discord atteinte (${url.pathname}); relancer plus tard.`);
        }
        await sleep(waitMs);
        continue;
      }

      if (optional && (response.status === 403 || response.status === 404)) {
        return { available: false, reason: response.status === 403 ? "forbidden" : "not_available" };
      }
      if (!response.ok) throw new Error(`Discord a répondu HTTP ${response.status} (${url.pathname}).`);

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Réponse JSON Discord invalide (${url.pathname}).`);
      }
      return { available: true, data };
    }
  };
}

function projectGuild(guild) {
  return {
    id: idOrNull(guild.id),
    name: textOrNull(guild.name),
    description: textOrNull(guild.description),
    features: Array.isArray(guild.features) ? guild.features.filter((value) => typeof value === "string") : [],
    verification_level: guild.verification_level ?? null,
    default_message_notifications: guild.default_message_notifications ?? null,
    explicit_content_filter: guild.explicit_content_filter ?? null,
    mfa_level: guild.mfa_level ?? null,
    preferred_locale: textOrNull(guild.preferred_locale),
    nsfw_level: guild.nsfw_level ?? null,
    premium_tier: guild.premium_tier ?? null,
    afk_timeout: guild.afk_timeout ?? null,
    afk_channel_id: idOrNull(guild.afk_channel_id),
    system_channel_id: idOrNull(guild.system_channel_id),
    system_channel_flags: guild.system_channel_flags ?? null,
    rules_channel_id: idOrNull(guild.rules_channel_id),
    public_updates_channel_id: idOrNull(guild.public_updates_channel_id),
    safety_alerts_channel_id: idOrNull(guild.safety_alerts_channel_id),
    widget_enabled: typeof guild.widget_enabled === "boolean" ? guild.widget_enabled : null,
    widget_channel_id: idOrNull(guild.widget_channel_id),
  };
}

function projectRole(role) {
  return {
    id: idOrNull(role.id),
    name: textOrNull(role.name),
    permissions: typeof role.permissions === "string" ? role.permissions : String(role.permissions ?? "0"),
    position: Number.isFinite(role.position) ? role.position : 0,
    color: Number.isFinite(role.color) ? role.color : 0,
    hoist: Boolean(role.hoist),
    mentionable: Boolean(role.mentionable),
    managed: Boolean(role.managed),
  };
}

function projectChannel(channel) {
  const rawOverwrites = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
  const roleOverwrites = rawOverwrites
    .filter((overwrite) => isRecord(overwrite) && Number(overwrite.type) === 0)
    .map((overwrite) => ({
      role_id: idOrNull(overwrite.id),
      allow: String(overwrite.allow ?? "0"),
      deny: String(overwrite.deny ?? "0"),
    }))
    .filter((overwrite) => overwrite.role_id !== null);

  return {
    id: idOrNull(channel.id),
    name: textOrNull(channel.name),
    type: Number.isFinite(channel.type) ? channel.type : null,
    parent_id: idOrNull(channel.parent_id),
    position: Number.isFinite(channel.position) ? channel.position : 0,
    topic_present: typeof channel.topic === "string" && channel.topic.length > 0,
    nsfw: Boolean(channel.nsfw),
    bitrate: Number.isFinite(channel.bitrate) ? channel.bitrate : null,
    user_limit: Number.isFinite(channel.user_limit) ? channel.user_limit : null,
    rate_limit_per_user: Number.isFinite(channel.rate_limit_per_user) ? channel.rate_limit_per_user : null,
    default_auto_archive_duration: Number.isFinite(channel.default_auto_archive_duration)
      ? channel.default_auto_archive_duration
      : null,
    role_permission_overwrites: roleOverwrites,
    omitted_member_overwrite_count: rawOverwrites.filter(
      (overwrite) => isRecord(overwrite) && Number(overwrite.type) === 1,
    ).length,
  };
}

function projectEvent(event) {
  const location = event.entity_metadata?.location;
  return {
    id: idOrNull(event.id),
    name: textOrNull(event.name),
    scheduled_start_time: textOrNull(event.scheduled_start_time),
    scheduled_end_time: textOrNull(event.scheduled_end_time),
    privacy_level: event.privacy_level ?? null,
    status: event.status ?? null,
    entity_type: event.entity_type ?? null,
    channel_id: idOrNull(event.channel_id),
    description_present: typeof event.description === "string" && event.description.length > 0,
    location_present: typeof location === "string" && location.length > 0,
  };
}

function projectWidget(result) {
  if (!result.available) return result;
  const data = result.data;
  return {
    available: true,
    enabled: Boolean(data.enabled),
    channel_id: idOrNull(data.channel_id),
  };
}

function projectWelcomeScreen(result) {
  if (!result.available) return result;
  const data = result.data;
  return {
    available: true,
    description_present: typeof data.description === "string" && data.description.length > 0,
    channels: requireArray(data.welcome_channels ?? [], "welcome screen").map((channel) => ({
      channel_id: idOrNull(channel.channel_id),
      emoji_id: idOrNull(channel.emoji_id),
      emoji_name: textOrNull(channel.emoji_name),
      description_present: typeof channel.description === "string" && channel.description.length > 0,
    })),
  };
}

function projectOnboarding(result) {
  if (!result.available) return result;
  const data = result.data;
  return {
    available: true,
    enabled: Boolean(data.enabled),
    mode: data.mode ?? null,
    default_channel_ids: Array.isArray(data.default_channel_ids)
      ? data.default_channel_ids.map(idOrNull).filter(Boolean)
      : [],
    prompts: requireArray(data.prompts ?? [], "onboarding").map((prompt) => ({
      required: Boolean(prompt.required),
      single_select: Boolean(prompt.single_select),
      type: prompt.type ?? null,
      options: requireArray(prompt.options ?? [], "onboarding options").map((option) => ({
        channel_ids: Array.isArray(option.channel_ids) ? option.channel_ids.map(idOrNull).filter(Boolean) : [],
        role_ids: Array.isArray(option.role_ids) ? option.role_ids.map(idOrNull).filter(Boolean) : [],
      })),
    })),
  };
}

function projectAutoModeration(result) {
  if (!result.available) return { ...result, rules: [] };
  return {
    available: true,
    rules: requireArray(result.data, "auto-moderation").map((rule) => ({
      id: idOrNull(rule.id),
      name: textOrNull(rule.name),
      enabled: Boolean(rule.enabled),
      event_type: rule.event_type ?? null,
      trigger_type: rule.trigger_type ?? null,
      exempt_roles: Array.isArray(rule.exempt_roles) ? rule.exempt_roles.map(idOrNull).filter(Boolean) : [],
      exempt_channels: Array.isArray(rule.exempt_channels)
        ? rule.exempt_channels.map(idOrNull).filter(Boolean)
        : [],
      actions: requireArray(rule.actions ?? [], "auto-moderation actions").map((action) => ({
        type: action.type ?? null,
        duration_seconds: Number.isFinite(action.metadata?.duration_seconds)
          ? action.metadata.duration_seconds
          : null,
        custom_message_present: typeof action.metadata?.custom_message === "string" &&
          action.metadata.custom_message.length > 0,
      })),
    })),
  };
}

function resource(type, data, action, reason, mergeInto = null) {
  return {
    resource_type: type,
    id: data.id,
    name: data.name ?? null,
    suggested_action: action,
    reason,
    merge_into: mergeInto,
  };
}

function duplicateGroups(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function buildRecommendations({ guild, roles, channels, events, settings, capturedAt }) {
  const recommendations = [];
  const roleReferences = new Set(channels.flatMap((channel) => channel.role_permission_overwrites.map((item) => item.role_id)));
  const channelReferences = new Set([
    guild.afk_channel_id,
    guild.system_channel_id,
    guild.rules_channel_id,
    guild.public_updates_channel_id,
    guild.safety_alerts_channel_id,
    guild.widget_channel_id,
    settings.widget.available ? settings.widget.channel_id : null,
    ...(settings.welcomeScreen.available ? settings.welcomeScreen.channels.map((item) => item.channel_id) : []),
    ...(settings.onboarding.available ? settings.onboarding.default_channel_ids : []),
    ...(settings.autoModeration.available ? settings.autoModeration.rules.flatMap((rule) => rule.exempt_channels) : []),
  ].filter(Boolean));
  const roleReferencesFromSettings = new Set([
    ...(settings.autoModeration.available ? settings.autoModeration.rules.flatMap((rule) => rule.exempt_roles) : []),
  ]);
  const channelIdsWithChildren = new Set(channels.map((channel) => channel.parent_id).filter(Boolean));
  const channelsWithRoleRules = new Set(channels
    .filter((channel) => channel.role_permission_overwrites.length > 0)
    .map((channel) => channel.id));

  recommendations.push(resource("guild_settings", guild, "keep", "Configuration générale du serveur."));

  const roleDuplicates = duplicateGroups(roles.filter((role) => !role.managed && role.id !== guild.id),
    (role) => normalizeName(role.name));
  for (const role of roles) {
    if (role.id === guild.id) {
      recommendations.push(resource("role", role, "keep", "Rôle @everyone requis par Discord."));
    } else if (role.managed) {
      recommendations.push(resource("role", role, "keep", "Rôle géré par une intégration ou une application."));
    } else if (roleReferences.has(role.id) || roleReferencesFromSettings.has(role.id)) {
      recommendations.push(resource("role", role, "keep", "Référencé par une permission ou un réglage exporté."));
    } else {
      const duplicateGroup = roleDuplicates.find((group) => group.includes(role));
      const canonical = duplicateGroup?.[0];
      if (canonical && role.id !== canonical.id) {
        recommendations.push(resource("role", role, "merge", "Nom identique après normalisation; vérifier les attributions aux membres avant toute fusion.", canonical.id));
      } else {
        recommendations.push(resource("role", role, "review", "Aucun usage observable sans exporter les membres."));
      }
    }
  }

  const channelDuplicates = duplicateGroups(channels.filter((channel) => channel.name),
    (channel) => `${channel.type}:${channel.parent_id ?? "root"}:${normalizeName(channel.name)}`);
  const archiveName = /\b(archive|archived|old|obsolete|ancien|ancienne)\b/i;
  for (const channel of channels) {
    if (channelReferences.has(channel.id) || channelIdsWithChildren.has(channel.id) || channelsWithRoleRules.has(channel.id)) {
      recommendations.push(resource("channel", channel, "keep", "Salon référencé par les réglages, des permissions ou des salons enfants."));
      continue;
    }
    const duplicateGroup = channelDuplicates.find((group) => group.includes(channel));
    const canonical = duplicateGroup?.[0];
    if (canonical && channel.id !== canonical.id) {
      recommendations.push(resource("channel", channel, "merge", "Nom et type identiques dans la même catégorie; vérifier le contenu manuellement avant toute fusion.", canonical.id));
    } else if (archiveName.test(channel.name ?? "")) {
      recommendations.push(resource("channel", channel, "archive", "Nom explicitement ancien/archivé; l’activité n’a pas été consultée."));
    } else {
      recommendations.push(resource("channel", channel, "review", "Aucune activité ni aucun message n’a été consulté."));
    }
  }

  for (const event of events) {
    const ended = event.status === 3 || event.status === 4;
    recommendations.push(resource("scheduled_event", event, ended ? "archive" : "keep",
      ended ? "Événement terminé ou annulé; vérifier avant archivage." : "Événement planifié ou actif."));
  }

  if (settings.widget.available) recommendations.push(resource("widget_settings", settings.widget, "review", "Paramètres du widget; revue manuelle."));
  if (settings.welcomeScreen.available) recommendations.push(resource("welcome_screen", settings.welcomeScreen, "review", "Écran d’accueil; les textes ne sont pas exportés."));
  if (settings.onboarding.available) recommendations.push(resource("onboarding", settings.onboarding, "review", "Parcours d’accueil; libellés et réponses ne sont pas exportés."));
  if (settings.autoModeration.available) {
    for (const rule of settings.autoModeration.rules) {
      recommendations.push(resource("auto_moderation_rule", rule, rule.enabled ? "keep" : "archive",
        rule.enabled ? "Règle active." : "Règle désactivée; vérifier avant archivage."));
    }
  }

  const buckets = { keep: [], merge: [], archive: [], delete: [], review: [] };
  for (const item of recommendations) buckets[item.suggested_action].push(item);
  return {
    summary: Object.fromEntries(Object.entries(buckets).map(([action, items]) => [action, items.length])),
    items: recommendations,
    by_action: buckets,
    policy: {
      delete_recommendations: [],
      note: "Aucune suppression n’est recommandée automatiquement; les décisions merge/archive sont des pistes à valider par un administrateur.",
    },
    generated_at: capturedAt,
  };
}

/**
 * @param {{ guildId?: string, token?: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<unknown>, now?: () => Date }} [options]
 * @returns {Promise<DiscordAuditReport>}
 */
export async function collectDiscordAudit({
  guildId,
  token,
  fetchImpl = fetch,
  sleep = delay,
  now = () => new Date(),
} = {}) {
  if (guildId !== TARGET_GUILD_ID) throw new Error(`Cet outil est limité au serveur ${TARGET_GUILD_ID}.`);
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("DISCORD_BOT_TOKEN absent du processus; utilisez l’injection Vercel documentée.");
  }

  const discordGet = createDiscordGet({ token: token.trim(), fetchImpl, sleep });
  const guildResult = await discordGet(`/guilds/${guildId}?with_counts=false`);
  if (!isRecord(guildResult.data) || guildResult.data.id !== guildId) throw new Error("Réponse Discord invalide (serveur ciblé).");

  const rolesResult = await discordGet(`/guilds/${guildId}/roles`);
  const channelsResult = await discordGet(`/guilds/${guildId}/channels`);
  const eventsResult = await discordGet(`/guilds/${guildId}/scheduled-events?with_user_count=false`);
  const widgetResult = await discordGet(`/guilds/${guildId}/widget`, { optional: true });
  const welcomeResult = await discordGet(`/guilds/${guildId}/welcome-screen`, { optional: true });
  const onboardingResult = await discordGet(`/guilds/${guildId}/onboarding`, { optional: true });
  const autoModerationResult = await discordGet(`/guilds/${guildId}/auto-moderation/rules`, { optional: true });

  const guild = projectGuild(guildResult.data);
  const roles = requireArray(rolesResult.data, "roles").map(projectRole);
  const channels = requireArray(channelsResult.data, "channels").map(projectChannel);
  const events = requireArray(eventsResult.data, "scheduled events").map(projectEvent);
  const settings = {
    widget: projectWidget(widgetResult),
    welcomeScreen: projectWelcomeScreen(welcomeResult),
    onboarding: projectOnboarding(onboardingResult),
    autoModeration: projectAutoModeration(autoModerationResult),
  };
  const capturedAt = now().toISOString();
  const recommendations = buildRecommendations({ guild, roles, channels, events, settings, capturedAt });

  return {
    schema_version: 1,
    captured_at: capturedAt,
    target: { guild_id: guildId, guild_name: guild.name },
    source: { api: "Discord REST", version: "v10", methods: ["GET"] },
    privacy: {
      messages_requested: false,
      member_records_requested: false,
      member_permission_overwrites_exported: false,
      omitted_member_permission_overwrites: channels.reduce((sum, channel) => sum + channel.omitted_member_overwrite_count, 0),
      token_in_report: false,
    },
    guild,
    roles,
    channels,
    scheduled_events: events,
    settings,
    recommendations,
  };
}

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** @param {DiscordAuditCsvReport} report */
export function auditReportToCsv(report) {
  const headers = ["resource_type", "id", "name", "suggested_action", "reason", "merge_into"];
  const rows = report.recommendations.items.map((item) => [
    item.resource_type,
    item.id,
    item.name,
    item.suggested_action,
    item.reason,
    item.merge_into,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function writeAuditReports(report, outputDir = DEFAULT_OUTPUT_DIR, { fs = { mkdir, writeFile }, now = new Date() } = {}) {
  const safeTimestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const basename = `discord-audit-${report.target.guild_id}-${safeTimestamp}`;
  const directory = path.resolve(outputDir);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const jsonPath = path.join(directory, `${basename}.json`);
  const csvPath = path.join(directory, `${basename}.csv`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.writeFile(csvPath, auditReportToCsv(report), { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { jsonPath, csvPath };
}

function parseArgs(args) {
  const options = { guildId: null, outputDir: DEFAULT_OUTPUT_DIR, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--help" || value === "-h") options.help = true;
    else if (value === "--guild-id" && args[index + 1]) options.guildId = args[++index];
    else if (value === "--out" && args[index + 1]) options.outputDir = args[++index];
    else throw new Error(`Argument inconnu ou incomplet: ${value}`);
  }
  return options;
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log("Usage: node scripts/audit-discord-guild.mjs --guild-id 553922938101825536 [--out .private-audit/discord]");
    return;
  }
  const report = await collectDiscordAudit({ guildId: options.guildId, token: process.env.DISCORD_BOT_TOKEN });
  const files = await writeAuditReports(report, options.outputDir);
  console.log(`Audit REST en lecture seule terminé: ${report.recommendations.items.length} éléments; ${report.privacy.omitted_member_permission_overwrites} permissions individuelles omises.`);
  console.log(`JSON: ${files.jsonPath}`);
  console.log(`CSV: ${files.csvPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Échec de l’audit Discord.");
    process.exitCode = 1;
  });
}
