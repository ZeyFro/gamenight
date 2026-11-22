import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));

import AdminDiscordCommandsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin" });
  vi.stubEnv("DISCORD_COMMAND_REGISTRATION_ENABLED", "true");
  vi.stubEnv("DISCORD_COMMAND_REGISTRATION_SECRET", "secret-fictif");
  vi.stubEnv("VERCEL_ENV", "production");
});
afterEach(() => vi.unstubAllEnvs());

describe("/admin/discord-commands — accès", () => {
  it("interrupteur éteint (absent, vide, « TRUE », « 1 ») : 404 avant toute lecture de session", async () => {
    for (const value of ["", "TRUE", "1", "false"]) {
      vi.stubEnv("DISCORD_COMMAND_REGISTRATION_ENABLED", value);
      await expect(AdminDiscordCommandsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it("secret absent côté serveur ou Preview : 404, comme la route", async () => {
    vi.stubEnv("DISCORD_COMMAND_REGISTRATION_SECRET", "  ");
    await expect(AdminDiscordCommandsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("DISCORD_COMMAND_REGISTRATION_SECRET", "secret-fictif");
    vi.stubEnv("VERCEL_ENV", "preview");
    await expect(AdminDiscordCommandsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it("non-admin ou non connecté : refusé (redirection), rien n'est rendu", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    await expect(AdminDiscordCommandsPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("admin, interrupteur allumé : la page est rendue sans exposer le secret du serveur", async () => {
    const element = await AdminDiscordCommandsPage();
    expect(element).toBeTruthy();
    expect(JSON.stringify(element)).not.toContain("secret-fictif");
  });
});
