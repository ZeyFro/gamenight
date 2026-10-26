import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  collectDiscordAudit: vi.fn(),
  auditReportToCsv: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("../../../../../scripts/audit-discord-guild.mjs", () => ({
  TARGET_GUILD_ID: "553922938101825536",
  collectDiscordAudit: mocks.collectDiscordAudit,
  auditReportToCsv: mocks.auditReportToCsv,
}));

import { GET } from "./route";

const GUILD_ID = "553922938101825536";
const ADMIN_ID = "111111111111111111";
const MEMBER_ID = "999999999999999999";
const BOT_TOKEN = "simulated-production-bot-token";

const report = {
  schema_version: 1,
  captured_at: "2026-10-26T12:00:00.000Z",
  target: { guild_id: GUILD_ID, guild_name: "The Tower" },
  source: { api: "Discord REST", version: "v10", methods: ["GET"] },
  privacy: { messages_requested: false, member_records_requested: false, token_in_report: false },
  guild: { id: GUILD_ID, name: "The Tower", description: "PRIVATE GUILD DESCRIPTION" },
  roles: [{ id: "222222222222222222", name: "Raid" }],
  channels: [{ id: "333333333333333333", name: "games", type: 0 }],
  scheduled_events: [{ id: "444444444444444444", name: "Next game night" }],
  settings: { welcomeScreen: { description: "PRIVATE CONFIG TEXT" } },
  recommendations: {
    summary: { keep: 1, review: 2 },
    items: [
      { resource_type: "channel", id: "333333333333333333", name: "games", suggested_action: "keep" },
      { resource_type: "auto_moderation_rule", id: "555555555555555555", name: "PRIVATE AUTO MOD" },
    ],
    by_action: { keep: [], review: [], merge: [], archive: [], delete: [] },
    policy: { delete_recommendations: [] },
    generated_at: "2026-10-26T12:00:00.000Z",
  },
};

function request(format: string, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`https://gamenight.example/api/admin/discord-audit?format=${format}`, {
    headers: {
      origin: "https://gamenight.example",
      "sec-fetch-site": "same-origin",
      ...extraHeaders,
    },
  });
}

describe("GET /api/admin/discord-audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISCORD_GUILD_AUDIT_ENABLED", "true");
    vi.stubEnv("DISCORD_GUILD_AUDIT_ADMIN_IDS", ADMIN_ID);
    vi.stubEnv("DISCORD_BOT_TOKEN", BOT_TOKEN);
    mocks.requireAdmin.mockResolvedValue({ discordId: ADMIN_ID });
    mocks.collectDiscordAudit.mockResolvedValue(report);
    mocks.auditReportToCsv.mockReturnValue('"resource_type","id","name"\r\n"channel","333333333333333333","games"\r\n');
  });

  afterEach(() => vi.unstubAllEnvs());

  it("refuse un appelant non authentifié avant tout appel Discord", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    const response = await GET(request("json"));
    expect(response.status).toBe(401);
    expect(mocks.collectDiscordAudit).not.toHaveBeenCalled();
  });

  it("reste fermé si le drapeau est absent ou l'admin ne figure pas dans l'autorisation dédiée", async () => {
    vi.stubEnv("DISCORD_GUILD_AUDIT_ENABLED", "");
    expect((await GET(request("json"))).status).toBe(404);
    vi.stubEnv("DISCORD_GUILD_AUDIT_ENABLED", "true");
    vi.stubEnv("DISCORD_GUILD_AUDIT_ADMIN_IDS", "");
    expect((await GET(request("json"))).status).toBe(404);
    vi.stubEnv("DISCORD_GUILD_AUDIT_ADMIN_IDS", "222222222222222222");
    expect((await GET(request("json"))).status).toBe(404);
    expect(mocks.collectDiscordAudit).not.toHaveBeenCalled();
  });

  it("refuse l'origine cross-site et les formats inconnus sans lancer l'audit", async () => {
    expect((await GET(request("json", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await GET(request("json", { origin: "https://attacker.example" }))).status).toBe(403);
    expect((await GET(request("xml"))).status).toBe(400);
    expect(mocks.collectDiscordAudit).not.toHaveBeenCalled();
  });

  it("télécharge uniquement la configuration autorisée en JSON ou CSV", async () => {
    const jsonResponse = await GET(request("json"));
    const json = await jsonResponse.text();
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get("content-type")).toContain("application/json");
    expect(jsonResponse.headers.get("content-disposition")).toContain("attachment;");
    expect(jsonResponse.headers.get("cache-control")).toContain("no-store");
    expect(mocks.collectDiscordAudit).toHaveBeenCalledWith({ guildId: GUILD_ID, token: BOT_TOKEN });
    expect(json).toContain("games");
    expect(json).not.toContain(MEMBER_ID);
    expect(json).not.toContain(BOT_TOKEN);
    expect(json).not.toContain("PRIVATE GUILD DESCRIPTION");
    expect(json).not.toContain("PRIVATE CONFIG TEXT");
    expect(json).not.toContain("PRIVATE AUTO MOD");

    const csvResponse = await GET(request("csv"));
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get("content-type")).toContain("text/csv");
    expect(await csvResponse.text()).toContain('"games"');
    expect(mocks.auditReportToCsv).toHaveBeenCalledOnce();
    expect(mocks.collectDiscordAudit).toHaveBeenCalledTimes(2);

    const addressBarRequest = new NextRequest(`https://gamenight.example/api/admin/discord-audit?format=json`, {
      headers: { "sec-fetch-site": "none" },
    });
    expect((await GET(addressBarRequest)).status).toBe(200);
  });

  it("renvoie une erreur générique sans propager le secret ou le détail Discord", async () => {
    mocks.collectDiscordAudit.mockRejectedValue(new Error(`failed ${BOT_TOKEN} ${MEMBER_ID}`));
    const response = await GET(request("json"));
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).not.toContain(BOT_TOKEN);
    expect(body).not.toContain(MEMBER_ID);
    expect(body).not.toContain(`failed ${BOT_TOKEN} ${MEMBER_ID}`);
  });
});
