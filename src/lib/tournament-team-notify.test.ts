import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ event: vi.fn(), delivery: vi.fn(), tournament: vi.fn(), entry: vi.fn(), match: vi.fn(), user: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: mocks.event, enqueueDelivery: mocks.delivery }));
vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({ tournament: { findFirst: mocks.tournament }, tournamentTeamEntry: { findFirst: mocks.entry }, tournamentMatch: { findFirst: mocks.match } }),
}));

import { TOURNAMENT_TEAM_NOTIFY, enqueueTeamTournamentNotice, teamTournamentNoticeResolver, teamTournamentNoticesEnabled } from "./tournament-team-notify";

function enableAll() {
  vi.stubEnv("TOURNAMENT_TEAMS_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "gamenight.example");
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.event.mockResolvedValue({ id: "e1" });
  mocks.delivery.mockResolvedValue({ id: "d1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("verrous et enfilage", () => {
  it("exige drapeau, executor et jeton du bot", () => {
    const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
    expect(teamTournamentNoticesEnabled(env({}))).toBe(false);
    expect(teamTournamentNoticesEnabled(env({ TOURNAMENT_TEAMS_ENABLED: "true", NOTIFICATION_EXECUTOR_ENABLED: "true" }))).toBe(false);
    expect(teamTournamentNoticesEnabled(env({ TOURNAMENT_TEAMS_ENABLED: "true", NOTIFICATION_EXECUTOR_ENABLED: "true", DISCORD_BOT_TOKEN: "x" }))).toBe(true);
  });
  it("fermé : rien n'est écrit ; ouvert : un MP par destinataire distinct", async () => {
    const input = { communityId: "c", tournamentId: "t", kind: "dispute" as const, key: "k", recipientIds: ["o", "o"], matchId: "m" };
    expect(await enqueueTeamTournamentNotice(input)).toBe("disabled");
    expect(mocks.event).not.toHaveBeenCalled();
    enableAll();
    expect(await enqueueTeamTournamentNotice(input)).toBe("queued");
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
    expect(mocks.delivery).toHaveBeenCalledWith(expect.objectContaining({ channel: "DISCORD_DM", transport: "BOT", recipientKey: "user:o", targetSlot: "account:o:TOURNAMENT_TEAM:t:dispute:k" }));
  });
  it("un échec est journalisé sans casser l'action", async () => {
    enableAll();
    mocks.event.mockRejectedValue(new Error("boom"));
    expect(await enqueueTeamTournamentNotice({ communityId: "c", tournamentId: "t", kind: "invited", key: "k", recipientIds: ["x"], teamId: "tm" })).toBe("none");
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});

describe("résolveur", () => {
  const event = (payload: object) => ({ category: "ADMIN", eventType: TOURNAMENT_TEAM_NOTIFY, sourceId: "t", communityId: "c", payload });
  const delivery = (recipient: string, kind: string, key = "k") => ({ operation: "SEND", channel: "DISCORD_DM", transport: "BOT", recipientKey: `user:${recipient}`, targetSlot: `account:${recipient}:TOURNAMENT_TEAM:t:${kind}:${key}` });
  const resolve = (ev: object, del: object) => teamTournamentNoticeResolver.resolve({ event: ev, delivery: del, now: new Date() } as never);
  const captainTeam = (captain: string) => ({ name: "Équipe A", createdById: captain, captainId: captain, createdBy: { memberships: [{ id: "m" }] }, captain: { memberships: [{ id: "m" }] }, members: [{ userId: captain }] });

  beforeEach(() => {
    mocks.tournament.mockResolvedValue({ id: "t", name: "Coupe", status: "IN_PROGRESS", createdById: "org" });
    mocks.user.mockResolvedValue({ discordId: "100000000000000001", memberships: [{ id: "m" }] });
  });

  it("verrous fermés : non configuré", async () => {
    expect(await resolve(event({ kind: "dispute", key: "k", matchId: "m" }), delivery("org", "dispute"))).toEqual({ eligible: false, reason: "not_configured" });
  });

  it("invitation : seulement au capitaine, tant qu'elle est en attente", async () => {
    enableAll();
    mocks.tournament.mockResolvedValue({ id: "t", name: "Coupe", status: "REGISTRATION", createdById: "org" });
    mocks.entry.mockResolvedValue({ status: "INVITED", team: captainTeam("cap") });
    const ev = event({ kind: "invited", key: "k", teamId: "tm" });
    const ok = await resolve(ev, delivery("cap", "invited"));
    expect(ok).toMatchObject({ eligible: true, action: { kind: "send_direct_message", message: { allowedMentions: { parse: [] } } } });
    expect(await resolve(ev, delivery("other", "invited"))).toEqual({ eligible: false, reason: "expired" });
    mocks.entry.mockResolvedValue({ status: "REGISTERED", team: captainTeam("cap") });
    expect(await resolve(ev, delivery("cap", "invited"))).toEqual({ eligible: false, reason: "expired" });
  });

  it("désaccord : seulement à l'organisateur, match encore ouvert et deux déclarations", async () => {
    enableAll();
    const ev = event({ kind: "dispute", key: "k", matchId: "m" });
    const match = { completedAt: null, team1Id: "x", team2Id: "y", reports: [{ teamId: "x" }, { teamId: "y" }], team1: { name: "A", registeredEntry: null }, team2: { name: "B", registeredEntry: null } };
    mocks.match.mockResolvedValue(match);
    expect(await resolve(ev, delivery("org", "dispute"))).toMatchObject({ eligible: true });
    expect(await resolve(ev, delivery("cap", "dispute"))).toEqual({ eligible: false, reason: "expired" });
    mocks.match.mockResolvedValue({ ...match, completedAt: new Date() });
    expect(await resolve(ev, delivery("org", "dispute"))).toEqual({ eligible: false, reason: "expired" });
  });

  it("confirmation : au capitaine adverse qui n'a pas déclaré, seulement si une seule déclaration existe", async () => {
    enableAll();
    const ev = event({ kind: "report_pending", key: "k", matchId: "m" });
    const match = {
      completedAt: null, team1Id: "x", team2Id: "y", reports: [{ teamId: "x" }],
      team1: { name: "A", registeredEntry: { team: captainTeam("capA") } }, team2: { name: "B", registeredEntry: { team: captainTeam("capB") } },
    };
    mocks.match.mockResolvedValue(match);
    expect(await resolve(ev, delivery("capB", "report_pending"))).toMatchObject({ eligible: true });
    expect(await resolve(ev, delivery("capA", "report_pending"))).toEqual({ eligible: false, reason: "expired" });
    mocks.match.mockResolvedValue({ ...match, reports: [{ teamId: "x" }, { teamId: "y" }] });
    expect(await resolve(ev, delivery("capB", "report_pending"))).toEqual({ eligible: false, reason: "expired" });
  });

  it("refuse une livraison dont le créneau ne correspond pas", async () => {
    enableAll();
    expect(await resolve(event({ kind: "dispute", key: "k", matchId: "m" }), delivery("org", "dispute", "autre"))).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve(event({ kind: "bogus", key: "k" }), delivery("org", "dispute"))).toEqual({ eligible: false, reason: "unresolvable" });
  });
});
