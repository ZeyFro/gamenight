import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

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

it("uses only the active community's XP, not the historical User total", async () => {
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1", xpTotal: 5_000 });
  mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
  mocks.getMemberStats.mockResolvedValue({ xpTotal: 0 });
  mocks.findUnique.mockResolvedValue({ towerLevelsPerFloor: 10 });

  const html = renderToStaticMarkup(await AscensionPage());

  expect(mocks.getMemberStats).toHaveBeenCalledWith("user-1", "community-1");
  expect(html).toContain("Étage 1");
});
