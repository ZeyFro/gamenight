import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  event: vi.fn(),
  delivery: vi.fn(),
  application: vi.fn(),
  user: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: mocks.event, enqueueDelivery: mocks.delivery }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: () => ({ teamApplication: { findFirst: mocks.application } }) }));

import { TEAM_APPLICATION_NOTIFY, enqueueTeamApplicationNotice, teamApplicationNoticeResolver } from "./team-application-notify";

const createdAt = new Date("2026-12-02T10:00:00Z");
const stamp = createdAt.getTime();

function enableAll() {
  vi.stubEnv("TEAM_RECRUITERS_ENABLED", "true");
  vi.stubEnv("TEAM_APPLICATIONS_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "gamenight.example");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.event.mockResolvedValue({ id: "event-1" });
  mocks.delivery.mockResolvedValue({ id: "delivery-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("enqueueTeamApplicationNotice", () => {
  const base = { communityId: "c1", teamId: "t1", applicationId: "a1", kind: "new" as const, createdAt, recipientIds: ["captain", "recruiter", "captain"] };

  it("ne lit ni n'écrit rien tant que les verrous ne sont pas tous ouverts", async () => {
    expect(await enqueueTeamApplicationNotice(base)).toBe("disabled");
    vi.stubEnv("TEAM_RECRUITERS_ENABLED", "true");
    expect(await enqueueTeamApplicationNotice(base)).toBe("disabled");
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.delivery).not.toHaveBeenCalled();
  });

  it("un événement ADMIN et un MP BOT par destinataire distinct, jamais d'autre canal", async () => {
    enableAll();
    expect(await enqueueTeamApplicationNotice(base)).toBe("queued");
    expect(mocks.event).toHaveBeenCalledWith({
      communityId: "c1", category: "ADMIN", eventType: TEAM_APPLICATION_NOTIFY, sourceId: "a1",
      occurrence: `new:${stamp}`, payload: { kind: "new", teamId: "t1" },
    });
    expect(mocks.delivery).toHaveBeenCalledTimes(2);
    expect(mocks.delivery.mock.calls.map(([call]) => call)).toEqual([
      expect.objectContaining({ channel: "DISCORD_DM", transport: "BOT", operation: "SEND", recipientKey: "user:captain", targetSlot: `account:captain:TEAM_APPLICATION:a1:new:${stamp}` }),
      expect.objectContaining({ channel: "DISCORD_DM", transport: "BOT", operation: "SEND", recipientKey: "user:recruiter", targetSlot: `account:recruiter:TEAM_APPLICATION:a1:new:${stamp}` }),
    ]);
  });

  it("aucun destinataire : rien n'est écrit", async () => {
    enableAll();
    expect(await enqueueTeamApplicationNotice({ ...base, recipientIds: [] })).toBe("none");
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("un échec d'enfilage est journalisé et ne casse pas l'action métier", async () => {
    enableAll();
    mocks.event.mockRejectedValue(new Error("boom"));
    expect(await enqueueTeamApplicationNotice(base)).toBe("none");
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});

describe("teamApplicationNoticeResolver", () => {
  const event = { category: "ADMIN", eventType: TEAM_APPLICATION_NOTIFY, sourceId: "a1", communityId: "c1", payload: { kind: "new", teamId: "t1" } };
  const delivery = (recipient: string, kind = "new") => ({
    operation: "SEND", channel: "DISCORD_DM", transport: "BOT", recipientKey: `user:${recipient}`,
    targetSlot: `account:${recipient}:TEAM_APPLICATION:a1:${kind}:${stamp}`,
  });
  const resolve = (ev: object, del: object) => teamApplicationNoticeResolver.resolve({ event: ev, delivery: del, now: new Date() } as never);
  const pendingApplication = {
    createdAt, message: "Salut @everyone", applicant: { discordName: "Candidat" },
    team: { name: "Les Tours", captainId: "captain", createdById: "creator", recruiters: [{ userId: "recruiter" }] },
  };

  beforeEach(() => {
    mocks.application.mockResolvedValue(pendingApplication);
    mocks.user.mockResolvedValue({ discordId: "100000000000000099", memberships: [{ id: "m" }] });
  });

  it("verrous fermés : non configuré", async () => {
    expect(await resolve(event, delivery("captain"))).toEqual({ eligible: false, reason: "not_configured" });
  });

  it("envoie un MP au capitaine, sans aucune mention, avec le message cité", async () => {
    enableAll();
    const result = await resolve(event, delivery("captain"));
    expect(result).toMatchObject({ eligible: true, action: { kind: "send_direct_message", userId: "100000000000000099", message: { allowedMentions: { parse: [] } } } });
    const description = (result as { action: { message: { embeds: { description: string }[] } } }).action.message.embeds[0].description;
    expect(description).toContain("Candidat");
    expect(description).toContain("> Salut @everyone");
    expect(description).toContain("https://gamenight.example/equipes/candidatures");
  });

  it("envoie aussi au recruteur, avec le libellé de relance", async () => {
    enableAll();
    const result = await resolve({ ...event, payload: { kind: "reminder", teamId: "t1" } }, delivery("recruiter", "reminder"));
    expect(result).toMatchObject({ eligible: true });
    expect((result as { action: { message: { embeds: { title: string }[] } } }).action.message.embeds[0].title).toContain("Rappel");
  });

  it("refuse un destinataire qui n'est ni capitaine ni recruteur (membre ordinaire, candidat)", async () => {
    enableAll();
    expect(await resolve(event, delivery("member"))).toEqual({ eligible: false, reason: "expired" });
    expect(await resolve(event, delivery("applicant"))).toEqual({ eligible: false, reason: "expired" });
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("refuse une candidature plus en attente ou renvoyée depuis (créneau périmé)", async () => {
    enableAll();
    mocks.application.mockResolvedValue(null);
    expect(await resolve(event, delivery("captain"))).toEqual({ eligible: false, reason: "expired" });
    mocks.application.mockResolvedValue({ ...pendingApplication, createdAt: new Date(stamp + 1000) });
    expect(await resolve(event, delivery("captain"))).toEqual({ eligible: false, reason: "expired" });
  });

  it("refuse un destinataire qui n'est plus membre actif", async () => {
    enableAll();
    mocks.user.mockResolvedValue({ discordId: "1", memberships: [] });
    expect(await resolve(event, delivery("captain"))).toEqual({ eligible: false, reason: "expired" });
  });

  it("refuse tout événement ou livraison d'une autre forme", async () => {
    enableAll();
    expect(await resolve({ ...event, eventType: "AUTRE" }, delivery("captain"))).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve({ ...event, payload: { kind: "x" } }, delivery("captain"))).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve(event, { ...delivery("captain"), channel: "DISCORD_CHANNEL" })).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve({ ...event, communityId: null }, delivery("captain"))).toEqual({ eligible: false, reason: "unresolvable" });
  });
});
