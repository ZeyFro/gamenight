import { describe, expect, it } from "vitest";
import { freeGameOfferSchema } from "./free-game-offer-rules";

describe("free game offers", () => {
  it("accepts official French Steam and Epic product links", () => {
    for (const [store, storeUrl] of [
      ["STEAM", "https://store.steampowered.com/app/12345/?l=french"],
      ["EPIC", "https://store.epicgames.com/fr/p/example-game"],
    ]) {
      expect(freeGameOfferSchema.safeParse({ store, title: "Jeu gratuit", storeUrl, startsAt: "2026-10-17T10:00", endsAt: "2026-10-18T10:00" }).success).toBe(true);
    }
  });

  it("rejects non-store URLs, non-French links, invalid store values and empty dates", () => {
    const base = { title: "Jeu", startsAt: "2026-10-17T10:00", endsAt: "2026-10-18T10:00" };
    expect(freeGameOfferSchema.safeParse({ ...base, store: "STEAM", storeUrl: "https://example.com/app/12345/?l=french" }).success).toBe(false);
    expect(freeGameOfferSchema.safeParse({ ...base, store: "STEAM", storeUrl: "https://store.steampowered.com/app/12345/" }).success).toBe(false);
    expect(freeGameOfferSchema.safeParse({ ...base, store: "OTHER", storeUrl: "https://store.epicgames.com/fr/p/example" }).success).toBe(false);
  });

  it("trims the title and requires the offer end to follow its start", () => {
    const input = { store: "EPIC", title: "  Jeu  ", storeUrl: "https://store.epicgames.com/fr/p/example", startsAt: "2026-10-18T10:00", endsAt: "2026-10-17T10:00" };
    expect(freeGameOfferSchema.safeParse(input).success).toBe(false);
    expect(freeGameOfferSchema.safeParse({ ...input, endsAt: "2026-10-19T10:00" })).toMatchObject({ success: true, data: { title: "Jeu" } });
  });
});
