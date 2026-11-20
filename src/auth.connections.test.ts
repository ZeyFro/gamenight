import type { AuthConfig } from "@auth/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Non-régression de la connexion avec le scope optionnel `connections` (sujet J) : la connexion
 * fermée S0 (Membership ACTIVE requise), l'exception `ADMIN_DISCORD_IDS` et l'exigence du scope
 * `guilds` ne changent pas ; la lecture des connexions n'a lieu qu'après admission, jamais en
 * cas de refus, et ne bloque jamais la connexion.
 */
const mocks = vi.hoisted(() => ({
  config: null as AuthConfig | null,
  upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), transaction: vi.fn(), sync: vi.fn(),
  ensureDefault: vi.fn(), http: vi.fn(), warn: vi.fn(), error: vi.fn(),
  deleteMany: vi.fn(), createMany: vi.fn(),
}));
vi.mock("next-auth", () => ({ default: (config: AuthConfig) => {
  mocks.config = config;
  return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
} }));
vi.mock("next-auth/providers/discord", () => ({ default: () => ({ id: "discord" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { upsert: mocks.upsert, findUnique: mocks.findUnique, update: mocks.update },
  platformConnectionSuggestion: { deleteMany: mocks.deleteMany, createMany: mocks.createMany },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/community-oauth", async (original) => ({
  ...(await original<typeof import("@/lib/community-oauth")>()), syncOAuthMemberships: mocks.sync,
}));
vi.mock("@/lib/default-community", () => ({ ensureDefaultCommunityRecord: mocks.ensureDefault }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: mocks.error, info: vi.fn() } }));

const SCOPE = "identify email guilds connections";
const SECRET = "very-secret-token";

function route(connections: Response | Error) {
  mocks.http.mockImplementation(async (url: string) => {
    if (String(url).includes("/users/@me/guilds")) return Response.json([{ id: "111" }]);
    if (connections instanceof Error) throw connections;
    return connections;
  });
}
const connectionsCalls = () => mocks.http.mock.calls.filter(([url]) => String(url).includes("/connections"));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("signIn avec le scope connections", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ id: "user" });
    mocks.findUnique.mockResolvedValue(null);
    mocks.sync.mockResolvedValue(["a"]);
    mocks.ensureDefault.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === "function" ? arg({ user: { upsert: mocks.upsert, findUnique: mocks.findUnique } }) : arg);
    route(Response.json([{ type: "xbox", id: "1", name: "GamerX" }]));
    vi.stubGlobal("fetch", mocks.http);
    vi.stubEnv("ADMIN_DISCORD_IDS", "999");
    vi.stubEnv("DISCORD_CONNECTIONS_SCOPE_ENABLED", "true");
    await import("./auth");
  });
  const call = (id = "222", scope = SCOPE) => mocks.config!.callbacks!.signIn!({
    user: { id, name: "Test" }, profile: { id, username: "Test" },
    account: { provider: "discord", providerAccountId: id, type: "oauth", access_token: SECRET, scope },
  });

  it("membre ACTIVE : connexion acceptée et suggestions stockées (jamais le jeton)", async () => {
    mocks.findUnique.mockImplementation(async (args: { select: { id: boolean } }) => (args ? { id: "user" } : null));
    expect(await call()).toBe(true);
    expect(connectionsCalls()).toHaveLength(1);
    expect(mocks.createMany).toHaveBeenCalledWith({ data: [{ userId: "user", platform: "xbox", value: "GamerX" }] });
    expect(JSON.stringify([...mocks.warn.mock.calls, ...mocks.error.mock.calls])).not.toContain(SECRET);
  });
  it("compte sans Membership ACTIVE : refusé, connexions jamais lues", async () => {
    mocks.sync.mockResolvedValue([]);
    expect(await call()).toBe(false);
    expect(connectionsCalls()).toHaveLength(0);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
  it("compte existant sans Membership ACTIVE : refusé aussi", async () => {
    mocks.findUnique.mockResolvedValue({ id: "user" });
    mocks.sync.mockResolvedValue([]);
    expect(await call()).toBe(false);
    expect(connectionsCalls()).toHaveLength(0);
  });
  it("ADMIN_DISCORD_IDS sans Membership : connexion permise comme avant", async () => {
    mocks.sync.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue({ id: "user" });
    expect(await call("999")).toBe(true);
  });
  it("le scope guilds reste obligatoire même avec connections", async () => {
    expect(await call("222", "identify email connections")).toBe(false);
    expect(connectionsCalls()).toHaveLength(0);
  });
  it("flag éteint : aucune lecture des connexions, connexion inchangée", async () => {
    vi.stubEnv("DISCORD_CONNECTIONS_SCOPE_ENABLED", "false");
    expect(await call()).toBe(true);
    expect(connectionsCalls()).toHaveLength(0);
  });
  it("connexion ordinaire (sans scope connections) : aucune lecture", async () => {
    expect(await call("222", "identify email guilds")).toBe(true);
    expect(connectionsCalls()).toHaveLength(0);
  });
  it.each([new Error("réseau"), new Response("nope", { status: 403 })])("API connexions indisponible : la connexion reste acceptée", async (failure) => {
    route(failure);
    expect(await call()).toBe(true);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});

describe("callback jwt avec le scope connections", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
    vi.stubEnv("DISCORD_TOKEN_ENCRYPTION_KEY", "a".repeat(64));
    await import("./auth");
  });
  const jwt = (scope: string) => mocks.config!.callbacks!.jwt!({
    token: {}, profile: { id: "222" },
    account: { provider: "discord", providerAccountId: "222", type: "oauth", access_token: SECRET, refresh_token: "refresh", expires_at: 1, scope },
  } as never);

  it("un jeton portant le scope connections n'est pas conservé en base", async () => {
    await jwt(SCOPE);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("la connexion ordinaire conserve le comportement existant (tentative de persistance)", async () => {
    await jwt("identify email guilds");
    expect(mocks.update.mock.calls.length + mocks.warn.mock.calls.length).toBeGreaterThan(0);
  });
});
