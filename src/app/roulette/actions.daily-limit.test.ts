import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plafond de 10 soirées par jour (audit 1.14) — la roulette en « mode instantané » crée une `Session` : le plafond
 * est demandé (`enforceDailyLimit`) et son refus redirige avec un message clair, sans XP ni annonce. Le tirage
 * différé (`spinRoulette`, cron) ne le demande jamais : voir `src/lib/sessions.ts`.
 */
const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  createRouletteResultSession: vi.fn(),
  awardXp: vi.fn(),
  announce: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("@/lib/prisma", () => ({
  prisma: { game: { findUnique: vi.fn(async () => ({ id: "game-1" })) }, user: { findMany: vi.fn(async () => [{ id: "guest" }]) } },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/creation-resume", () => ({ resumeCreation: vi.fn(async () => null) }));
vi.mock("@/lib/creation-intent", () => ({ creationKey: vi.fn(() => "intention-0000000000001"), createOnce: vi.fn(), lockCreationMembers: vi.fn() }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn(), scopedTransactionPrisma: vi.fn(), withCommunity: vi.fn() }));
vi.mock("@/lib/community-isolation", () => ({
  getIsolationScope: vi.fn(),
  creationMemberUserWhere: vi.fn(async () => ({})),
  isCommunityIsolationEnabled: () => false,
}));
vi.mock("@/lib/community-channels", () => ({ pickCreationCommunityId: vi.fn(async () => "c1") }));
vi.mock("@/lib/roulette-dm", () => ({ enqueueRouletteDirectMessages: vi.fn() }));
vi.mock("@/lib/xp-actions", () => ({ awardXp: mocks.awardXp }));
vi.mock("@/lib/badges", () => ({ checkSessionsCreatedBadges: vi.fn() }));
vi.mock("@/lib/discord-announce", () => ({ announceSessionResult: mocks.announce }));
vi.mock("@/lib/discord", () => ({ isRealDiscordFailure: vi.fn(() => false) }));
vi.mock("@/lib/discord-roulette", () => ({ announceRouletteCreated: vi.fn() }));
vi.mock("@/lib/roulette", () => ({ isRouletteProposalOpen: vi.fn(), spinRoulette: vi.fn() }));
vi.mock("@/lib/roulette-veto-db", () => ({ vetoRouletteGame: vi.fn() }));
vi.mock("@/lib/sessions", () => ({ createRouletteResultSession: mocks.createRouletteResultSession }));

import { DailyCreationLimitError } from "@/lib/creation-quota";
import { createSessionFromRouletteAction } from "./actions";

function form(): FormData {
  const fd = new FormData();
  fd.set("creationKey", "intention-0000000000001");
  fd.set("gameId", "game-1");
  fd.set("date", "2030-01-01");
  fd.set("time", "20:00");
  fd.append("participantId", "guest");
  fd.append("participantId", "creator");
  return fd;
}

describe("createSessionFromRouletteAction — plafond de soirées par jour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "creator" });
    mocks.checkRateLimit.mockReturnValue(true);
  });

  it("demande le plafond du jour à la création et le refuse avec un message clair, sans XP ni annonce", async () => {
    mocks.createRouletteResultSession.mockRejectedValue(new DailyCreationLimitError("SESSION"));
    await expect(createSessionFromRouletteAction(form())).rejects.toThrow("REDIRECT:/roulette?error=quota_soirees_jour");
    expect(mocks.createRouletteResultSession).toHaveBeenCalledWith(expect.objectContaining({ createdById: "creator", enforceDailyLimit: true }));
    expect(mocks.awardXp).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("une autre erreur remonte telle quelle", async () => {
    mocks.createRouletteResultSession.mockRejectedValue(new Error("base indisponible"));
    await expect(createSessionFromRouletteAction(form())).rejects.toThrow("base indisponible");
  });
});
