import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkSharedRateLimit } = vi.hoisted(() => ({ checkSharedRateLimit: vi.fn() }));
vi.mock("@/lib/shared-rate-limit", () => ({ checkSharedRateLimit }));

import {
  assertDailyCreationQuota,
  consumeDailyCreationQuota,
  DAILY_CREATION_WINDOW_MS,
  DAILY_SESSION_CREATION_LIMIT,
  DAILY_TOURNAMENT_CREATION_LIMIT,
  dailyQuotaErrorKey,
  dailyQuotaMessage,
  DailyCreationLimitError,
  SESSION_QUOTA_ERROR_KEY,
  SESSION_QUOTA_MESSAGE,
  TOURNAMENT_QUOTA_ERROR_KEY,
  TOURNAMENT_QUOTA_MESSAGE,
} from "./creation-quota";

beforeEach(() => {
  checkSharedRateLimit.mockReset();
});

describe("plafond de créations par jour (audit 1.14)", () => {
  it("valeurs décidées : 10 soirées et 5 tournois par personne, fenêtre de 24 h", () => {
    expect(DAILY_SESSION_CREATION_LIMIT).toBe(10);
    expect(DAILY_TOURNAMENT_CREATION_LIMIT).toBe(5);
    expect(DAILY_CREATION_WINDOW_MS).toBe(86_400_000);
  });

  it("soirée : compteur partagé « dailyCreateSession », limite 10, fenêtre 24 h, client de transaction transmis", async () => {
    checkSharedRateLimit.mockResolvedValue(true);
    const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    expect(await consumeDailyCreationQuota("SESSION", "u1", tx)).toBe(true);
    expect(checkSharedRateLimit).toHaveBeenCalledWith("u1", "dailyCreateSession", { limit: 10, windowMs: 86_400_000 }, expect.any(Number), tx);
  });

  it("tournoi : compteur partagé « dailyCreateTournament », limite 5, fenêtre 24 h", async () => {
    checkSharedRateLimit.mockResolvedValue(true);
    await consumeDailyCreationQuota("TOURNAMENT", "u1");
    expect(checkSharedRateLimit).toHaveBeenCalledWith("u1", "dailyCreateTournament", { limit: 5, windowMs: 86_400_000 }, expect.any(Number), undefined);
  });

  it("au-delà du plafond : consume renvoie false et assert lève DailyCreationLimitError", async () => {
    checkSharedRateLimit.mockResolvedValue(false);
    expect(await consumeDailyCreationQuota("SESSION", "u1")).toBe(false);
    await expect(assertDailyCreationQuota("SESSION", "u1")).rejects.toBeInstanceOf(DailyCreationLimitError);
    await expect(assertDailyCreationQuota("TOURNAMENT", "u1")).rejects.toMatchObject({ kind: "TOURNAMENT" });
  });

  it("dans le plafond : assert ne lève rien", async () => {
    checkSharedRateLimit.mockResolvedValue(true);
    await expect(assertDailyCreationQuota("SESSION", "u1")).resolves.toBeUndefined();
  });

  it("une erreur de base remonte, jamais avalée", async () => {
    checkSharedRateLimit.mockRejectedValue(new Error("base indisponible"));
    await expect(assertDailyCreationQuota("SESSION", "u1")).rejects.toThrow("base indisponible");
  });

  it("messages français clairs, avec le plafond", () => {
    expect(SESSION_QUOTA_MESSAGE).toBe("Tu as atteint la limite de 10 soirées créées par jour. Réessaie demain.");
    expect(TOURNAMENT_QUOTA_MESSAGE).toBe("Tu as atteint la limite de 5 tournois créés par jour. Réessaie demain.");
    expect(dailyQuotaMessage("SESSION")).toBe(SESSION_QUOTA_MESSAGE);
    expect(dailyQuotaMessage("TOURNAMENT")).toBe(TOURNAMENT_QUOTA_MESSAGE);
    expect(dailyQuotaErrorKey("SESSION")).toBe(SESSION_QUOTA_ERROR_KEY);
    expect(dailyQuotaErrorKey("TOURNAMENT")).toBe(TOURNAMENT_QUOTA_ERROR_KEY);
  });
});
