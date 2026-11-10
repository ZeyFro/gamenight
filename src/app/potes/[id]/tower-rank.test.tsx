import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), canView: vi.fn(), find: vi.fn(), tower: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-isolation", () => ({ canViewPote: mocks.canView }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: async () => "community" }));
vi.mock("@/lib/xp-shop", () => ({ getEquippedShopItems: async () => ({ TITLE: null, FRAME: null, COLOR: null }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.find } } }));
vi.mock("@/lib/member-stats", () => ({ getMemberStatsForViewer: async () => ({}), projectUserProgress: (user: unknown) => user }));
vi.mock("@/lib/tower-personal-progress", () => ({ getTowerProgressForProfile: mocks.tower }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); }, notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/components/RankAvatar", () => ({ RankAvatar: () => null }));
vi.mock("@/components/PoteTabs", () => ({ PoteTabs: () => null }));
vi.mock("@/components/PlayerEquipment", () => ({ PlayerEquipment: () => null }));
vi.mock("@/components/GamingIdentifiers", () => ({ GamingIdentifiers: () => null }));
import PoteLayout from "./layout";
const props = { children: null, params: Promise.resolve({ id: "friend" }) };
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "viewer" }); mocks.canView.mockResolvedValue(true);
  // XP très élevée : le rang Tower ne doit dépendre que de la progression Tower renvoyée.
  mocks.find.mockResolvedValue({ id: "friend", discordName: "Pote", discordAvatar: null, color: "#ffffff", xpTotal: 999999, steamId64: null });
  mocks.tower.mockResolvedValue(null);
});
describe("rang The Tower sur la fiche d'un pote", () => {
  it("n'affiche aucun rang Tower quand la Tour est éteinte ou indisponible, quelle que soit l'XP", async () => {
    const html = renderToStaticMarkup(await PoteLayout(props));
    expect(html).not.toContain("Rang The Tower");
    expect(mocks.tower).toHaveBeenCalledWith("viewer", "friend");
  });
  it.each(["Irregular", "Ranker", "High Ranker"] as const)("affiche le rang %s issu des étages gagnés", async rank => {
    mocks.tower.mockResolvedValue({ status: "PROGRESS", floorsClimbed: "30", completedSeasons: 1, rank, next: null });
    const html = renderToStaticMarkup(await PoteLayout(props));
    expect(html).toContain(`title="Rang The Tower : ${rank}"`);
  });
  it("ne lit aucune progression Tower avant les contrôles d'accès", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(PoteLayout(props)).rejects.toThrow("REDIRECT:");
    mocks.user.mockResolvedValue({ id: "viewer" }); mocks.canView.mockResolvedValue(false);
    await expect(PoteLayout(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.tower).not.toHaveBeenCalled();
  });
});
