import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/badges", () => ({ checkLibraryBadges: vi.fn() }));
vi.mock("@/lib/wishlist", () => ({ checkWishlistPurchases: vi.fn() }));

import { verifySteamOpenId } from "./steam";

const ENDPOINT = "https://steamcommunity.com/openid/login";
const RETURN_TO = "https://app.example/api/steam/callback?state=abc123";
const STEAM_ID = "76561197960287930";
const NOW = new Date("2026-10-02T10:00:00.000Z");

const SIGNED = "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle";

function assertion(overrides: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string> = {
    state: "abc123",
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": ENDPOINT,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": RETURN_TO,
    "openid.response_nonce": "2026-10-02T09:59:30ZAbCdEf",
    "openid.assoc_handle": "1234567890",
    "openid.signed": SIGNED,
    "openid.sig": "c2ln",
  };
  const params = new URLSearchParams(base);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  return params;
}

const fetchMock = vi.fn();

describe("verifySteamOpenId", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("assertion valide → SteamID64 ; check_authentication posté à Steam avec les seuls openid.*", async () => {
    await expect(verifySteamOpenId(assertion(), RETURN_TO, NOW)).resolves.toBe(STEAM_ID);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get("openid.mode")).toBe("check_authentication");
    expect(sent.has("state")).toBe(false);
  });

  it.each([
    ["return_to d'un autre site", { "openid.return_to": "https://evil.example/cb?state=abc123" }],
    ["return_to sans le state attendu", { "openid.return_to": "https://app.example/api/steam/callback?state=autre" }],
    ["op_endpoint étranger", { "openid.op_endpoint": "https://evil.example/openid/login" }],
    ["mode ≠ id_res", { "openid.mode": "cancel" }],
    ["ns absent", { "openid.ns": null }],
    ["claimed_id hors steamcommunity", { "openid.claimed_id": `https://evil.example/openid/id/${STEAM_ID}` }],
    ["claimed_id non strict (suffixe)", { "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}/x` }],
    ["SteamID de 18 chiffres", { "openid.claimed_id": "https://steamcommunity.com/openid/id/765611979602879300" }],
    ["SteamID de 5 chiffres", { "openid.claimed_id": "https://steamcommunity.com/openid/id/12345" }],
    ["identity ≠ claimed_id", { "openid.identity": "https://steamcommunity.com/openid/id/76561197960287931" }],
    ["claimed_id non signé", { "openid.signed": "signed,op_endpoint,identity,return_to,response_nonce,assoc_handle" }],
    ["return_to non signé", { "openid.signed": "signed,op_endpoint,claimed_id,identity,response_nonce,assoc_handle" }],
    ["response_nonce non signé", { "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,assoc_handle" }],
    ["response_nonce absent", { "openid.response_nonce": null }],
    ["response_nonce périmé (> 5 min)", { "openid.response_nonce": "2026-10-02T09:50:00Zxyz" }],
    ["response_nonce illisible", { "openid.response_nonce": "pas-une-date" }],
  ])("%s → null, sans appeler Steam", async (_label, overrides) => {
    await expect(verifySteamOpenId(assertion(overrides), RETURN_TO, NOW)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Steam répond is_valid:false → null", async () => {
    fetchMock.mockResolvedValue(new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n"));
    await expect(verifySteamOpenId(assertion(), RETURN_TO, NOW)).resolves.toBeNull();
  });

  it("is_valid:true noyé dans une autre ligne → null (analyse ligne à ligne)", async () => {
    fetchMock.mockResolvedValue(new Response("foo:bar is_valid:true\nis_valid:false\n"));
    await expect(verifySteamOpenId(assertion(), RETURN_TO, NOW)).resolves.toBeNull();
  });

  it("Steam répond HTTP 500 → lève (indisponible, pas « invalide »)", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));
    await expect(verifySteamOpenId(assertion(), RETURN_TO, NOW)).rejects.toThrow();
  });
});
