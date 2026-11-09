import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveIsCoopFromCategories, fetchSteamStoreDetails, SteamStoreHttpError } from "./steam-store";
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
    const fetcher = respond({ is_free: false, price_overview: { initial_formatted: "39,99€", final_formatted: "19,99€", discount_percent: 50, currency: "EUR" }, categories: [{ id: 9, description: "Co-op" }] });
    const signal = AbortSignal.timeout(5000);
    expect(await fetchSteamStoreDetails(620,{signal,countryCode:"fr"})).toMatchObject({ isFree: false, priceFormatted: "19,99€", initialPriceFormatted: "39,99€", discountPercent: 50, priceCurrency: "EUR", isCoop: true });
    expect(fetcher).toHaveBeenCalledWith("https://store.steampowered.com/api/appdetails?appids=620&l=french&cc=fr",{signal});
    await fetchSteamStoreDetails(620);
    expect(fetcher).toHaveBeenLastCalledWith("https://store.steampowered.com/api/appdetails?appids=620&l=french",{signal:undefined});
  });
  it("ne remplace pas le statut explicite par une promotion à zéro, et borne le texte reçu", async () => {
    respond({ is_free: false, price_overview: { final_formatted: "0€", currency: "EUR" } }); expect(await fetchSteamStoreDetails(620)).toMatchObject({ isFree: false, priceFormatted: "0€" });
    respond({ price_overview: { final_formatted: "x".repeat(121), currency: "unknown" } }); expect(await fetchSteamStoreDetails(620)).toMatchObject({ priceFormatted: null, priceCurrency: null });
    respond({ is_free: true, price_overview: { final_formatted: "20€" } }); expect((await fetchSteamStoreDetails(620))?.priceFormatted).toBeNull();
  });
  it("ignore les pourcentages de promotion invalides", async () => {
    for (const discount_percent of [-5, 101, 50.5, "50"]) {
      respond({ price_overview: { discount_percent } });
      expect(await fetchSteamStoreDetails(620)).toMatchObject({ discountPercent: 0 });
    }
  });
  it("ne confond pas un jeu gratuit permanent avec une promotion", async () => {
    respond({ is_free: true, price_overview: { initial_formatted: "19,99€", final_formatted: "0€", discount_percent: 100 } });
    expect(await fetchSteamStoreDetails(620)).toMatchObject({ isFree: true, initialPriceFormatted: null, discountPercent: 0 });
  });
  it("distingue fiche absente et erreur HTTP", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ ok: true, json: async () => ({ "620": { success: false } }) })); expect(await fetchSteamStoreDetails(620)).toBeNull();
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ ok: false, status: 429 })); await expect(fetchSteamStoreDetails(620)).rejects.toBeInstanceOf(SteamStoreHttpError);
  });
});

describe("deriveIsCoopFromCategories", () => {
  const cat = (id: number, description: string) => ({ id, description });

  it("reconnaît les ids coop connus quelle que soit la description", () => {
    for (const id of [9, 24, 27, 38, 39, 48]) {
      expect(deriveIsCoopFromCategories([cat(id, "Libellé inconnu")])).toBe(true);
    }
  });

  it("reconnaît coop en ligne, local, coopératif et écran partagé par mot-clé", () => {
    expect(deriveIsCoopFromCategories([cat(0, "Coop en ligne")])).toBe(true);
    expect(deriveIsCoopFromCategories([cat(0, "Online Co-op")])).toBe(true);
    expect(deriveIsCoopFromCategories([cat(0, "Coop local")])).toBe(true);
    expect(deriveIsCoopFromCategories([cat(0, "Mode coopératif")])).toBe(true);
    expect(deriveIsCoopFromCategories([cat(0, "Coop en écran partagé/divisé")])).toBe(true);
    expect(deriveIsCoopFromCategories([cat(0, "Écran partagé")])).toBe(true);
  });

  it("ignore la casse", () => {
    expect(deriveIsCoopFromCategories([cat(0, "CO-OP")])).toBe(true);
    expect(deriveIsCoopFromCategories([cat(0, "ÉCRAN PARTAGÉ")])).toBe(true);
  });

  it("ne confond pas multijoueur seul avec coop", () => {
    expect(deriveIsCoopFromCategories([cat(1, "Multijoueur"), cat(36, "JcJ en ligne")])).toBe(false);
    expect(deriveIsCoopFromCategories([cat(1, "Multi-player")])).toBe(false);
  });

  it("renvoie false pour catégories vides ou inconnues", () => {
    expect(deriveIsCoopFromCategories([])).toBe(false);
    expect(deriveIsCoopFromCategories([cat(2, "Solo"), cat(22, "Succès Steam")])).toBe(false);
    expect(deriveIsCoopFromCategories([cat(0, "")])).toBe(false);
  });

  it("ne prend pas le partage familial pour du coop", () => {
    expect(deriveIsCoopFromCategories([cat(62, "Family Sharing")])).toBe(false);
    expect(deriveIsCoopFromCategories([cat(62, "Partage familial")])).toBe(false);
  });

  // Caractérisation (règle métier NON décidée) : le mot-clé « partagé » seul est dans COOP_KEYWORDS,
  // donc une catégorie hypothétique « Partagé en famille » vaudrait coop. Faux positif non prouvé
  // (libellé réel de Steam non vérifié) : à trancher par le propriétaire avant tout changement.
  it("caractérise le mot-clé « partagé » seul (comportement actuel, non décidé)", () => {
    expect(deriveIsCoopFromCategories([cat(0, "Partagé en famille")])).toBe(true);
  });
});
