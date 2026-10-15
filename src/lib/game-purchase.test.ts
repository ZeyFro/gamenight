import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), warn: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/steam-store", () => ({ fetchSteamStoreDetails: mocks.fetch }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn } }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keys: string[], options: unknown) => { mocks.cache(keys,options); return fn; } }));
import { getSteamPurchaseInfo } from "./game-purchase";
beforeEach(() => { mocks.fetch.mockReset(); mocks.warn.mockClear(); });
describe("relevé Steam de fiche", () => {
  it("cache la date avec les données et borne le délai d'appel", async () => {
    mocks.fetch.mockResolvedValue({ isFree: false, priceFormatted: "12€", priceCurrency: "EUR" });
    const value = await getSteamPurchaseInfo(620);
    expect(value).toMatchObject({ isFree: false, priceFormatted: "12€", currency: "EUR", observedAt: expect.any(String) });
    expect(Number.isFinite(Date.parse(value!.observedAt))).toBe(true);
    expect(mocks.cache).toHaveBeenCalledWith(["steam-purchase-fr-v1"],{revalidate:3600});
    expect(mocks.fetch).toHaveBeenCalledWith(620,{signal:expect.any(AbortSignal)});
  });
  it("refuse les identifiants invalides et ne fait pas passer une panne pour un jeu gratuit", async () => {
    for (const appId of [0,-1,NaN,1.5]) expect(await getSteamPurchaseInfo(appId)).toBeNull(); expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockRejectedValue(Error("Steam down")); expect(await getSteamPurchaseInfo(620)).toBeNull(); expect(mocks.warn).toHaveBeenCalledOnce();
    mocks.fetch.mockResolvedValue(null); expect(await getSteamPurchaseInfo(620)).toBeNull();
  });
});
