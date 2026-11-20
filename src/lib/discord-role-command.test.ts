import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  communityFindFirst: vi.fn(),
  tagUpsert: vi.fn(),
  tagFindUnique: vi.fn(),
  userTagUpsert: vi.fn(),
  userTagDeleteMany: vi.fn(),
  cronUpsert: vi.fn(),
  cronUpdateMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: prismaMocks.findUnique },
    community: { findFirst: prismaMocks.communityFindFirst },
    tag: { upsert: prismaMocks.tagUpsert, findUnique: prismaMocks.tagFindUnique },
    userTag: { upsert: prismaMocks.userTagUpsert, deleteMany: prismaMocks.userTagDeleteMany },
    cronLock: { upsert: prismaMocks.cronUpsert, createMany: prismaMocks.cronUpsert, updateMany: prismaMocks.cronUpdateMany },
  },
}));

import { handleSignedRoleInteraction, roleCreationAllowed, runRoleCommand } from "./discord-role-command";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const USER = "100000000000000004";
const BOT = "100000000000000009";
const BOT_ROLE = "100000000000000010";
const MANAGE_ROLES = String(BigInt(1) << BigInt(28));

type RolePayload = { id: string; name: string; position: number; permissions: string; managed?: boolean };
type Call = { method: string; path: string; body?: Record<string, unknown> };

let calls: Call[] = [];
let guildRoles: RolePayload[] = [];
let memberRoles: string[] = [];
let override: Record<string, () => [number, unknown?]> = {};

function rolePayload(id: string, name: string, position: number, extra: Partial<RolePayload> = {}): RolePayload {
  return { id, name, position, permissions: "0", managed: false, ...extra };
}

function route(method: string, path: string, reply: () => [number, unknown?]) {
  override[`${method} ${path}`] = reply;
}

function json(status: number, payload?: unknown) {
  if (payload === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  override = {};
  guildRoles = [
    rolePayload(BOT_ROLE, "GameNight", 10, { permissions: MANAGE_ROLES }),
    rolePayload("100000000000000011", "Deep Rock Galactic", 3),
    rolePayload("100000000000000012", "Admin", 20, { permissions: "8" }),
  ];
  memberRoles = [];
  prismaMocks.findUnique.mockResolvedValue({ id: "user-1", memberships: [{ id: "membership-1" }] });
  prismaMocks.communityFindFirst.mockResolvedValue({ id: "community-1" });
  prismaMocks.tagUpsert.mockResolvedValue({ id: "tag-1" });
  prismaMocks.tagFindUnique.mockResolvedValue({ id: "tag-1" });
  prismaMocks.userTagUpsert.mockResolvedValue({});
  prismaMocks.userTagDeleteMany.mockResolvedValue({ count: 1 });
  prismaMocks.cronUpsert.mockResolvedValue({});
  prismaMocks.cronUpdateMany.mockResolvedValue({ count: 1 });
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_ROLE_COMMAND_ENABLED", "true");
  // Création fermée par défaut : les tests de création l'ouvrent explicitement.
  vi.stubEnv("DISCORD_ROLE_SELF_CREATION_ENABLED", "true");
  vi.stubEnv("DISCORD_ROLE_AUTOCREATE_ENABLED", "");
  vi.stubEnv("DISCORD_ROLE_MAX_GUILD_ROLES", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace("/api/v10", "");
    calls.push({ method, path, body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined });
    const mocked = override[`${method} ${path}`];
    if (mocked) return json(...mocked());
    if (method === "GET" && path === `/guilds/${GUILD}/roles`) return json(200, guildRoles);
    if (method === "POST" && path === `/guilds/${GUILD}/roles`) {
      const created = rolePayload("100000000000000020", String(calls.at(-1)?.body?.name ?? "Jeu"), 2);
      guildRoles = [...guildRoles, created];
      return json(201, created);
    }
    if (method === "GET" && path === `/guilds/${GUILD}/members/${USER}`) return json(200, { roles: memberRoles });
    if (method === "GET" && path === `/guilds/${GUILD}/members/${BOT}`) return json(200, { roles: [BOT_ROLE] });
    if (method === "GET" && path === "/users/@me") return json(200, { id: BOT });
    if (method === "PUT" && path.startsWith(`/guilds/${GUILD}/members/${USER}/roles/`)) {
      memberRoles = [...memberRoles, path.split("/").at(-1)!];
      return json(204);
    }
    if (method === "DELETE" && path.startsWith(`/guilds/${GUILD}/members/${USER}/roles/`)) {
      memberRoles = memberRoles.filter((id) => id !== path.split("/").at(-1));
      return json(204);
    }
    return json(404, { message: "route non simulée", code: 0 });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const mock of Object.values(prismaMocks)) mock.mockReset();
});

const command = (sub: "chercher" | "attribuer" | "creer" | "retirer", jeu: string, permissions = "0") =>
  runRoleCommand({ sub, query: jeu, guildId: GUILD, invokerId: USER, invokerPermissions: permissions });

const count = (method: string, suffix = "") => calls.filter((call) => call.method === method && call.path.endsWith(suffix)).length;

describe("/role attribuer", () => {
  it("attribue un rôle existant et synchronise le centre d'intérêt", async () => {
    const message = await command("attribuer", "deep rock galactic");
    expect(message).toContain("Rôle **Deep Rock Galactic** ajouté");
    expect(message).toContain("profil GameNight");
    expect(count("PUT")).toBe(1);
    expect(count("POST")).toBe(0);
    expect(prismaMocks.userTagUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_tagId: { userId: "user-1", tagId: "tag-1" } } }),
    );
  });

  it("ne fait rien quand le joueur porte déjà le rôle (interaction rejouée)", async () => {
    await command("attribuer", "Deep Rock Galactic");
    const before = calls.length;
    const replay = await command("attribuer", "Deep Rock Galactic");
    expect(replay).toContain("Tu as déjà le rôle");
    expect(count("PUT")).toBe(1);
    expect(calls.length).toBeGreaterThan(before);
  });

  it("refuse un compte qui n'est pas membre actif de la communauté, sans aucun appel d'écriture", async () => {
    prismaMocks.communityFindFirst.mockResolvedValue(null);
    const message = await command("attribuer", "Deep Rock Galactic");
    expect(message).toContain("n’est pas encore membre actif");
    expect(count("PUT")).toBe(0);
    expect(count("POST")).toBe(0);

    prismaMocks.communityFindFirst.mockResolvedValue({ id: "community-1" });
    prismaMocks.findUnique.mockResolvedValue({ id: "user-1", memberships: [] });
    expect(await command("creer", "Nouveau Jeu")).toContain("n’est pas encore membre actif");
    expect(count("POST")).toBe(0);
  });

  it("refuse un rôle technique sans jamais l'attribuer", async () => {
    const message = await command("attribuer", "Admin");
    expect(message).toContain("technique ou administratif");
    expect(count("PUT")).toBe(0);
    expect(count("POST")).toBe(0);
  });

  it("laisse un membre ordinaire créer un rôle quand le BOT a la permission", async () => {
    const message = await command("attribuer", "Hades II");
    expect(message).toContain("Hades II");
    expect(count("POST")).toBe(1);
    expect(count("PUT")).toBe(1);
  });

  it("refuse la création quand le bot n’a pas « Gérer les rôles »", async () => {
    guildRoles = guildRoles.map((role) => (role.id === BOT_ROLE ? { ...role, permissions: "0" } : role));
    const message = await command("attribuer", "Hades II");
    expect(message).toContain("Gérer les rôles");
    expect(count("POST")).toBe(0);
    expect(count("PUT")).toBe(0);
  });

  it("traduit un refus de permission Discord", async () => {
    route("PUT", `/guilds/${GUILD}/members/${USER}/roles/100000000000000011`, () => [403, { code: 50013, message: "Missing Permissions" }]);
    const message = await command("attribuer", "Deep Rock Galactic");
    expect(message).toContain("Gérer les rôles");
  });

  it("signale un compte Discord non relié sans créer de profil", async () => {
    prismaMocks.findUnique.mockResolvedValue(null);
    // Adhésion vérifiée en amont (autre requête) : ici seul le lien de profil manque.
    const message = await runRoleCommand({
      sub: "attribuer",
      query: "Deep Rock Galactic",
      guildId: GUILD,
      invokerId: USER,
      invokerPermissions: "0",
      membershipCheck: async () => true,
    });
    expect(message).toContain("Connecte ton compte Discord");
    expect(prismaMocks.tagUpsert).not.toHaveBeenCalled();
  });
});

describe("/role creer", () => {
  it("crée une seule fois le rôle, même si l'interaction est rejouée", async () => {
    const created = await command("creer", "Hades II", MANAGE_ROLES);
    expect(created).toContain("Rôle **Hades II** ajouté");
    expect(count("POST")).toBe(1);
    expect(count("PUT")).toBe(1);
    const createBody = calls.find((call) => call.method === "POST")?.body;
    expect(createBody).toMatchObject({ name: "Hades II", permissions: "0", mentionable: false, hoist: false });

    // Rejeu : le rôle existe désormais (variante d'espacement comprise) —
    // aucune création supplémentaire, seulement l'attribution.
    memberRoles = [];
    const replay = await command("creer", "hades  ii", MANAGE_ROLES);
    expect(count("POST")).toBe(1);
    expect(count("PUT")).toBe(2);
    expect(replay).toContain("Hades II");
  });

  it("respecte le plafond de rôles du serveur", async () => {
    vi.stubEnv("DISCORD_ROLE_MAX_GUILD_ROLES", "3");
    const message = await command("creer", "Hades II", MANAGE_ROLES);
    expect(message).toContain("rôles autorisé");
    expect(count("POST")).toBe(0);
  });
});

describe("/role : création de rôle fermée tant qu'elle n'est pas ouverte", () => {
  it.each([
    ["absent", undefined],
    ["vide", ""],
    ["false", "false"],
    ["TRUE (casse différente)", "TRUE"],
    ["1", "1"],
  ])("refuse de créer et n'écrit rien sur Discord quand DISCORD_ROLE_SELF_CREATION_ENABLED est %s", async (_label, value) => {
    if (value === undefined) delete process.env.DISCORD_ROLE_SELF_CREATION_ENABLED;
    else vi.stubEnv("DISCORD_ROLE_SELF_CREATION_ENABLED", value);
    for (const sub of ["attribuer", "creer"] as const) {
      const message = await command(sub, "Hades II", MANAGE_ROLES);
      expect(message).toContain("création est désactivée");
    }
    expect(count("POST")).toBe(0);
    expect(count("PUT")).toBe(0);
  });

  it("attribue toujours un rôle déjà existant quand la création est fermée", async () => {
    vi.stubEnv("DISCORD_ROLE_SELF_CREATION_ENABLED", "");
    const message = await command("attribuer", "Deep Rock Galactic");
    expect(message).toContain("Rôle **Deep Rock Galactic** ajouté");
    expect(count("PUT")).toBe(1);
    expect(count("POST")).toBe(0);
  });

  it("n'ouvre la création directe que pour la valeur exacte true", async () => {
    vi.stubEnv("DISCORD_ROLE_SELF_CREATION_ENABLED", "true");
    const message = await command("attribuer", "Hades II");
    expect(message).toContain("Hades II");
    expect(count("POST")).toBe(1);
  });

  it("roleCreationAllowed : fermée par défaut, ouverte par true ou par la création automatique", () => {
    expect(roleCreationAllowed({})).toBe(false);
    expect(roleCreationAllowed({ DISCORD_ROLE_SELF_CREATION_ENABLED: "" })).toBe(false);
    expect(roleCreationAllowed({ DISCORD_ROLE_SELF_CREATION_ENABLED: "false" })).toBe(false);
    expect(roleCreationAllowed({ DISCORD_ROLE_SELF_CREATION_ENABLED: "TRUE" })).toBe(false);
    expect(roleCreationAllowed({ DISCORD_ROLE_SELF_CREATION_ENABLED: "true" })).toBe(true);
    expect(roleCreationAllowed({ DISCORD_ROLE_AUTOCREATE_ENABLED: "true" })).toBe(true);
    expect(roleCreationAllowed({ DISCORD_ROLE_AUTOCREATE_ENABLED: "yes" })).toBe(false);
  });
});

describe("/role chercher et retirer", () => {
  it("propose les rôles proches sans créer", async () => {
    const message = await command("chercher", "deep rock");
    expect(message).toContain("Deep Rock Galactic");
    expect(count("POST")).toBe(0);
    expect(count("PUT")).toBe(0);
  });

  it("retire un rôle porté, une seule fois", async () => {
    memberRoles = ["100000000000000011"];
    const removed = await command("retirer", "Deep Rock Galactic");
    expect(removed).toContain("profil GameNight ne suit plus");
    expect(prismaMocks.userTagDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1", tagId: "tag-1" } });
    expect(count("DELETE")).toBe(1);
    const again = await command("retirer", "Deep Rock Galactic");
    expect(again).toContain("Tu n’as pas le rôle");
    expect(count("DELETE")).toBe(1);
  });
});

describe("réception de l'interaction", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    type: 2,
    id: "100000000000000030",
    application_id: APP,
    token: "interaction-token",
    guild_id: GUILD,
    member: { permissions: "0", user: { id: USER, username: "maxime", bot: false } },
    data: { name: "role", options: [{ type: 1, name: "attribuer", options: [{ type: 3, name: "jeu", value: "Deep Rock Galactic" }] }] },
    ...overrides,
  });

  it("reste muette et sans appel Discord quand la commande n'est pas activée", () => {
    vi.stubEnv("DISCORD_ROLE_COMMAND_ENABLED", "");
    const output = handleSignedRoleInteraction(body(), String(Math.floor(Date.now() / 1000)));
    expect(output.status).toBe(200);
    expect(output.runRole).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("acquitte immédiatement puis répond en privé", async () => {
    const output = handleSignedRoleInteraction(body(), String(Math.floor(Date.now() / 1000)));
    expect(output.status).toBe(200);
    expect(output.body).toMatchObject({ type: 5 });
    expect(calls).toHaveLength(0);

    route("PATCH", `/webhooks/${APP}/interaction-token/messages/@original`, () => [200, { id: "1", channel_id: "2" }]);
    await output.runRole?.();
    expect(calls.some((call) => call.method === "PATCH")).toBe(true);
  });

  it("accepte `/role jeu:…` sans sous-commande", async () => {
    route("PATCH", `/webhooks/${APP}/interaction-token/messages/@original`, () => [200, { id: "1", channel_id: "2" }]);
    const output = handleSignedRoleInteraction(
      body({ data: { name: "role", options: [{ type: 3, name: "jeu", value: "Deep Rock Galactic" }] } }),
      String(Math.floor(Date.now() / 1000))
    );
    expect(output.status).toBe(200);
    await output.runRole?.();
    expect(count("PUT")).toBe(1);

    const invalid = handleSignedRoleInteraction(
      body({ data: { name: "role", options: [{ type: 3, name: "autre", value: "x" }] } }),
      String(Math.floor(Date.now() / 1000))
    );
    expect(invalid.status).toBe(400);
  });

  it("refuse une interaction trop ancienne ou d'une autre application", () => {
    expect(handleSignedRoleInteraction(body(), String(Math.floor(Date.now() / 1000) - 400)).status).toBe(400);
    expect(handleSignedRoleInteraction(body({ application_id: "100000000000000099" }), String(Math.floor(Date.now() / 1000))).status).toBe(400);
    expect(handleSignedRoleInteraction({ type: 2, data: { name: "role" } }, String(Math.floor(Date.now() / 1000))).status).toBe(400);
  });
});
