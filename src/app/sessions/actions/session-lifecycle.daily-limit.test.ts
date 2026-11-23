import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plafond de 10 soirées par jour (audit 1.14) — comportement PROPRE à `createSession` : le compteur partagé est
 * consommé DANS la transaction de création, avant toute écriture ; au-delà, redirection avec un message clair et
 * ni soirée, ni XP, ni notification. Le « 11ᵉ refusé » contre une vraie base est dans
 * `session-lifecycle.integration.test.ts`.
 */
const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  createVotingSession: vi.fn(),
  awardXp: vi.fn(),
  announce: vi.fn(),
  tx: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("@/lib/shared-rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn() }));
vi.mock("@/lib/creation-resume", () => ({ resumeCreation: vi.fn(async () => null) }));
vi.mock("@/lib/creation-intent", () => ({
  creationKey: vi.fn(() => "intention-0000000000001"),
  createOnce: vi.fn(async (_actor: string, _kind: string, _key: string, create: (tx: unknown) => Promise<unknown>) => ({
    result: await create(mocks.tx),
    replayed: false,
  })),
}));
vi.mock("@/lib/session-creation", () => ({ createVotingSessionInTransaction: mocks.createVotingSession }));
vi.mock("@/lib/session-schedule", () => ({
  resolveSessionSchedule: vi.fn(() => ({
    ok: true,
    date: new Date("2030-01-01T20:00:00Z"),
    votingDeadline: new Date("2030-01-01T14:00:00Z"),
    deadlineAdjusted: false,
  })),
}));
vi.mock("@/lib/community-channels", () => ({
  pickCreationCommunityAndRecipients: vi.fn(async () => ({ communityId: "c1", notifiedUserIds: ["guest"] })),
  isSessionAnnounceViaBotEnabledFor: vi.fn(async () => false),
}));
vi.mock("@/lib/community-isolation", () => ({ isCommunityIsolationEnabled: () => false }));
vi.mock("@/lib/community-announcement-required", () => ({ requireCommunityBotAnnouncement: vi.fn() }));
vi.mock("@/lib/community-teams", () => ({ canAttachSessionToTeam: vi.fn(async () => true) }));
vi.mock("@/lib/default-community", () => ({ getDefaultCommunityId: vi.fn(async () => "c1") }));
vi.mock("@/lib/session-gallery", () => ({ deleteSessionGalleryBlobs: vi.fn() }));
vi.mock("@/lib/discord-session-created", () => ({ announceSessionCreated: mocks.announce }));
vi.mock("@/lib/discord-session-modified", () => ({ announceSessionModified: vi.fn() }));
vi.mock("@/lib/discord", () => ({ isRealDiscordFailure: vi.fn(() => false) }));
vi.mock("@/lib/session-announce", () => ({ enqueueSessionThreadDelete: vi.fn() }));
vi.mock("@/lib/xp-actions", () => ({ awardXp: mocks.awardXp }));
vi.mock("@/lib/sessions", () => ({
  cancelSession: vi.fn(),
  cancelRecurringSessions: vi.fn(),
  closeSession: vi.fn(),
  markSessionDone: vi.fn(),
  resendSessionAnnouncement: vi.fn(),
  updateSessionSchedule: vi.fn(),
}));
vi.mock("@/lib/badges", () => ({ checkSessionsCreatedBadges: vi.fn() }));

import { createSession } from "./session-lifecycle";

function form(): FormData {
  const fd = new FormData();
  fd.set("creationKey", "intention-0000000000001");
  fd.set("date", "2030-01-01");
  fd.set("time", "20:00");
  fd.append("notifyUserId", "guest");
  return fd;
}

describe("createSession — plafond de soirées par jour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "creator" });
    mocks.checkRateLimit.mockReturnValue(true);
    mocks.createVotingSession.mockResolvedValue({ id: "s1", communityId: "c1" });
    mocks.awardXp.mockResolvedValue({ leveledUp: false });
  });

  it("sous le plafond : le compteur partagé « dailyCreateSession » (10 / 24 h) est consommé avec le client de transaction, puis la soirée est créée", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue(true);
    await expect(createSession(form())).rejects.toThrow("REDIRECT:/sessions/s1");
    expect(mocks.checkSharedRateLimit).toHaveBeenCalledWith("creator", "dailyCreateSession", { limit: 10, windowMs: 86_400_000 }, expect.any(Number), mocks.tx);
    expect(mocks.createVotingSession).toHaveBeenCalledTimes(1);
  });

  it("au-delà du plafond : redirection avec le code de quota, aucune soirée, aucun XP, aucune annonce", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue(false);
    await expect(createSession(form())).rejects.toThrow("REDIRECT:/sessions?error=quota_soirees_jour");
    expect(mocks.createVotingSession).not.toHaveBeenCalled();
    expect(mocks.awardXp).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("une erreur de base du compteur remonte (jamais un refus silencieux ni une création sans compteur)", async () => {
    mocks.checkSharedRateLimit.mockRejectedValue(new Error("base indisponible"));
    await expect(createSession(form())).rejects.toThrow("base indisponible");
    expect(mocks.createVotingSession).not.toHaveBeenCalled();
  });
});
