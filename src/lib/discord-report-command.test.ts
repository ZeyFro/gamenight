import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  communityUnique: vi.fn(),
  user: vi.fn(),
  report: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  event: vi.fn(),
  delivery: vi.fn(),
  edit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { community: { findFirst: mocks.community, findUnique: mocks.communityUnique }, user: { findUnique: mocks.user } },
}));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: () => ({ moderationReport: mocks.report }) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: mocks.event, enqueueDelivery: mocks.delivery }));
vi.mock("@/lib/discord-rest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discord-rest")>()),
  editSetupResponse: mocks.edit,
}));

import {
  enqueueReportTicket,
  handleSignedReportInteraction,
  quoteExcerpt,
  reportCommandEnabled,
  reportExcerpt,
  reportQueueReady,
  reportTicketResolver,
  submitModerationReport,
} from "./discord-report-command";

const GUILD = "100000000000000001";
const APP = "100000000000000002";
const REPORTER = "100000000000000022";
const AUTHOR = "100000000000000033";
const CHANNEL = "100000000000000044";
const MESSAGE = "100000000000000055";
const STAFF = "100000000000000066";
const message = { messageId: MESSAGE, channelId: CHANNEL, authorDiscordId: AUTHOR, authorIsBot: false, content: "Un message @everyone", attachmentCount: 0 };

function openAll() {
  vi.stubEnv("DISCORD_REPORT_COMMAND_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
  vi.stubEnv("DISCORD_REPORT_STAFF_CHANNEL_ID", STAFF);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.community.mockResolvedValue({ id: "c1" });
  mocks.user.mockResolvedValue({ id: "u1", memberships: [{ id: "m1" }] });
  mocks.report.count.mockResolvedValue(0);
  mocks.report.findFirst.mockResolvedValue(null);
  mocks.report.create.mockResolvedValue({ id: "rep-1" });
  mocks.report.updateMany.mockResolvedValue({ count: 1 });
  mocks.event.mockResolvedValue({ id: "ev-1" });
  mocks.delivery.mockResolvedValue({ id: "d-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("verrous", () => {
  it("fermé sans la valeur exacte `true`, et file fermée sans executor, bot ou salon staff", () => {
    expect(reportCommandEnabled({ DISCORD_REPORT_COMMAND_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(reportQueueReady({ DISCORD_REPORT_COMMAND_ENABLED: "true", NOTIFICATION_EXECUTOR_ENABLED: "true", DISCORD_BOT_TOKEN: "x" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(reportQueueReady({ DISCORD_REPORT_COMMAND_ENABLED: "true", NOTIFICATION_EXECUTOR_ENABLED: "true", DISCORD_BOT_TOKEN: "x", DISCORD_REPORT_STAFF_CHANNEL_ID: STAFF } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("submitModerationReport", () => {
  it("désactivé : rien n'est lu ni écrit", async () => {
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("disabled");
    expect(mocks.community).not.toHaveBeenCalled();
    expect(mocks.report.create).not.toHaveBeenCalled();
  });

  it("enregistre le signalement, enfile le ticket et marque la date d'enfilage", async () => {
    openAll();
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("recorded");
    expect(mocks.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          communityId: "c1",
          messageUrl: `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`,
          reporterDiscordId: REPORTER,
          authorDiscordId: AUTHOR,
        }),
      })
    );
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ category: "ADMIN", eventType: "MODERATION_REPORT", sourceId: "rep-1" }));
    expect(mocks.delivery).toHaveBeenCalledWith(expect.objectContaining({ transport: "BOT", targetSlot: `${GUILD}:ADMIN:rep-1:report-ticket` }));
    expect(mocks.report.updateMany).toHaveBeenCalled();
  });

  it("sans salon staff : signalement enregistré, aucun ticket", async () => {
    openAll();
    vi.stubEnv("DISCORD_REPORT_STAFF_CHANNEL_ID", "");
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("recorded");
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("n'applique AUCUNE sanction : aucun appel Discord d'écriture, seulement la file", async () => {
    openAll();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("refuse son propre message, un message de bot, un compte non membre", async () => {
    openAll();
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: AUTHOR, message })).toBe("own_message");
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message: { ...message, authorIsBot: true } })).toBe("bot_message");
    mocks.user.mockResolvedValueOnce({ id: "u1", memberships: [] });
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("not_member");
    mocks.community.mockResolvedValueOnce(null);
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("not_member");
    expect(mocks.report.create).not.toHaveBeenCalled();
  });

  it("limite à 5 par heure et par membre", async () => {
    openAll();
    mocks.report.count.mockResolvedValue(5);
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("rate_limited");
    expect(mocks.report.create).not.toHaveBeenCalled();
  });

  it("doublon (relecture ou unicité P2002) : pas de second ticket", async () => {
    openAll();
    mocks.report.findFirst.mockResolvedValueOnce({ id: "old" });
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("duplicate");
    mocks.report.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("duplicate");
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("table absente : indisponible, sans exception", async () => {
    openAll();
    mocks.report.count.mockRejectedValueOnce(Object.assign(new Error("does not exist"), { code: "P2021" }));
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("unavailable");
  });

  it("un échec d'enfilage laisse le signalement enregistré", async () => {
    openAll();
    mocks.event.mockRejectedValueOnce(new Error("db"));
    expect(await submitModerationReport({ guildId: GUILD, reporterDiscordId: REPORTER, message })).toBe("recorded");
    expect(mocks.report.updateMany).not.toHaveBeenCalled();
  });
});

describe("extrait", () => {
  it("borne l'extrait à 500 caractères", () => {
    expect(reportExcerpt("x".repeat(900))).toHaveLength(500);
    expect(reportExcerpt("  court  ")).toBe("court");
  });
  it("neutralise les mentions et les accents graves dans la citation", () => {
    const quoted = quoteExcerpt("salut @everyone `code`\nligne 2");
    expect(quoted).not.toContain("@everyone");
    expect(quoted).not.toContain("`");
    expect(quoted.split("\n")).toHaveLength(2);
    expect(quoteExcerpt("")).toContain("sans texte");
  });
});

describe("enqueueReportTicket", () => {
  it("renvoie false si la file échoue", async () => {
    mocks.event.mockRejectedValueOnce(new Error("db"));
    expect(await enqueueReportTicket({ reportId: "r", communityId: "c1", guildId: GUILD, now: new Date() })).toBe(false);
  });
});

describe("reportTicketResolver", () => {
  const event = { category: "ADMIN", eventType: "MODERATION_REPORT", sourceId: "rep-1", communityId: "c1" };
  const delivery = { operation: "SEND", channel: "DISCORD_CHANNEL", transport: "BOT", recipientKey: "report:rep-1", targetSlot: `${GUILD}:ADMIN:rep-1:report-ticket` };
  const row = { messageUrl: "https://discord.com/channels/1/2/3", channelId: CHANNEL, authorDiscordId: AUTHOR, reporterDiscordId: REPORTER, excerpt: "salut @everyone", attachmentCount: 2, closedAt: null };
  const resolve = (d = delivery) => reportTicketResolver.resolve({ event, delivery: d } as never);

  beforeEach(() => {
    mocks.communityUnique.mockResolvedValue({ status: "ACTIVE", discordGuildId: GUILD });
    mocks.report.findFirst.mockResolvedValue(row);
  });

  it("poste un ticket dans le salon staff, sans aucune mention", async () => {
    openAll();
    const result = await resolve();
    expect(result).toMatchObject({ eligible: true, action: { kind: "send_channel_message", channelId: STAFF, message: { allowedMentions: { parse: [] } } } });
    const json = JSON.stringify(result);
    expect(json).toContain("Aucune sanction automatique");
    expect(json).not.toContain("@everyone");
  });

  it("refuse flag fermé, salon absent, signalement clos ou slot altéré", async () => {
    expect(await resolve()).toEqual({ eligible: false, reason: "not_configured" });
    vi.stubEnv("DISCORD_REPORT_COMMAND_ENABLED", "true");
    expect(await resolve()).toEqual({ eligible: false, reason: "configuration_unavailable" });
    openAll();
    mocks.report.findFirst.mockResolvedValueOnce({ ...row, closedAt: new Date() });
    expect(await resolve()).toEqual({ eligible: false, reason: "expired" });
    expect(await resolve({ ...delivery, targetSlot: "autre" })).toEqual({ eligible: false, reason: "unresolvable" });
  });
});

describe("handleSignedReportInteraction", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    type: 2,
    application_id: APP,
    token: "tok",
    guild_id: GUILD,
    member: { user: { id: REPORTER } },
    data: {
      name: "Signaler",
      type: 3,
      target_id: MESSAGE,
      resolved: { messages: { [MESSAGE]: { id: MESSAGE, channel_id: CHANNEL, content: "bonjour", author: { id: AUTHOR }, attachments: [] } } },
    },
    ...overrides,
  });
  const stamp = () => String(Math.floor(Date.now() / 1000));

  beforeEach(() => vi.stubEnv("DISCORD_CLIENT_ID", APP));

  it("ACK éphémère immédiat, puis réponse privée après traitement", async () => {
    openAll();
    mocks.edit.mockResolvedValue({ ok: true, data: {} });
    const out = handleSignedReportInteraction(body(), stamp());
    expect(out).toMatchObject({ status: 200, body: { type: 5, data: { flags: 64 } } });
    expect(mocks.report.create).not.toHaveBeenCalled();
    await out.runReport!();
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("transmis en privé au staff") }));
  });

  it("rejette un corps invalide, périmé, d'une autre application ou sans message résolu", () => {
    expect(handleSignedReportInteraction({ type: 2 }, stamp()).status).toBe(400);
    expect(handleSignedReportInteraction(body(), String(Math.floor(Date.now() / 1000) - 1000)).status).toBe(400);
    expect(handleSignedReportInteraction(body({ application_id: "100000000000000099" }), stamp()).status).toBe(400);
    const noMessage = body();
    (noMessage.data as { resolved: { messages: object } }).resolved.messages = {};
    expect(handleSignedReportInteraction(noMessage, stamp()).status).toBe(400);
  });
});

describe("manifeste", () => {
  it("déclare « Signaler » en commande de message (type 3), sans permission par défaut", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../scripts/discord-commands.json", import.meta.url), "utf8")) as Array<Record<string, unknown>>;
    expect(manifest.find((command) => command.name === "Signaler")).toMatchObject({ type: 3, contexts: [0], integration_types: [0] });
  });

  it("le validateur d'enregistrement accepte une commande de message et refuse description ou options", async () => {
    const { validateCommand } = (await import("../../scripts/register-tower-guild-commands.mjs")) as { validateCommand: (c: unknown) => string[] };
    expect(validateCommand({ name: "Signaler", type: 3, default_member_permissions: null })).toEqual([]);
    expect(validateCommand({ name: "Signaler", type: 3, description: "x" })).not.toEqual([]);
    expect(validateCommand({ name: "Signaler", type: 3, options: [] })).not.toEqual([]);
    expect(validateCommand({ name: "Signaler", type: 2 })).not.toEqual([]);
  });
});
