import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveActiveCommunityId: vi.fn(),
  getMemberStats: vi.fn(),
  communityFindUnique: vi.fn(),
  membershipFindUnique: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.resolveActiveCommunityId }));
vi.mock("@/lib/member-stats", () => ({ getMemberStats: mocks.getMemberStats }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findUnique: mocks.communityFindUnique },
    membership: { findUnique: mocks.membershipFindUnique },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/tower-challenges", () => ({
  getTowerChallengeAppealableAttempts: vi.fn().mockResolvedValue({ status: "DISABLED" }),
  getTowerChallengeState: vi.fn().mockResolvedValue({ status: "DISABLED" }),
  getTowerSeasonLeaderboard: vi.fn().mockResolvedValue({ status: "DISABLED" }),
  getTowerTeamDailyStates: vi.fn().mockResolvedValue({ status: "DISABLED" }),
}));
vi.mock("@/lib/tower-challenge-replacement", () => ({ getTowerReplacementOffer: vi.fn().mockResolvedValue({ status: "NONE" }) }));
vi.mock("./actions", () => ({ replaceTowerChallengeAction: vi.fn() }));
vi.mock("@/components/tower/TowerChallengeAppealForm", () => ({ TowerChallengeAppealForm: () => null }));

import TowerPage from "./page";
import { TOWER_FLOORS_RESET_NOTICE } from "@/lib/launch-texts";

async function render() {
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
  mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
  mocks.getMemberStats.mockResolvedValue({ xpTotal: 0 });
  mocks.communityFindUnique.mockResolvedValue({ name: "The Tower", towerLevelsPerFloor: 10, towerChallengesEnabled: true, communityTeamsEnabled: false, discordGuildId: null });
  mocks.membershipFindUnique.mockResolvedValue({ status: "ACTIVE", role: "MEMBER" });
  return renderToStaticMarkup(await TowerPage({ searchParams: Promise.resolve({}) }));
}

afterEach(() => vi.unstubAllEnvs());

describe("/tower : phrase décidée le 18/11 (V3-12)", () => {
  it("éteint : la phrase est absente", async () => {
    expect(await render()).not.toContain("repartent de zéro");
  });

  it("allumé : la phrase exacte apparaît une seule fois, après les deux cartes d'étages", async () => {
    const off = await render();
    vi.stubEnv("LAUNCH_TEXTS_ENABLED", "true");
    const on = await render();
    expect(on.split(TOWER_FLOORS_RESET_NOTICE)).toHaveLength(2);
    expect(on.indexOf("Étages remportés par les défis")).toBeLessThan(on.indexOf(TOWER_FLOORS_RESET_NOTICE));
    // Seul ajout : le paragraphe ; le reste est identique au rendu éteint.
    expect(on.replace(`<p class="text-xs text-muted md:col-span-2">${TOWER_FLOORS_RESET_NOTICE}</p>`, "")).toBe(off);
  });
});
