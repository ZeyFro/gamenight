import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * Migration paresseuse des anciens jetons Discord (non chiffrés) : le cron
 * `refreshAllDiscordProfiles` continue de les LIRE (tolérance) et les
 * RÉÉCRIT chiffrés au passage. Vrai module de chiffrement, Prisma et
 * `fetch` simulés.
 */

const { prismaMock, fetchMock, loggerMock } = vi.hoisted(() => ({
  prismaMock: { user: { findMany: vi.fn(), update: vi.fn() } },
  fetchMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

import { refreshAllDiscordProfiles } from "./discord-profile";
import { decryptToken, encryptToken } from "./discord-token-crypto";

const KEY = randomBytes(32);

function user(overrides: Record<string, unknown> = {}) {
  return {
    discordId: "1",
    discordName: "old",
    discordAvatar: null,
    discordAccessToken: "legacy-access",
    discordRefreshToken: "legacy-refresh",
    discordTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

const profileOk = () =>
  new Response(
    JSON.stringify({ id: "1", username: "new", global_name: null, discriminator: "0", avatar: "abc" }),
    { status: 200 }
  );

describe("refreshAllDiscordProfiles — migration paresseuse des jetons legacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset().mockImplementation(async () => profileOk());
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_CLIENT_ID", "cid");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
    vi.stubEnv("DISCORD_TOKEN_ENCRYPTION_KEY", KEY.toString("base64"));
    prismaMock.user.update.mockResolvedValue({});
  });

  function stub(users: ReturnType<typeof user>[]) {
    prismaMock.user.findMany.mockImplementation(async (args: { where: { discordRefreshToken: unknown } }) =>
      args.where.discordRefreshToken === null ? [] : users
    );
  }

  const writesOf = (field: "discordAccessToken" | "discordRefreshToken") =>
    prismaMock.user.update.mock.calls
      .map(([arg]) => arg.data[field] as string | undefined)
      .filter((v): v is string => typeof v === "string");

  it("jetons legacy : lus tels quels (appel Discord OK) puis réécrits chiffrés", async () => {
    stub([user()]);

    const result = await refreshAllDiscordProfiles();

    expect(result.oauth).toMatchObject({ checked: 1, updated: 1, failed: 0 });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer legacy-access");
    const [access] = writesOf("discordAccessToken");
    const [refresh] = writesOf("discordRefreshToken");
    expect(access.startsWith("enc:")).toBe(true);
    expect(refresh.startsWith("enc:")).toBe(true);
    expect(decryptToken(access, KEY)).toEqual({ status: "encrypted", value: "legacy-access" });
    expect(decryptToken(refresh, KEY)).toEqual({ status: "encrypted", value: "legacy-refresh" });
  });

  it("jetons déjà chiffrés : aucune réécriture de jeton", async () => {
    stub([
      user({
        discordAccessToken: encryptToken("a", KEY),
        discordRefreshToken: encryptToken("r", KEY),
      }),
    ]);

    await refreshAllDiscordProfiles();

    expect(writesOf("discordAccessToken")).toHaveLength(0);
    expect(writesOf("discordRefreshToken")).toHaveLength(0);
  });

  it("seul le jeton legacy est réécrit (l'autre, déjà chiffré, n'est pas touché)", async () => {
    stub([user({ discordRefreshToken: encryptToken("r", KEY) })]);

    await refreshAllDiscordProfiles();

    expect(writesOf("discordAccessToken")).toHaveLength(1);
    expect(writesOf("discordRefreshToken")).toHaveLength(0);
  });

  it("échec d'écriture : journalisé (jamais silencieux), le cron continue et met le profil à jour", async () => {
    stub([user()]);
    prismaMock.user.update.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
      if (arg.data.discordAccessToken) throw new Error("db down");
      return {};
    });

    const result = await refreshAllDiscordProfiles();

    expect(loggerMock.error).toHaveBeenCalled();
    expect(result.oauth).toMatchObject({ updated: 1, failed: 0 });
  });
});
