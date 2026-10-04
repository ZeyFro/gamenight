import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGameNews } from "./steam-news";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGameNews", () => {
  it("construit l'URL publique attendue, sans cache", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await fetchGameNews(440);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe(
      "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/"
    );
    expect(parsed.searchParams.get("appid")).toBe("440");
    expect(parsed.searchParams.get("count")).toBe("3");
    expect(parsed.searchParams.get("maxlength")).toBe("200");
    expect(parsed.searchParams.get("format")).toBe("json");
    expect(init).toEqual({ cache: "no-store" });
  });

  it("mappe les actus et convertit la date (secondes → Date)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        appnews: {
          newsitems: [{ title: "Patch", url: "https://x/1", feedlabel: "Annonces", date: 1_700_000_000 }],
        },
      }),
    });
    expect(await fetchGameNews(1)).toEqual([
      {
        title: "Patch",
        url: "https://x/1",
        feedLabel: "Annonces",
        publishedAt: new Date(1_700_000_000_000),
      },
    ]);
  });

  it("ignore les items sans titre ou sans url", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        appnews: {
          newsitems: [
            { title: "", url: "https://x/1", feedlabel: "a", date: 1 },
            { title: "Ok", url: "", feedlabel: "a", date: 1 },
            { title: "Bon", url: "https://x/3", feedlabel: "a", date: 1 },
          ],
        },
      }),
    });
    const items = await fetchGameNews(1);
    expect(items.map((i) => i.title)).toEqual(["Bon"]);
  });

  it("renvoie [] si la réponse n'a pas d'appnews", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await fetchGameNews(1)).toEqual([]);
  });

  it("jette sur réponse non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchGameNews(1)).rejects.toThrow("503");
  });
});
