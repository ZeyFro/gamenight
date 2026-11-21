import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  rateLimit: vi.fn(),
  deleteAccount: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit, RATE_LIMIT_MESSAGE: "trop vite" }));
vi.mock("@/auth", () => ({ signOut: mocks.signOut }));
vi.mock("@/lib/account-deletion", () => {
  class AccountBlobUnavailableError extends Error {}
  return { deleteAccount: mocks.deleteAccount, AccountBlobUnavailableError };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { deleteMyAccountAction } from "./actions";
import { AccountBlobUnavailableError } from "@/lib/account-deletion";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("action « supprimer mon compte »", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ACCOUNT_DELETION_ENABLED", "true");
    mocks.getCurrentUser.mockResolvedValue({ id: "me", discordName: "Alice" });
    mocks.rateLimit.mockReturnValue(true);
    mocks.deleteAccount.mockResolvedValue({ status: "deleted", summary: {} });
    mocks.signOut.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuse CÔTÉ SERVEUR flag éteint (absent, vide ou autre que « true ») : rien n'est lu ni supprimé", async () => {
    for (const value of ["", "false", "TRUE", "1"]) {
      vi.stubEnv("ACCOUNT_DELETION_ENABLED", value);
      await expect(deleteMyAccountAction(form({ confirmation: "SUPPRIMER" }))).rejects.toThrow("NOT_FOUND");
    }
    vi.stubEnv("ACCOUNT_DELETION_ENABLED", undefined);
    await expect(deleteMyAccountAction(form({ confirmation: "SUPPRIMER" }))).rejects.toThrow("NOT_FOUND");
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it("refuse un visiteur non connecté", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(deleteMyAccountAction(form({ confirmation: "SUPPRIMER" }))).rejects.toThrow("REDIRECT:/");
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });

  it("exige la confirmation forte : le pseudo exact ou SUPPRIMER", async () => {
    for (const bad of ["", "supprimer", "alice", "Alic", "Alice et plus", "OUI"]) {
      await expect(deleteMyAccountAction(form({ confirmation: bad }))).rejects.toThrow("erreur=confirmation");
    }
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
    await expect(deleteMyAccountAction(form({ confirmation: "Alice" }))).resolves.toBeUndefined();
    await expect(deleteMyAccountAction(form({ confirmation: " SUPPRIMER " }))).resolves.toBeUndefined();
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(2);
  });

  it("ne supprime que le compte de la session : un identifiant forgé dans le formulaire est ignoré", async () => {
    await deleteMyAccountAction(form({ confirmation: "SUPPRIMER", userId: "victime", id: "victime" }));
    expect(mocks.deleteAccount).toHaveBeenCalledWith("me");
  });

  it("ferme la session puis revient à l'accueil", async () => {
    await deleteMyAccountAction(form({ confirmation: "SUPPRIMER" }));
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/?compte=supprime" });
  });

  it("dernier propriétaire : refus explicite, la session reste ouverte", async () => {
    mocks.deleteAccount.mockResolvedValue({ status: "refused", reason: "last_owner", communities: ["A"] });
    await expect(deleteMyAccountAction(form({ confirmation: "SUPPRIMER" }))).rejects.toThrow("erreur=proprietaire");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("stockage indisponible : message dédié ; toute autre erreur remonte (jamais avalée)", async () => {
    mocks.deleteAccount.mockRejectedValue(new AccountBlobUnavailableError("jeton absent"));
    await expect(deleteMyAccountAction(form({ confirmation: "SUPPRIMER" }))).rejects.toThrow("erreur=stockage");
    mocks.deleteAccount.mockRejectedValue(new Error("base indisponible"));
    await expect(deleteMyAccountAction(form({ confirmation: "SUPPRIMER" }))).rejects.toThrow("base indisponible");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("limite le rythme des tentatives", async () => {
    mocks.rateLimit.mockReturnValue(false);
    await expect(deleteMyAccountAction(form({ confirmation: "SUPPRIMER" }))).rejects.toThrow("erreur=rate_limited");
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });
});
