import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.admin }));

import { GET, POST } from "./route";

const OWNER = "699223334046531636";

describe("The Tower: layout Preview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("Preview bloque POST avant authentification et tout appel Discord", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await POST({} as never);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "preview_disabled" });
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("The Tower: layout GET (garde propriétaire, fail-closed)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  async function expectForbiddenWithoutDiscordCall(
    currentUser: unknown,
    admin: unknown,
  ) {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-test");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    mocks.currentUser.mockResolvedValue(currentUser);
    mocks.admin.mockResolvedValue(admin);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Forbidden" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(fetcher).not.toHaveBeenCalled();
  }

  it("refuse un administrateur qui n'est pas le propriétaire, sans appel Discord ni donnée", async () => {
    await expectForbiddenWithoutDiscordCall({ id: "u1" }, { id: "u1", discordId: "111111111111111111" });
  });

  it("refuse un administrateur sans discordId", async () => {
    await expectForbiddenWithoutDiscordCall({ id: "u1" }, { id: "u1", discordId: null });
  });

  it("refuse un non-administrateur (requireAdmin renvoie null)", async () => {
    await expectForbiddenWithoutDiscordCall({ id: "u1" }, null);
  });

  it("refuse un visiteur non connecté sans même évaluer requireAdmin", async () => {
    await expectForbiddenWithoutDiscordCall(null, { id: "u1", discordId: OWNER });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("laisse passer le propriétaire : lecture seule Discord du serveur configuré", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-test");
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    vi.stubGlobal("fetch", fetcher);
    mocks.currentUser.mockResolvedValue({ id: "owner" });
    mocks.admin.mockResolvedValue({ id: "owner", discordId: OWNER });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ mode: "read-only", writeEnabled: false, guildId: "553922938101825536" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, { method: string }];
    expect(url).toContain("/guilds/553922938101825536/channels");
    expect(init.method).toBe("GET");
  });
});
