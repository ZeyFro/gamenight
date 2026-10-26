import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditReportToCsv,
  collectDiscordAudit,
  TARGET_GUILD_ID,
  writeAuditReports,
} from "../../scripts/audit-discord-guild.mjs";

const TOKEN = "test-token-that-must-never-appear-in-reports";
const CHANNEL_ID = "100000000000000001";
const CATEGORY_ID = "100000000000000002";
const ROLE_ID = "100000000000000003";
const MEMBER_ID = "999999999999999999";

function fixtures(): Map<string, unknown> {
  return new Map([
    [`/api/v10/guilds/${TARGET_GUILD_ID}`, {
      id: TARGET_GUILD_ID,
      name: "The Tower",
      owner_id: MEMBER_ID,
      approximate_member_count: 321,
      description: "Description communautaire",
      features: ["COMMUNITY"],
      verification_level: 2,
      default_message_notifications: 1,
      explicit_content_filter: 2,
      mfa_level: 1,
      preferred_locale: "fr",
      nsfw_level: 0,
      premium_tier: 2,
      afk_timeout: 300,
      afk_channel_id: null,
      system_channel_id: null,
      system_channel_flags: 0,
      rules_channel_id: null,
      public_updates_channel_id: null,
      safety_alerts_channel_id: null,
      widget_enabled: true,
      widget_channel_id: CHANNEL_ID,
    }],
    [`/api/v10/guilds/${TARGET_GUILD_ID}/roles`, [
      { id: TARGET_GUILD_ID, name: "@everyone", permissions: "1024", position: 0 },
      { id: ROLE_ID, name: "Raid", permissions: "2048", position: 2 },
      { id: "100000000000000004", name: "raid", permissions: "0", position: 1 },
    ]],
    [`/api/v10/guilds/${TARGET_GUILD_ID}/channels`, [
      { id: CATEGORY_ID, name: "Games", type: 4, position: 0, permission_overwrites: [] },
      {
        id: CHANNEL_ID,
        name: "games",
        type: 0,
        parent_id: CATEGORY_ID,
        position: 1,
        topic: "A topic that is intentionally not exported",
        permission_overwrites: [
          { id: ROLE_ID, type: 0, allow: "1024", deny: "0" },
          { id: MEMBER_ID, type: 1, allow: "2048", deny: "0" },
        ],
      },
      { id: "100000000000000005", name: "games", type: 0, parent_id: CATEGORY_ID, position: 2 },
      { id: "100000000000000006", name: "old-chat", type: 0, position: 3 },
    ]],
    [`/api/v10/guilds/${TARGET_GUILD_ID}/scheduled-events`, [
      {
        id: "100000000000000007",
        name: "Past tournament",
        status: 3,
        creator_id: MEMBER_ID,
        user_count: 42,
        description: "Private event description",
        scheduled_start_time: "2026-01-01T12:00:00.000Z",
        scheduled_end_time: "2026-01-01T14:00:00.000Z",
        privacy_level: 2,
        entity_type: 3,
        entity_metadata: { location: "Private address" },
      },
      {
        id: "100000000000000008",
        name: "Next game night",
        status: 1,
        scheduled_start_time: "2027-01-01T12:00:00.000Z",
        scheduled_end_time: "2027-01-01T14:00:00.000Z",
        privacy_level: 2,
        entity_type: 2,
        channel_id: CHANNEL_ID,
      },
    ]],
    [`/api/v10/guilds/${TARGET_GUILD_ID}/widget`, { enabled: true, channel_id: CHANNEL_ID }],
    [`/api/v10/guilds/${TARGET_GUILD_ID}/welcome-screen`, {
      description: "Private welcome text",
      welcome_channels: [{ channel_id: CHANNEL_ID, description: "Private channel text", emoji_name: "🎮" }],
    }],
    [`/api/v10/guilds/${TARGET_GUILD_ID}/onboarding`, {
      enabled: true,
      mode: 1,
      default_channel_ids: [CHANNEL_ID],
      prompts: [{ required: true, single_select: false, type: 0, title: "Private prompt", options: [{ title: "Private answer", channel_ids: [CHANNEL_ID], role_ids: [ROLE_ID] }] }],
    }],
    [`/api/v10/guilds/${TARGET_GUILD_ID}/auto-moderation/rules`, [{
      id: "100000000000000009",
      name: "PII filter",
      enabled: true,
      event_type: 1,
      trigger_type: 1,
      trigger_metadata: { keyword_filter: ["member@example.test"] },
      exempt_roles: [ROLE_ID],
      exempt_channels: [CHANNEL_ID],
      actions: [{ type: 1, metadata: { custom_message: "Private message", duration_seconds: 5 } }],
    }]],
  ]);
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeFetch(
  data: Map<string, unknown>,
  calls: { url: URL; options: RequestInit }[],
  statuses: Map<string, number> = new Map(),
) {
  return async (url: URL | RequestInfo, options: RequestInit = {}) => {
    const parsed = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    calls.push({ url: parsed, options });
    const status = statuses.get(parsed.pathname);
    if (status) return response({ message: "private server error" }, status);
    if (!data.has(parsed.pathname)) return response({ message: "not found" }, 404);
    return response(data.get(parsed.pathname));
  };
}

describe("audit Discord REST local", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("exporte l’inventaire autorisé sans membres, messages, textes libres ni jeton", async () => {
    const calls: { url: URL; options: RequestInit }[] = [];
    const report = await collectDiscordAudit({
      guildId: TARGET_GUILD_ID,
      token: TOKEN,
      fetchImpl: fakeFetch(fixtures(), calls),
      now: () => new Date("2026-10-26T12:00:00.000Z"),
    });
    const serialized = JSON.stringify(report);

    expect(calls).toHaveLength(8);
    expect(calls.every(({ url, options }) => url.origin === "https://discord.com" && url.pathname.startsWith("/api/v10/guilds/") && options.method === "GET")).toBe(true);
    expect(calls.every(({ options }) => options.redirect === "error" && new Headers(options.headers).get("authorization") === `Bot ${TOKEN}`)).toBe(true);
    expect(calls.some(({ url }) => /messages|members|audit-logs/.test(url.pathname))).toBe(false);
    expect(report.source.methods).toEqual(["GET"]);
    expect(report.privacy).toMatchObject({
      messages_requested: false,
      member_records_requested: false,
      member_permission_overwrites_exported: false,
      omitted_member_permission_overwrites: 1,
      token_in_report: false,
    });
    expect(report.channels.find((channel) => channel.id === CHANNEL_ID)?.role_permission_overwrites).toEqual([
      { role_id: ROLE_ID, allow: "1024", deny: "0" },
    ]);
    expect(report.channels.find((channel) => channel.id === CHANNEL_ID)).not.toHaveProperty("topic");
    expect(report.scheduled_events[0]!).not.toHaveProperty("creator_id");
    expect(report.scheduled_events[0]!).not.toHaveProperty("user_count");
    expect(report.scheduled_events[0]!).not.toHaveProperty("location");
    expect(report.guild).not.toHaveProperty("owner_id");
    expect(report.guild).not.toHaveProperty("approximate_member_count");
    expect(serialized).not.toContain(MEMBER_ID);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("member@example.test");
    expect(serialized).not.toContain("Private event description");
    expect(serialized).not.toContain("Private welcome text");
    expect(serialized).not.toContain("Private prompt");
  });

  it("propose fusion/archivage prudents et ne recommande jamais une suppression", async () => {
    const report = await collectDiscordAudit({ guildId: TARGET_GUILD_ID, token: TOKEN, fetchImpl: fakeFetch(fixtures(), []) });
    const items = report.recommendations.items;
    expect(items.find((item) => item.id === "100000000000000005")?.suggested_action).toBe("merge");
    expect(items.find((item) => item.id === "100000000000000005")?.merge_into).toBe(CHANNEL_ID);
    expect(items.find((item) => item.id === "100000000000000006")?.suggested_action).toBe("archive");
    expect(items.find((item) => item.id === "100000000000000007")?.suggested_action).toBe("archive");
    expect(items.find((item) => item.resource_type === "role" && item.id === "100000000000000004")?.suggested_action).toBe("merge");
    expect(report.recommendations.by_action.delete).toEqual([]);
    expect(report.recommendations.summary.delete).toBe(0);
  });

  it("respecte retry_after Discord et les accès facultatifs restent signalés", async () => {
    const data = fixtures();
    const calls: { url: URL; options: RequestInit }[] = [];
    const waits: number[] = [];
    const baseFetch = fakeFetch(data, calls);
    let first = true;
    const fetchImpl = async (url: URL | RequestInfo, options: RequestInit = {}) => {
      const parsed = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      if (parsed.pathname === `/api/v10/guilds/${TARGET_GUILD_ID}` && first) {
        first = false;
        calls.push({ url: parsed, options });
        return response({ retry_after: 0.25 }, 429);
      }
      if (parsed.pathname.endsWith("/auto-moderation/rules")) {
        calls.push({ url: parsed, options });
        return response({ message: "not allowed" }, 403);
      }
      return baseFetch(url, options);
    };
    const report = await collectDiscordAudit({ guildId: TARGET_GUILD_ID, token: TOKEN, fetchImpl, sleep: async (ms) => waits.push(ms) });
    expect(waits).toEqual([250]);
    expect(report.settings.autoModeration).toEqual({ available: false, reason: "forbidden", rules: [] });
  });

  it("refuse une autre guilde et un token absent avant tout appel", async () => {
    const fetchImpl = async () => { throw new Error("should not run"); };
    await expect(collectDiscordAudit({ guildId: "111111111111111111", token: TOKEN, fetchImpl })).rejects.toThrow("limité au serveur");
    await expect(collectDiscordAudit({ guildId: TARGET_GUILD_ID, token: " ", fetchImpl })).rejects.toThrow("DISCORD_BOT_TOKEN absent");
  });

  it("écrit JSON et CSV uniquement dans le dossier local demandé, sans écraser", async () => {
    const report = await collectDiscordAudit({ guildId: TARGET_GUILD_ID, token: TOKEN, fetchImpl: fakeFetch(fixtures(), []) });
    const directory = await mkdtemp(path.join(os.tmpdir(), "gamenight-discord-audit-"));
    tempDirs.push(directory);
    const now = new Date("2026-10-26T12:00:00.000Z");
    const files = await writeAuditReports(report, directory, { now });
    const json = await readFile(files.jsonPath, "utf8");
    const csv = await readFile(files.csvPath, "utf8");
    expect(JSON.parse(json).target.guild_id).toBe(TARGET_GUILD_ID);
    expect(csv).toContain('"resource_type","id","name","suggested_action"');
    expect(csv).not.toContain(TOKEN);
    expect(auditReportToCsv(report)).toBe(csv);
    await expect(writeAuditReports(report, directory, { now })).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("neutralise les cellules CSV interprétables comme formules", () => {
    const csv = auditReportToCsv({ recommendations: { items: [{
      resource_type: "channel",
      id: CHANNEL_ID,
      name: '=HYPERLINK("https://example.test")',
      suggested_action: "review",
      reason: "Revue manuelle.",
      merge_into: null,
    }] } });
    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.test\"\")\"");
  });
});
