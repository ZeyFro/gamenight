import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  community: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.user },
    community: { findUnique: mocks.community },
  },
}));
vi.mock("@/lib/discord-boost", () => ({ readBoosterStatus: mocks.read }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { boosterFeatureEnabled, loadViewerBoosterState, PROFILE_BOOSTER_BUDGET_MS } from "./booster-profile";

const USER = "user-1";
const COMMUNITY = "community-1";

beforeEach(() => {
  vi.stubEnv("DISCORD_BOOSTER_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  mocks.user.mockResolvedValue({ discordId: "100000000000000004" });
  mocks.community.mockResolvedValue({ discordGuildId: "100000000000000002", status: "ACTIVE" });
  mocks.read.mockResolvedValue({ status: "INACTIVE" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("statut Booster du profil web", () => {
  it("est entièrement fermé par défaut, sans aucun appel Discord", async () => {
    vi.stubEnv("DISCORD_BOOSTER_ENABLED", "");
    expect(boosterFeatureEnabled()).toBe(false);
    await expect(loadViewerBoosterState({ userId: USER, communityId: COMMUNITY })).resolves.toEqual({
      kind: "DISABLED",
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("exige aussi le jeton du bot : un interrupteur seul n’ouvre rien", () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    expect(boosterFeatureEnabled()).toBe(false);
  });

  it("affiche la distinction sur un statut ACTIF vérifié, avec le budget court du web", async () => {
    mocks.read.mockResolvedValue({ status: "ACTIVE", since: "2026-11-01T10:00:00.000Z" });
    await expect(loadViewerBoosterState({ userId: USER, communityId: COMMUNITY })).resolves.toEqual({
      kind: "ACTIVE",
      since: "2026-11-01T10:00:00.000Z",
    });
    expect(mocks.read).toHaveBeenCalledWith({
      guildId: "100000000000000002",
      discordId: "100000000000000004",
      budgetMs: PROFILE_BOOSTER_BUDGET_MS,
    });
  });

  it("n’affiche rien pour un membre qui ne booste pas", async () => {
    await expect(loadViewerBoosterState({ userId: USER, communityId: COMMUNITY })).resolves.toEqual({
      kind: "INACTIVE",
    });
  });

  it("ne confond jamais « impossible à vérifier » avec « ne booste pas »", async () => {
    mocks.read.mockResolvedValue({ status: "UNAVAILABLE" });
    await expect(loadViewerBoosterState({ userId: USER, communityId: COMMUNITY })).resolves.toEqual({
      kind: "UNKNOWN",
    });
  });

  it("encaisse une panne réseau sans casser la page", async () => {
    mocks.read.mockRejectedValue(new Error("ECONNRESET"));
    await expect(loadViewerBoosterState({ userId: USER, communityId: COMMUNITY })).resolves.toEqual({
      kind: "UNKNOWN",
    });
  });

  it("ne fait jamais confiance à un identifiant fourni de l’extérieur", async () => {
    mocks.user.mockResolvedValue({ discordId: null });
    await expect(loadViewerBoosterState({ userId: USER, communityId: COMMUNITY })).resolves.toEqual({
      kind: "UNKNOWN",
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("ignore une communauté suspendue ou sans serveur Discord", async () => {
    mocks.community.mockResolvedValue({ discordGuildId: null, status: "ACTIVE" });
    await expect(loadViewerBoosterState({ userId: USER, communityId: COMMUNITY })).resolves.toEqual({
      kind: "UNKNOWN",
    });
    mocks.community.mockResolvedValue({ discordGuildId: "100000000000000002", status: "SUSPENDED" });
    await expect(loadViewerBoosterState({ userId: USER, communityId: COMMUNITY })).resolves.toEqual({
      kind: "UNKNOWN",
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
