import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), canView: vi.fn(), find: vi.fn(), presentation: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-isolation", () => ({ canViewPote: mocks.canView, getPoteAccess: async (...args: unknown[]) => ((await mocks.canView(...args)) ? "friend" : "none") }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: async () => "community" }));
vi.mock("@/lib/xp-shop", () => ({ getEquippedShopItems: async () => ({ TITLE: null, FRAME: null, COLOR: null }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.find } } }));
vi.mock("@/lib/member-stats", () => ({ getMemberStatsForViewer: async () => ({}), projectUserProgress: (user: unknown) => user }));
vi.mock("@/lib/profile-customization", () => ({ loadProfilePresentation: mocks.presentation }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); }, notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/components/RankAvatar", () => ({ RankAvatar: ({ frameFxId }: { frameFxId?: string }) => <i data-frame={frameFxId ?? ""} /> }));
vi.mock("@/components/PoteTabs", () => ({ PoteTabs: () => null }));
import PoteLayout from "./layout";
import { getProfileCosmetic } from "@/lib/profile-cosmetics";

const props = { children: null, params: Promise.resolve({ id: "friend" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.canView.mockResolvedValue(true);
  mocks.presentation.mockResolvedValue(null);
  mocks.find.mockResolvedValue({ id: "friend", discordName: "Pote", discordAvatar: null, color: "#ffffff", xpTotal: 0, steamId64: null, inputDevices: [], availablePlatforms: [], microphoneAvailable: false });
});

describe("fiche d'un pote : personnalisation", () => {
  it("profil masqué ou inaccessible : 404 sans lire ni la fiche ni la personnalisation", async () => {
    mocks.canView.mockResolvedValue(false);
    await expect(PoteLayout(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.presentation).not.toHaveBeenCalled();
  });

  it("sans personnalisation (flag éteint) : rendu historique, aucune classe pc-", async () => {
    const html = renderToStaticMarkup(await PoteLayout(props));
    expect(html).toContain("Pote");
    expect(html).not.toContain("pc-");
  });

  it("charge la personnalisation seulement après le contrôle d'accès et l'affiche dans l'en-tête", async () => {
    mocks.presentation.mockResolvedValue({
      effectsEnabled: false, nameStyle: getProfileCosmetic("name-gold"), cardTheme: getProfileCosmetic("card-ember"), frameFx: getProfileCosmetic("frame-pulse"),
      bannerFx: null, effect: null, title: getProfileCosmetic("ptitle-challenger"), entrance: null,
      showcase: [{ id: "a", name: "Badge A", icon: "★" }, { id: "b", name: "Badge B", icon: "★" }, { id: "c", name: "Badge C", icon: "★" }],
    });
    const html = renderToStaticMarkup(await PoteLayout(props));
    expect(mocks.presentation).toHaveBeenCalledWith("viewer", "friend");
    expect(mocks.canView.mock.invocationCallOrder[0]).toBeLessThan(mocks.presentation.mock.invocationCallOrder[0]);
    expect(html).toContain("pc-name-gold");
    expect(html).toContain("pc-card-ember");
    expect(html).toContain('data-pc-effects="off"');
    expect(html).toContain('data-frame="frame-pulse"');
    expect(html).toContain("Relève-défis");
    expect(html).toContain("Badge B");
  });
});
