import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    platformConnectionSuggestion: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  fetchDiscordConnections,
  importConnectionSuggestionsAtLogin,
  isDiscordConnectionsScopeEnabled,
  mapConnectionsToSuggestions,
  prefillIdentifier,
  scopeIncludesConnections,
} from "@/lib/discord-connections";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("flag et scope", () => {
  it("OFF par défaut, actif seulement si exactement `true`", () => {
    expect(isDiscordConnectionsScopeEnabled()).toBe(false);
    vi.stubEnv("DISCORD_CONNECTIONS_SCOPE_ENABLED", "1");
    expect(isDiscordConnectionsScopeEnabled()).toBe(false);
    vi.stubEnv("DISCORD_CONNECTIONS_SCOPE_ENABLED", "true");
    expect(isDiscordConnectionsScopeEnabled()).toBe(true);
  });
  it("détecte le scope connections", () => {
    expect(scopeIncludesConnections("identify email guilds connections")).toBe(true);
    expect(scopeIncludesConnections("identify email guilds")).toBe(false);
    expect(scopeIncludesConnections(undefined)).toBe(false);
  });
});

describe("mapping des connexions Discord", () => {
  it("mappe xbox, playstation, epicgames, battlenet, riotgames, steam et ignore le reste", () => {
    const result = mapConnectionsToSuggestions([
      { type: "xbox", id: "1", name: "GamerX" },
      { type: "playstation", id: "2", name: "PsnY" },
      { type: "epicgames", id: "3", name: "EpicZ" },
      { type: "battlenet", id: "4", name: "Bat#1234" },
      { type: "riotgames", id: "5", name: "Riot#EUW" },
      { type: "steam", id: "76561198000000000", name: "SteamName" },
      { type: "twitch", id: "6", name: "streamer" },
      { type: "github", id: "7", name: "dev" },
    ]);
    expect(result).toEqual([
      { platform: "xbox", value: "GamerX" },
      { platform: "playstation", value: "PsnY" },
      { platform: "epicgames", value: "EpicZ" },
      { platform: "battlenet", value: "Bat#1234" },
      { platform: "riotgames", value: "Riot#EUW" },
      { platform: "steam", value: "76561198000000000" },
    ]);
  });
  it("garde la première connexion par plateforme, refuse valeurs vides, trop longues ou multilignes", () => {
    expect(mapConnectionsToSuggestions([
      { type: "xbox", id: "1", name: "Premier" },
      { type: "xbox", id: "2", name: "Second" },
      { type: "playstation", id: "3", name: "   " },
      { type: "epicgames", id: "4", name: "a\nb" },
      { type: "battlenet", id: "5", name: "x".repeat(101) },
    ])).toEqual([{ platform: "xbox", value: "Premier" }]);
  });
  it("tolère une réponse inattendue", () => {
    expect(mapConnectionsToSuggestions({ message: "401" })).toEqual([]);
    expect(mapConnectionsToSuggestions([null, 3, "x", { type: 4 }])).toEqual([]);
  });
});

describe("préremplissage", () => {
  it("la valeur déjà saisie n'est jamais écrasée par une suggestion", () => {
    expect(prefillIdentifier("MonPseudo", "Suggere")).toEqual({ value: "MonPseudo", suggested: false });
  });
  it("champ vide : suggestion proposée, modifiable", () => {
    expect(prefillIdentifier(null, "Suggere")).toEqual({ value: "Suggere", suggested: true });
    expect(prefillIdentifier("", "Suggere")).toEqual({ value: "Suggere", suggested: true });
  });
  it("rien à proposer", () => {
    expect(prefillIdentifier(null, undefined)).toEqual({ value: "", suggested: false });
  });
});

describe("lecture des connexions", () => {
  it("envoie le jeton uniquement en Authorization, jamais en journal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ type: "xbox", id: "1", name: "G" }]), { status: 200 }));
    const result = await fetchDiscordConnections("secret-token", fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, suggestions: [{ platform: "xbox", value: "G" }] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://discord.com/api/v10/users/@me/connections");
    expect(fetchMock.mock.calls[0][0]).not.toContain("secret-token");
  });
  it("échec réseau ou statut non OK : indisponible, sans lever", async () => {
    expect(await fetchDiscordConnections("t", vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch)).toEqual({ ok: false });
    expect(await fetchDiscordConnections("t", vi.fn().mockResolvedValue(new Response("", { status: 403 })) as unknown as typeof fetch)).toEqual({ ok: false });
  });
});

describe("import à la connexion", () => {
  const input = { discordId: "d1", accessToken: "tok", scope: "identify email guilds connections" };

  it("ne fait rien si le flag est éteint, même avec le scope", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(await importConnectionSuggestionsAtLogin(input)).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("ne fait rien sans le scope accordé (connexion ordinaire)", async () => {
    vi.stubEnv("DISCORD_CONNECTIONS_SCOPE_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn());
    expect(await importConnectionSuggestionsAtLogin({ ...input, scope: "identify email guilds" })).toBe("skipped");
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("stocke des suggestions, jamais dans User", async () => {
    vi.stubEnv("DISCORD_CONNECTIONS_SCOPE_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ type: "xbox", id: "1", name: "G" }]), { status: 200 })));
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1" } as never);
    expect(await importConnectionSuggestionsAtLogin(input)).toBe("stored");
    expect(prisma.platformConnectionSuggestion.createMany).toHaveBeenCalledWith({ data: [{ userId: "u1", platform: "xbox", value: "G" }] });
    vi.unstubAllGlobals();
  });
  it("API indisponible : n'échoue pas, journal sans jeton", async () => {
    vi.stubEnv("DISCORD_CONNECTIONS_SCOPE_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("tok")));
    expect(await importConnectionSuggestionsAtLogin(input)).toBe("unavailable");
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain("tok");
    vi.unstubAllGlobals();
  });
});
