import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw, executeRaw } = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw, $executeRaw: executeRaw } }));
import { checkSharedRateLimit, rateLimitWindowStart } from "./shared-rate-limit";

beforeEach(() => {
  queryRaw.mockReset();
  executeRaw.mockReset();
});

describe("rateLimitWindowStart", () => {
  it("aligne la fenêtre sur un multiple de sa durée", () => {
    expect(rateLimitWindowStart(Date.UTC(2026, 10, 23, 10, 0, 59, 999), 60_000).toISOString()).toBe("2026-11-23T10:00:00.000Z");
    expect(rateLimitWindowStart(Date.UTC(2026, 10, 23, 10, 7, 0), 600_000).toISOString()).toBe("2026-11-23T10:00:00.000Z");
  });
});

describe("checkSharedRateLimit", () => {
  it("autorise tant que le compteur partagé reste dans la limite, refuse au-delà", async () => {
    const user = "u-" + Math.random();
    queryRaw.mockResolvedValueOnce([{ count: 2 }]);
    expect(await checkSharedRateLimit(user, "a", { limit: 2, windowMs: 60_000 }, 0)).toBe(true);
    queryRaw.mockResolvedValueOnce([{ count: 3 }]);
    expect(await checkSharedRateLimit(user, "b", { limit: 2, windowMs: 60_000 }, 0)).toBe(false);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("la limite en mémoire, déjà saturée sur cette instance, refuse sans écrire en base", async () => {
    const user = "m-" + Math.random();
    queryRaw.mockResolvedValue([{ count: 1 }]);
    expect(await checkSharedRateLimit(user, "c", { limit: 1, windowMs: 60_000 }, 0)).toBe(true);
    queryRaw.mockClear();
    expect(await checkSharedRateLimit(user, "c", { limit: 1, windowMs: 60_000 }, 0)).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("une erreur de base remonte (jamais avalée)", async () => {
    queryRaw.mockRejectedValueOnce(new Error("base indisponible"));
    await expect(checkSharedRateLimit("e-" + Math.random(), "d", { limit: 5, windowMs: 60_000 }, 0)).rejects.toThrow("base indisponible");
  });
});
