import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveActiveCommunityId: vi.fn(),
  getMemberStats: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.resolveActiveCommunityId }));
vi.mock("@/lib/member-stats", () => ({ getMemberStats: mocks.getMemberStats }));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findUnique: mocks.findUnique } } }));

import AscensionPage from "./page";
import { TOWER_FLOORS_RESET_NOTICE } from "@/lib/launch-texts";

it("uses only the active community's XP, not the historical User total", async () => {
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1", xpTotal: 5_000 });
  mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
  mocks.getMemberStats.mockResolvedValue({ xpTotal: 0 });
  mocks.findUnique.mockResolvedValue({ towerLevelsPerFloor: 10 });

  const html = renderToStaticMarkup(await AscensionPage());

  expect(mocks.getMemberStats).toHaveBeenCalledWith("user-1", "community-1");
  expect(html).toContain("Étage 1");
});

async function renderAscension() {
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1", xpTotal: 5_000 });
  mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
  mocks.getMemberStats.mockResolvedValue({ xpTotal: 0 });
  mocks.findUnique.mockResolvedValue({ towerLevelsPerFloor: 10 });
  return renderToStaticMarkup(await AscensionPage());
}

describe("phrase décidée le 18/11 sur les étages (V3-12)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("éteint : la phrase est absente", async () => {
    expect(await renderAscension()).not.toContain("repartent de zéro");
  });

  it("allumé : la phrase exacte apparaît une seule fois, sous l'étage XP, le reste du rendu est inchangé", async () => {
    const off = await renderAscension();
    vi.stubEnv("LAUNCH_TEXTS_ENABLED", "true");
    const on = await renderAscension();
    expect(on.split(TOWER_FLOORS_RESET_NOTICE)).toHaveLength(2);
    expect(on.indexOf("Étage 1")).toBeLessThan(on.indexOf(TOWER_FLOORS_RESET_NOTICE));
    expect(on.replace(`<p class="mt-2 text-xs text-muted">${TOWER_FLOORS_RESET_NOTICE}</p>`, "")).toBe(off);
  });
});
