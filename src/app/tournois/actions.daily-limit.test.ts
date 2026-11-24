import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plafond de 5 tournois par jour (audit 1.14) — comportement PROPRE à `createTournamentAction` : le compteur partagé
 * est consommé DANS la transaction de création (jamais sur un rejeu), et un refus redirige avec un message clair sans
 * rien écrire ni annoncer. Le « 6ᵉ refusé » contre une vraie base est dans `tournament-announce.integration.test.ts`.
 */
const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  tournamentCreate: vi.fn(),
  postToDiscord: vi.fn(),
  tx: {} as Record<string, unknown>,
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/shared-rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { findUnique: vi.fn(async () => ({ name: "Deadlock" })) }, user: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn() }));
vi.mock("@/lib/creation-resume", () => ({ resumeCreation: vi.fn(async () => null) }));
vi.mock("@/lib/creation-intent", () => ({
  creationKey: vi.fn(() => "intention-0000000000001"),
  lockCreationMembers: vi.fn(),
  createOnce: vi.fn(async (_actor: string, _kind: string, _key: string, create: (tx: unknown) => Promise<unknown>) => ({
    result: await create(mocks.tx),
    replayed: false,
  })),
}));
vi.mock("@/lib/community-channels", () => ({
  pickCreationCommunityId: vi.fn(async () => "c1"),
  resolveTournamentAnnounceConfig: vi.fn(async () => null),
}));
vi.mock("@/lib/community-isolation", () => ({ isCommunityIsolationEnabled: () => false, communityMemberUserWhere: vi.fn(async () => ({})) }));
vi.mock("@/lib/community-announcement-required", () => ({ requireCommunityBotAnnouncement: vi.fn() }));
vi.mock("@/lib/tournaments", () => ({ generateBracket: vi.fn(), declareWinner: vi.fn(), cancelTournament: vi.fn(), deleteTournament: vi.fn() }));
vi.mock("@/lib/tournament-announce", () => ({
  enqueueTournamentCreationDeliveries: vi.fn(),
  enqueueTournamentThreadMember: vi.fn(),
  resyncTournamentThreadMembers: vi.fn(),
}));
vi.mock("@/lib/discord", () => ({ postToDiscord: mocks.postToDiscord, ACCENT_COLOR: 0 }));
vi.mock("@/lib/app-url", () => ({ resolveAbsoluteUrl: vi.fn(() => "https://exemple.test/tournois/t1") }));
vi.mock("@/lib/badges", () => ({ checkTournamentBadges: vi.fn() }));
vi.mock("@/lib/tournament-registration", () => ({ registerTournamentParticipant: vi.fn() }));
vi.mock("@/lib/tournament-unregistration", () => ({ unregisterTournamentParticipant: vi.fn() }));
vi.mock("@/lib/tournament-scores", () => ({ isTournamentScoresEnabled: () => false }));

import { createTournamentAction } from "./actions";

function form(): FormData {
  const fd = new FormData();
  fd.set("creationKey", "intention-0000000000001");
  fd.set("name", "Coupe");
  fd.set("gameId", "game-1");
  fd.set("maxPlayers", "4");
  return fd;
}

describe("createTournamentAction — plafond de tournois par jour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "creator" });
    mocks.checkRateLimit.mockReturnValue(true);
    mocks.tx.tournament = { create: mocks.tournamentCreate };
    mocks.tournamentCreate.mockResolvedValue({ id: "t1" });
    mocks.postToDiscord.mockResolvedValue({ ok: true });
  });

  it("sous le plafond : compteur « dailyCreateTournament » (5 / 24 h) consommé avec le client de transaction, tournoi créé", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue(true);
    await expect(createTournamentAction(form())).rejects.toThrow("REDIRECT:/tournois/t1");
    expect(mocks.checkSharedRateLimit).toHaveBeenCalledWith("creator", "dailyCreateTournament", { limit: 5, windowMs: 86_400_000 }, expect.any(Number), mocks.tx);
    expect(mocks.tournamentCreate).toHaveBeenCalledTimes(1);
  });

  it("au-delà du plafond : redirection avec le code de quota, aucun tournoi, aucune annonce", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue(false);
    await expect(createTournamentAction(form())).rejects.toThrow("REDIRECT:/tournois/creer?error=quota_tournois_jour");
    expect(mocks.tournamentCreate).not.toHaveBeenCalled();
    expect(mocks.postToDiscord).not.toHaveBeenCalled();
  });

  it("une erreur de base du compteur remonte telle quelle", async () => {
    mocks.checkSharedRateLimit.mockRejectedValue(new Error("base indisponible"));
    await expect(createTournamentAction(form())).rejects.toThrow("base indisponible");
    expect(mocks.tournamentCreate).not.toHaveBeenCalled();
  });
});
