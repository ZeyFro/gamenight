import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), canView: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-isolation", () => ({ canViewPote: mocks.canView }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: async () => "community" }));
vi.mock("@/lib/xp-shop", () => ({ getEquippedShopItems: async () => ({ TITLE: null, FRAME: null, COLOR: null }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.find } } }));
vi.mock("@/lib/member-stats", () => ({ getMemberStatsForViewer: async () => ({}), projectUserProgress: (user: unknown) => user }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); }, notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/components/RankAvatar", () => ({ RankAvatar: () => null }));
vi.mock("@/components/PoteTabs", () => ({ PoteTabs: () => null }));
import PoteLayout from "./layout";
const props = { children: null, params: Promise.resolve({ id: "friend" }) };
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "viewer" }); mocks.canView.mockResolvedValue(true);
  mocks.find.mockResolvedValue({ id: "friend", discordName: "Pote", discordAvatar: null, color: "#ffffff", xpTotal: 0, steamId64: null, inputDevices: ["CONTROLLER"], availablePlatforms: ["WINDOWS"], microphoneAvailable: false });
});
describe("matériel sur la fiche autorisée", () => {
  it("refuse les visiteurs anonymes et les profils inaccessibles avant lecture", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(PoteLayout(props)).rejects.toThrow("REDIRECT:");
    mocks.user.mockResolvedValue({ id: "viewer" }); mocks.canView.mockResolvedValue(false);
    await expect(PoteLayout(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("affiche le matériel déclaré après contrôle d'accès", async () => {
    const html = renderToStaticMarkup(await PoteLayout(props));
    expect(html).toContain("Manette"); expect(html).toContain("Windows"); expect(html).toContain("Non disponible");
    expect(mocks.canView).toHaveBeenCalledWith("viewer", "friend");
  });
});
