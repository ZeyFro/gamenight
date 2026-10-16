import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GamingIdentifiers } from "@/components/GamingIdentifiers";

const mocks = vi.hoisted(() => ({ user: vi.fn(), canView: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-isolation", () => ({ canViewPote: mocks.canView }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.find } } }));
vi.mock("@/lib/member-stats", () => ({ getMemberStatsForViewer: async () => ({}), projectUserProgress: (user: unknown) => user }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Error(`REDIRECT:${url}`); },
  notFound: () => { throw Error("NOT_FOUND"); },
}));
vi.mock("@/components/RankAvatar", () => ({ RankAvatar: () => null }));
vi.mock("@/components/PoteTabs", () => ({ PoteTabs: () => null }));

import PoteLayout from "./layout";
const identifiers = { steamId64: "76561198000000000", psnId: "<script>pseudo</script>", xboxGamertag: "Xbox#1234", switchFriendCode: null, epicDisplayName: null, battleTag: "Nom#1234" };
const props = { children: null, params: Promise.resolve({ id: "friend" }) };

beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "viewer" }); mocks.canView.mockResolvedValue(true);
  mocks.find.mockResolvedValue({ ...identifiers, id: "friend", discordName: "Pote", discordAvatar: null, color: "#ffffff", xpTotal: 0 });
});

describe("visibilité des identifiants sur la fiche d'un pote", () => {
  it("ne lit aucun identifiant avant l'autorisation du profil", async () => {
    mocks.canView.mockResolvedValue(false);
    await expect(PoteLayout(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("refuse un visiteur non authentifié avant toute lecture", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(PoteLayout(props)).rejects.toThrow("REDIRECT:");
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("affiche les identifiants renseignés, échappe le texte et omet les champs vides", async () => {
    const html = renderToStaticMarkup(await PoteLayout(props));
    expect(html).toContain("Xbox#1234"); expect(html).toContain("Nom#1234");
    expect(html).toContain("&lt;script&gt;pseudo&lt;/script&gt;"); expect(html).not.toContain("<script>");
    expect(html).not.toContain("Code ami Nintendo Switch");
    expect(renderToStaticMarkup(<GamingIdentifiers user={{ steamId64: null, psnId: null, xboxGamertag: null, switchFriendCode: null, epicDisplayName: null, battleTag: null }} />)).toBe("");
  });
});
