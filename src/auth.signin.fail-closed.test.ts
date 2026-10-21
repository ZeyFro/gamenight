import type { AuthConfig } from "@auth/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S0 — connexion fermée par défaut. Un compte Discord qui n'est membre d'aucune
 * communauté ACTIVE ne doit pas obtenir de session, QUELLE QUE SOIT la valeur de
 * `AUTH_REQUIRE_GUILD_MEMBER` (absente, vide, « false »…). Les `discordId` de
 * `ADMIN_DISCORD_IDS` passent toujours (filet anti-verrouillage). Même échafaudage
 * que `auth.signin.test.ts` : aucun accès réseau ni base, tout est simulé.
 */
const mocks = vi.hoisted(() => ({
  config: null as AuthConfig | null,
  upsert: vi.fn(), findUnique: vi.fn(), transaction: vi.fn(), sync: vi.fn(),
  ensureDefault: vi.fn(), http: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
vi.mock("next-auth", () => ({ default: (config: AuthConfig) => {
  mocks.config = config;
  return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
} }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { upsert: mocks.upsert, findUnique: mocks.findUnique }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/community-oauth", async (original) => ({
  ...(await original<typeof import("@/lib/community-oauth")>()), syncOAuthMemberships: mocks.sync,
}));
vi.mock("@/lib/default-community", () => ({ ensureDefaultCommunityRecord: mocks.ensureDefault }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: mocks.error } }));

const FLAGS = ["AUTH_REQUIRE_GUILD_MEMBER", "COMMUNITY_PICKER_ENABLED", "COMMUNITY_ISOLATION_ENABLED"] as const;

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("S0 — connexion fermée par défaut", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ id: "user" });
    mocks.findUnique.mockResolvedValue(null);
    mocks.sync.mockResolvedValue([]); // aucune communauté ACTIVE par défaut
    mocks.ensureDefault.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (fn) => fn({ user: { upsert: mocks.upsert, findUnique: mocks.findUnique } }));
    mocks.http.mockResolvedValue(Response.json([{ id: "111" }, { id: "333" }]));
    vi.stubGlobal("fetch", mocks.http);
    for (const flag of FLAGS) vi.stubEnv(flag, undefined as unknown as string); // variables ABSENTES
    vi.stubEnv("ADMIN_DISCORD_IDS", "999");
    await import("./auth");
  });
  const call = (id = "222", scope = "identify email guilds", token = "fake-token") => mocks.config!.callbacks!.signIn!({
    user: { id, name: "Test" }, profile: { id, username: "Test" },
    account: { provider: "discord", providerAccountId: id, type: "oauth", access_token: token, scope },
  });

  it("variable absente : un compte inconnu sans communauté ACTIVE est refusé", async () => {
    expect(await call()).toBe(false);
  });
  it.each(["", "false", "FALSE", "0", "TRUE", "1"])("AUTH_REQUIRE_GUILD_MEMBER=%j : même refus (la valeur n'ouvre rien)", async (value) => {
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", value);
    expect(await call()).toBe(false);
  });
  it("un compte déjà connu (ligne User existante) sans communauté ACTIVE est refusé aussi", async () => {
    mocks.findUnique.mockResolvedValue({ id: "user" });
    expect(await call()).toBe(false);
  });
  it("un membre d'une communauté ACTIVE est accepté, avec un instantané Discord demandé même sans aucun drapeau", async () => {
    mocks.sync.mockResolvedValue(["communaute-active"]);
    expect(await call()).toBe(true);
    expect(mocks.http).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), "user", ["111", "333"], expect.any(Date));
  });
  it("un admin (ADMIN_DISCORD_IDS) passe toujours, même sans aucune communauté", async () => {
    expect(await call("999")).toBe(true);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("instantané Discord indisponible : un compte ordinaire est refusé (fermé par défaut)", async () => {
    mocks.http.mockRejectedValue(new Error("réseau"));
    expect(await call()).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("portée Discord « guilds » absente : refus, sans appel API", async () => {
    expect(await call("222", "identify email")).toBe(false);
    expect(mocks.http).not.toHaveBeenCalled();
  });
  it("admin + API Discord en échec : accepté, simple upsert sans synchronisation", async () => {
    mocks.http.mockRejectedValue(new Error("réseau"));
    expect(await call("999")).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("admin + portée « guilds » absente : accepté, sans appel API ni synchronisation", async () => {
    expect(await call("999", "identify email")).toBe(true);
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("admin + synchronisation réussie mais zéro communauté : accepté, synchronisation exécutée", async () => {
    expect(await call("999")).toBe(true);
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), "user", ["111", "333"], expect.any(Date));
  });
  it("compte refusé : écriture seulement dans la transaction annulée (erreur interne), jamais hors transaction", async () => {
    const txUpsert = vi.fn().mockResolvedValue({ id: "user" });
    mocks.transaction.mockImplementation(async (fn) => fn({ user: { upsert: txUpsert, findUnique: mocks.findUnique } }));
    expect(await call()).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled(); // client global : aucune écriture directe
    expect(txUpsert).toHaveBeenCalledOnce();
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow("No authorized community");
  });
  it("l'existence du compte est lue DANS la transaction (client tx), jamais via le client global", async () => {
    const txFindUnique = vi.fn().mockResolvedValue({ id: "user" });
    mocks.transaction.mockImplementation(async (fn) => fn({ user: { upsert: mocks.upsert, findUnique: txFindUnique } }));
    expect(await call()).toBe(false);
    expect(txFindUnique).toHaveBeenCalledOnce();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    await expect(mocks.transaction.mock.results[0].value).resolves.toBe(false); // existant : pas de retour arrière
  });
  it("compte déjà en base sans communauté : refusé, la synchronisation (départs) n'est pas annulée", async () => {
    mocks.findUnique.mockResolvedValue({ id: "user" });
    expect(await call()).toBe(false);
    expect(mocks.sync).toHaveBeenCalledOnce();
    await expect(mocks.transaction.mock.results[0].value).resolves.toBe(false);
  });
  it("ensureDefaultCommunityRecord rejette : non-admin refusé, journal distinct de l'instantané", async () => {
    mocks.ensureDefault.mockRejectedValue(new Error("db down"));
    expect(await call()).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith("auth", expect.stringContaining("Default community unavailable"));
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toMatch(/snapshot unavailable/);
  });
  it("ensureDefaultCommunityRecord rejette : admin accepté, sans transaction ni synchronisation", async () => {
    mocks.ensureDefault.mockRejectedValue(new Error("db down"));
    expect(await call("999")).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("admin + échec de la transaction : refusé (erreur journalisée)", async () => {
    mocks.sync.mockRejectedValue(new Error("DB down"));
    expect(await call("999")).toBe(false);
    expect(mocks.error).toHaveBeenCalledOnce();
  });
  it("admin + jeton absent : accepté, sans appel API ni synchronisation", async () => {
    expect(await call("999", "identify email guilds", "")).toBe(true);
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });
  it("refus d'un compte jamais vu et d'un compte existant : même warn, aucun error", async () => {
    mocks.http.mockImplementation(async () => Response.json([{ id: "111" }])); // corps neuf à chaque appel
    expect(await call()).toBe(false); // jamais vu : retour arrière
    mocks.findUnique.mockResolvedValue({ id: "user" });
    expect(await call()).toBe(false); // existant : transaction validée puis refus
    const denied = mocks.warn.mock.calls.filter(([, message]) => message === "OAuth login denied: no ACTIVE community.");
    expect(denied).toHaveLength(2);
    expect(denied[0]).toEqual(denied[1]);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it("aucun secret dans les journaux (refus, échec API, admin sans instantané)", async () => {
    mocks.http.mockRejectedValue(new Error("OAuth code=secret-code token=test-secret-token"));
    await call("222", "identify email guilds", "test-secret-token");
    await call("999", "identify email guilds", "test-secret-token");
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([...mocks.warn.mock.calls, ...mocks.error.mock.calls])).not.toMatch(/secret-code|test-secret-token/);
  });
});
