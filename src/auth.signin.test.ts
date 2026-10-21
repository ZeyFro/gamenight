import type { AuthConfig } from "@auth/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("fresh OAuth signIn guild snapshot", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ id: "user" });
    mocks.findUnique.mockResolvedValue(null);
    mocks.sync.mockResolvedValue(["a", "b"]);
    mocks.ensureDefault.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (fn) => fn({ user: { upsert: mocks.upsert, findUnique: mocks.findUnique } }));
    mocks.http.mockResolvedValue(Response.json([{ id: "111" }, { id: "333" }]));
    vi.stubGlobal("fetch", mocks.http);
    for (const flag of ["AUTH_REQUIRE_GUILD_MEMBER", "COMMUNITY_PICKER_ENABLED", "COMMUNITY_ISOLATION_ENABLED"]) vi.stubEnv(flag, "false");
    vi.stubEnv("ADMIN_DISCORD_IDS", "999");
    await import("./auth");
  });
  const call = (id = "222", scope = "identify email guilds", token = "test-secret-token") => mocks.config!.callbacks!.signIn!({
    user: { id, name: "Test" }, profile: { id, username: "Test" },
    account: { provider: "discord", providerAccountId: id, type: "oauth", access_token: token, scope },
  });
  it("no flag at all: one guild request, transactional sync, login accepted", async () => {
    expect(await call()).toBe(true);
    expect(mocks.http).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), "user", ["111", "333"], expect.any(Date));
  });
  it.each(["AUTH_REQUIRE_GUILD_MEMBER", "COMMUNITY_ISOLATION_ENABLED", "COMMUNITY_PICKER_ENABLED"])(
    "%s has no effect: same guild request and transactional sync whatever its value",
    async (flag) => {
      for (const value of ["", "false", "TRUE", "1", "true"]) {
        vi.clearAllMocks();
        mocks.upsert.mockResolvedValue({ id: "user" });
        mocks.sync.mockResolvedValue(["a", "b"]);
        mocks.transaction.mockImplementation(async (fn) => fn({ user: { upsert: mocks.upsert, findUnique: mocks.findUnique } }));
        mocks.http.mockResolvedValue(Response.json([{ id: "111" }, { id: "333" }]));
        vi.stubEnv(flag, value);
        expect(await call()).toBe(true);
        expect(mocks.http).toHaveBeenCalledOnce();
        expect(mocks.transaction).toHaveBeenCalledOnce();
      }
    },
  );
  it("existing account is synchronized too", async () => {
    mocks.findUnique.mockResolvedValue({ id: "user" });
    expect(await call()).toBe(true);
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
  it("new account with no authorized guild is denied in the transaction", async () => {
    mocks.sync.mockResolvedValue([]);
    expect(await call()).toBe(false);
  });
  it.each(["AUTH_REQUIRE_GUILD_MEMBER", "COMMUNITY_PICKER_ENABLED"])("existing account with no guild is denied even with %s=false", async (flag) => {
    vi.stubEnv(flag, "false");
    mocks.findUnique.mockResolvedValue({ id: "user" });
    mocks.sync.mockResolvedValue([]);
    expect(await call()).toBe(false);
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
  it("platform admin with no guild may log in but receives no membership", async () => {
    mocks.sync.mockResolvedValue([]);
    expect(await call("999")).toBe(true);
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
  it("zero guilds leads to denial, not to a selector", async () => {
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    mocks.sync.mockResolvedValue([]);
    expect(await call()).toBe(false);
  });
  it.each(["identify email", ""])("missing scope %j denied without API or writes", async (scope) => {
    expect(await call("222", scope)).toBe(false);
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("missing token denied", async () => {
    expect(await call("222", "guilds", "")).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("API failure: memberships untouched, no secret logged", async () => {
    mocks.http.mockRejectedValue(new Error("OAuth code=secret-code token=test-secret-token"));
    expect(await call()).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify([...mocks.warn.mock.calls, ...mocks.error.mock.calls])).not.toMatch(/secret-code|test-secret-token/);
  });
  it("membership persistence failure denies login", async () => {
    mocks.sync.mockRejectedValueOnce(new Error("DB down"));
    expect(await call()).toBe(false);
  });
  it("no profile: denied", async () => {
    expect(await mocks.config!.callbacks!.signIn!({ user: { id: "222" }, account: null })).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("Auth.js logging omits callback causes, codes and token bodies", () => {
    const error = Object.assign(new Error("code=secret-code"), { cause: { err: new Error("test-secret-token") } });
    mocks.config!.logger!.error!(error);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toMatch(/secret-code|test-secret-token/);
  });
});
