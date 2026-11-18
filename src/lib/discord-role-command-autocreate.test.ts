import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  communityFindFirst: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    community: { findFirst: mocks.communityFindFirst },
    tag: { upsert: vi.fn(), findUnique: vi.fn() },
    userTag: { upsert: vi.fn(), deleteMany: vi.fn() },
    cronLock: { upsert: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
  },
}));
vi.mock("@/lib/discord-role-autocreate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discord-role-autocreate")>()),
  requestRoleCreation: mocks.request,
}));

import { runRoleCommand } from "./discord-role-command";

const GUILD = "100000000000000002";
const USER = "100000000000000004";
const BOT = "100000000000000009";
const BOT_ROLE = "100000000000000010";
const MANAGE_ROLES = String(BigInt(1) << BigInt(28));

let calls: Array<{ method: string; path: string }> = [];
let guildRoles: Array<{ id: string; name: string; position: number; permissions: string; managed: boolean }> = [];

const json = (status: number, payload?: unknown) =>
  payload === undefined
    ? new Response(null, { status })
    : new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  guildRoles = [
    { id: BOT_ROLE, name: "GameNight", position: 10, permissions: MANAGE_ROLES, managed: false },
    { id: "100000000000000011", name: "Zelda : Breath of the Wild", position: 3, permissions: "0", managed: false },
  ];
  mocks.findUnique.mockResolvedValue({ id: "user-1", memberships: [{ id: "m1" }] });
  mocks.communityFindFirst.mockResolvedValue({ id: "community-1" });
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("DISCORD_ROLE_COMMAND_ENABLED", "true");
  vi.stubEnv("DISCORD_ROLE_AUTOCREATE_ENABLED", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input)).pathname.replace("/api/v10", "");
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, path });
      if (method === "GET" && path === `/guilds/${GUILD}/roles`) return json(200, guildRoles);
      if (method === "GET" && path === `/guilds/${GUILD}/members/${USER}`) return json(200, { roles: [] });
      if (method === "GET" && path === `/guilds/${GUILD}/members/${BOT}`) return json(200, { roles: [BOT_ROLE] });
      if (method === "GET" && path === "/users/@me") return json(200, { id: BOT });
      return json(404, { message: "route non simulée", code: 0 });
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.request.mockReset();
});

const command = (sub: "chercher" | "attribuer" | "creer", jeu: string) =>
  runRoleCommand({ sub, query: jeu, guildId: GUILD, invokerId: USER, invokerPermissions: "0" });
const writes = () => calls.filter((call) => call.method !== "GET");

describe("/role avec DISCORD_ROLE_AUTOCREATE_ENABLED", () => {
  it("n'écrit rien sur Discord : la création est déléguée à la file", async () => {
    mocks.request.mockResolvedValue({ status: "queued", requestId: "req-1" });
    const message = await command("creer", "Hades II");
    expect(message).toContain("Demande enregistrée");
    expect(message).toContain("sans aucune permission");
    expect(writes()).toEqual([]);
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ communityId: "community-1", guildId: GUILD, discordId: USER, name: "Hades II", roleCount: 2 })
    );
  });

  it("`attribuer` d'un rôle absent passe aussi par la file", async () => {
    mocks.request.mockResolvedValue({ status: "queued", requestId: "req-1" });
    expect(await command("attribuer", "Hades II")).toContain("Demande enregistrée");
    expect(writes()).toEqual([]);
  });

  it.each([
    [{ status: "already_pending" }, "déjà en cours"],
    [{ status: "quota", nextAt: new Date("2026-11-25T12:00:00Z") }, "une par joueur et par semaine"],
    [{ status: "guild_full" }, "nombre de rôles autorisé"],
    [{ status: "busy" }, "Réessaie dans quelques secondes"],
    [{ status: "unavailable" }, "pas disponible"],
  ])("traduit %j", async (result, expected) => {
    mocks.request.mockResolvedValue(result);
    expect(await command("creer", "Hades II")).toContain(expected);
    expect(writes()).toEqual([]);
  });

  it("un rôle existant est attribué directement, sans demande", async () => {
    // Pas de route PUT simulée : l'attribution échoue proprement, mais aucune demande n'est créée.
    await command("attribuer", "Zelda : Breath of the Wild");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("la recherche retrouve un rôle malgré l'ordre des mots", async () => {
    expect(await command("chercher", "breath wild zelda")).toContain("Zelda : Breath of the Wild");
  });

  it("la recherche sans résultat annonce la règle d'une demande par semaine", async () => {
    expect(await command("chercher", "Hades II")).toContain("une demande par semaine");
  });
});

describe("/role sans le drapeau", () => {
  it("ne délègue jamais à la file", async () => {
    vi.stubEnv("DISCORD_ROLE_AUTOCREATE_ENABLED", "");
    await command("creer", "Hades II");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
