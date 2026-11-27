import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), lastTeams: vi.fn() }));
vi.mock("@/lib/account-deletion-teams", () => ({ listLastMemberTeams: mocks.lastTeams }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/components/DeleteAccountForm", () => ({ DeleteAccountForm: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import AccountPage from "./page";

describe("/profil/compte", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "me", discordName: "Alice" });
    mocks.lastTeams.mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("répond 404 CÔTÉ SERVEUR flag éteint, sans lire la session", async () => {
    for (const value of ["", "false", "TRUE"]) {
      vi.stubEnv("ACCOUNT_DELETION_ENABLED", value);
      await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    }
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("renvoie un visiteur vers l'accueil flag allumé", async () => {
    vi.stubEnv("ACCOUNT_DELETION_ENABLED", "true");
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(AccountPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/");
  });

  it("rend la page flag allumé pour un membre connecté", async () => {
    vi.stubEnv("ACCOUNT_DELETION_ENABLED", "true");
    const element = await AccountPage({ searchParams: Promise.resolve({ erreur: "proprietaire" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("dernier propriétaire");
    expect(html).toContain("/api/compte/export");
  });

  it("D5 : liste AVANT la confirmation les équipes dont on est le dernier membre, avec la dissolution et la suppression des deux salons", async () => {
    vi.stubEnv("ACCOUNT_DELETION_ENABLED", "true");
    mocks.lastTeams.mockResolvedValue([{ teamId: "t1", communityId: "c1", name: "Les <b>Dragons</b>", formerMemberDiscordIds: [] }, { teamId: "t2", communityId: "c1", name: "Explorateurs", formerMemberDiscordIds: [] }]);
    const html = renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.lastTeams).toHaveBeenCalledWith("me");
    expect(html).toContain("dernier membre : Les &lt;b&gt;Dragons&lt;/b&gt;, Explorateurs");
    expect(html).toContain("dissoutes");
    expect(html).toContain("deux salons Discord");
    expect(html).toContain("jusqu’à la fin du blocage");
    expect(html).not.toContain("<b>Dragons</b>");
  });

  it("D5 : sans équipe concernée, aucun encadré ; liste illisible : avertissement générique, la page reste servie", async () => {
    vi.stubEnv("ACCOUNT_DELETION_ENABLED", "true");
    expect(renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve({}) }))).not.toContain("dernier membre");
    mocks.lastTeams.mockRejectedValue(new Error("base indisponible"));
    const html = renderToStaticMarkup(await AccountPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("n’a pas pu être lue");
    expect(html).toContain("deux salons Discord");
  });
});
