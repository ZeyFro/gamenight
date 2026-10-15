import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSteamStoreDetails, SteamStoreHttpError } from "./steam-store";
afterEach(() => vi.unstubAllGlobals());
function respond(data: Record<string, unknown>) { const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ "620": { success: true, data } }) }); vi.stubGlobal("fetch",fetcher); return fetcher; }
describe("prix Steam explicitement typé", () => {
  it("distingue gratuit, payant et inconnu sans déduire la gratuité d'un prix absent", async () => {
    for (const [data,expected] of [
      [{ is_free: true }, { isFree: true, priceFormatted: null }],
      [{ is_free: false }, { isFree: false, priceFormatted: null }],
      [{}, { isFree: null, priceFormatted: null }],
      [{ is_free: "false" }, { isFree: null, priceFormatted: null }],
    ] as const) { respond(data); expect(await fetchSteamStoreDetails(620)).toMatchObject(expected); }
  });
  it("fixe la région FR, transmet le signal et conserve prix/devise et coopération", async () => {
    const fetcher = respond({ is_free: false, price_overview: { final_formatted: "19,99€", currency: "EUR" }, categories: [{ id: 9, description: "Co-op" }] });
    const signal = AbortSignal.timeout(5000);
    expect(await fetchSteamStoreDetails(620,{signal})).toMatchObject({ isFree: false, priceFormatted: "19,99€", priceCurrency: "EUR", isCoop: true });
    expect(fetcher).toHaveBeenCalledWith("https://store.steampowered.com/api/appdetails?appids=620&l=french&cc=fr",{signal});
  });
  it("ne remplace pas le statut explicite par une promotion à zéro, et borne le texte reçu", async () => {
    respond({ is_free: false, price_overview: { final_formatted: "0€", currency: "EUR" } }); expect(await fetchSteamStoreDetails(620)).toMatchObject({ isFree: false, priceFormatted: "0€" });
    respond({ price_overview: { final_formatted: "x".repeat(121), currency: "unknown" } }); expect(await fetchSteamStoreDetails(620)).toMatchObject({ priceFormatted: null, priceCurrency: null });
    respond({ is_free: true, price_overview: { final_formatted: "20€" } }); expect((await fetchSteamStoreDetails(620))?.priceFormatted).toBeNull();
  });
  it("distingue fiche absente et erreur HTTP", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ ok: true, json: async () => ({ "620": { success: false } }) })); expect(await fetchSteamStoreDetails(620)).toBeNull();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ ok: false, status: 429 })); await expect(fetchSteamStoreDetails(620)).rejects.toBeInstanceOf(SteamStoreHttpError);
  });
});
