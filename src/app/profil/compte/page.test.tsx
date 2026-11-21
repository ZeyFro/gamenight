import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
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
});
