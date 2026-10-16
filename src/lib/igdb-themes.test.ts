import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("thèmes IGDB utilisés dans les refus", () => {
  it("demande themes.name et conserve le thème dans le cache détaillé, sans réseau réel", async () => {
    vi.stubEnv("IGDB_CLIENT_ID", "test-client"); vi.stubEnv("IGDB_CLIENT_SECRET", "test-secret");
    const fetch = vi.fn(async (url: unknown) => new Response(JSON.stringify(String(url).includes("oauth2") ? { access_token: "fake", expires_in: 3600 } : [{ id: 1, name: "A", genres: [{ name: "Shooter" }], themes: [{ name: "Horror" }] }]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { fetchIgdbGameDetails } = await import("./igdb");
    expect(await fetchIgdbGameDetails(1)).toMatchObject({ themes: ["Horror"], genres: ["Shooter"] });
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith("/games"))).toBe(true);
    const apiCall = fetch.mock.calls.find(call => String(call[0]).endsWith("/games"));
    expect(String((apiCall as unknown as [unknown, RequestInit])[1].body)).toContain("themes.name");
  });
});
