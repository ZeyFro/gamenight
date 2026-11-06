import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cache: vi.fn(), fetch: vi.fn(), warn: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...args: never[]) => Promise<unknown>, keys: string[], options: unknown) => { mocks.cache(keys, options); return fn; } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn } }));

import { getAutomaticFreeGameOfferStatus, isFeedSnapshotFresh, listAutomaticFreeGameOffers } from "./gamerpower-free-games";

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

function redirect(location: string) {
  return { ok: false, status: 302, headers: new Headers({ location }) };
}

function giveaway(id: number, openGiveawayUrl: string, changes: Record<string, unknown> = {}) {
  return { id, title: `Game ${id}`, description: "Full game", instructions: "Claim on the store", type: "Game", status: "Active", open_giveaway_url: openGiveawayUrl, open_giveaway: openGiveawayUrl, ...changes };
}

beforeEach(() => {
  vi.stubEnv("FREE_GAME_FEED_ENABLED", "true");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockReset();
  mocks.warn.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("flux automatique GamerPower", () => {
  it("reste muet avec le flag OFF", async () => {
    vi.stubEnv("FREE_GAME_FEED_ENABLED", "false");
    expect(await listAutomaticFreeGameOffers()).toEqual([]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("ne publie que les jeux actifs qui redirigent vers Steam ou Epic", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/giveaways")) {
        expect(init?.redirect).toBe("error");
        const platform = new URL(url).searchParams.get("platform");
        return json(platform === "steam" ? [
          giveaway(1, "https://www.gamerpower.com/open/steam-one"),
          giveaway(2, "https://www.gamerpower.com/open/points", { title: "Reward points" }),
          giveaway(3, "https://www.gamerpower.com/open/key", { instructions: "Get a game key" }),
          giveaway(4, "https://www.gamerpower.com/open/demo", { title: "Game demo" }),
          giveaway(5, "https://www.gamerpower.com/open/steam-weekend", { description: "Free weekend" }),
          giveaway(6, "https://www.gamerpower.com/open/arp", { description: "Includes ARP rewards" }),
          giveaway(7, "https://evil.example/open/steam"),
        ] : [giveaway(8, "https://www.gamerpower.com/open/epic-eight")]);
      }
      expect(init?.redirect).toBe("manual");
      if (url.endsWith("steam-one")) return redirect("https://store.steampowered.com/app/620/Portal/?l=english");
      return redirect("https://store.epicgames.com/en-US/p/example-game?lang=en");
    });

    const offers = await listAutomaticFreeGameOffers();
    expect(mocks.warn.mock.calls).toEqual([]);
    expect(offers).toEqual([
      { id: "gamerpower-steam-1", store: "STEAM", title: "Game 1", storeUrl: "https://store.steampowered.com/app/620/Portal/?l=french&cc=fr", endsAt: null, source: "gamerpower" },
      { id: "gamerpower-epic-8", store: "EPIC", title: "Game 8", storeUrl: "https://store.epicgames.com/fr/p/example-game", endsAt: null, source: "gamerpower" },
    ]);
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(mocks.cache).toHaveBeenCalledWith(["gamerpower-free-games-v2"], { revalidate: 900 });
  });

  it("dédoublonne deux giveaways qui mènent au même produit boutique (une seule annonce)", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("/api/giveaways")) {
        return json(new URL(url).searchParams.get("platform") === "steam" ? [
          giveaway(1, "https://www.gamerpower.com/open/portal-a"),
          giveaway(2, "https://www.gamerpower.com/open/portal-b"),
        ] : []);
      }
      return redirect("https://store.steampowered.com/app/620/Portal/");
    });

    const offers = await listAutomaticFreeGameOffers();
    expect(offers.map((offer) => offer.id)).toEqual(["gamerpower-steam-1"]);
  });

  it("garde la source Epic disponible si Steam échoue et rejette les redirects ambigus", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("/api/giveaways?platform=steam")) throw new Error("Steam source failed");
      if (url.includes("/api/giveaways")) return json([
        giveaway(6, "https://www.gamerpower.com/open/evil-store"),
        giveaway(7, "https://www.gamerpower.com/open/valid"),
      ]);
      if (url.endsWith("evil-store")) return redirect("https://store.steampowered.com.evil.test/app/620");
      return redirect("https://store.epicgames.com/en-US/p/example-game");
    });

    expect(await listAutomaticFreeGameOffers()).toMatchObject([
      { id: "gamerpower-epic-7", store: "EPIC", storeUrl: "https://store.epicgames.com/fr/p/example-game" },
    ]);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it.each([
    ["steam", "https://store.epicgames.com/fr/p/example-game"],
    ["epic-games-store", "https://store.steampowered.com/app/620/Portal/"],
  ])("rejette une destination qui ne correspond pas au flux %s", async (platform, destination) => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/giveaways") return json(url.searchParams.get("platform") === platform
        ? [giveaway(42, "https://www.gamerpower.com/open/mismatched-store")]
        : []);
      return redirect(destination);
    });

    await expect(listAutomaticFreeGameOffers()).resolves.toEqual([]);
  });

  it("traite le 201 GamerPower documenté comme une liste vide", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("/api/giveaways")) return json({ status: 0, status_message: "No active giveaways available at the moment, please try again later." }, 201);
      throw new Error("Aucune offre ne doit être résolue");
    });

    expect(await listAutomaticFreeGameOffers()).toEqual([]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("signale un 201 mal formé et ne suit pas les URL de source hors allowlist", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("platform=steam")) return json({ status: 1, status_message: "unexpected" }, 201);
      if (url.includes("/api/giveaways")) return json([
        giveaway(11, "http://www.gamerpower.com/open/http"),
        giveaway(12, "https://user@www.gamerpower.com/open/credentials"),
        giveaway(13, "https://www.gamerpower.com:8443/open/port"),
      ]);
      throw new Error("Les URL rejetées ne doivent pas être appelées");
    });

    expect(await listAutomaticFreeGameOffers()).toEqual([]);
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejette les relevés anciens, futurs ou invalides", () => {
    const now = new Date("2026-10-19T10:30:00Z");
    expect(isFeedSnapshotFresh("2026-10-19T10:00:00Z", now)).toBe(true);
    expect(isFeedSnapshotFresh("2026-10-19T09:59:59Z", now)).toBe(false);
    expect(isFeedSnapshotFresh("2026-10-19T10:31:00Z", now)).toBe(false);
    expect(isFeedSnapshotFresh("invalid", now)).toBe(false);
  });

  it("distingue une offre toujours active d'une offre absente d'une réponse valide", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("/api/giveaways?platform=steam")) return json([giveaway(42, "https://www.gamerpower.com/open/steam-42")]);
      if (url.includes("/api/giveaways")) return json({ status: 0, status_message: "No active giveaways available" }, 201);
      return redirect("https://store.steampowered.com/app/620/Portal/");
    });

    await expect(getAutomaticFreeGameOfferStatus("gamerpower-steam-42")).resolves.toBe("active");
    await expect(getAutomaticFreeGameOfferStatus("gamerpower-steam-99")).resolves.toBe("expired");
  });

  it("diffère la vérification quand la source de cette boutique échoue", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("/api/giveaways?platform=steam")) throw new Error("Steam source failed");
      return json({ status: 0, status_message: "No active giveaways available" }, 201);
    });

    await expect(getAutomaticFreeGameOfferStatus("gamerpower-steam-42")).resolves.toBe("unavailable");
  });

  it("garde active une offre publiée même si elle sort du petit lot de liens résolus", async () => {
    mocks.fetch.mockImplementation(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("/api/giveaways?platform=steam")) return json([
        giveaway(1, "https://www.gamerpower.com/open/steam-1"),
        giveaway(2, "https://www.gamerpower.com/open/steam-2"),
        giveaway(3, "https://www.gamerpower.com/open/steam-3"),
        giveaway(42, "https://www.gamerpower.com/open/steam-42"),
      ]);
      if (url.includes("/api/giveaways")) return json({ status: 0, status_message: "No active giveaways available" }, 201);
      return redirect("https://store.steampowered.com/app/620/Portal/");
    });

    await expect(getAutomaticFreeGameOfferStatus("gamerpower-steam-42")).resolves.toBe("active");
  });
});
