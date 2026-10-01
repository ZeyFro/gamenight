import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cron `steam-library-sync` — ordre de traitement quand le budget de temps
 * est atteint avant la fin de la liste. Sans tri, `findMany` renvoie
 * toujours les mêmes comptes en premier : ceux placés après la limite ne
 * sont JAMAIS rafraîchis (famine déterministe). Le tri « vérifié le moins
 * récemment d'abord » garantit une rotation. Postgres isolé
 * (`TEST_DATABASE_URL`), `refreshSteamActivity` simulé (aucun appel Steam).
 * Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});
vi.mock("@/lib/steam", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/steam")>()),
  refreshSteamActivity: refreshMock,
}));

if (!TEST_DATABASE_URL) {
  console.warn("[steam-library-sync route.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

describe.skipIf(!TEST_DATABASE_URL)("GET /api/cron/steam-library-sync (Postgres isolé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let route: typeof import("./route");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    route = await import("./route");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "User" CASCADE`);
    refreshMock.mockReset();
    refreshMock.mockImplementation(async (userId: string) => ({ userId, category: "none" }));
    vi.stubEnv("CRON_SECRET", "s3cret");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("budget atteint après le 1er lot : les comptes jamais/le moins récemment vérifiés passent en premier", async () => {
    const now = Date.now();
    // 5 comptes (lots de 3) : on les crée dans un ordre qui ne reflète PAS
    // l'ancienneté de leur dernière vérification.
    const specs = [
      { discordId: "recent-1", checked: new Date(now - 1 * 60_000) },
      { discordId: "never", checked: null },
      { discordId: "recent-2", checked: new Date(now - 2 * 60_000) },
      { discordId: "old", checked: new Date(now - 60 * 60_000) },
      { discordId: "older", checked: new Date(now - 120 * 60_000) },
    ];
    const ids = new Map<string, string>();
    for (const [i, spec] of specs.entries()) {
      const user = await db.user.create({
        data: {
          discordId: spec.discordId,
          discordName: spec.discordId,
          steamId64: `7656119800000000${i}`,
          steamActivityCheckedAt: spec.checked,
        },
      });
      ids.set(user.id, spec.discordId);
    }

    // Le budget (25 s) est dépassé dès que le premier lot est terminé.
    const real = Date.now();
    let calls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (calls++ < 2 ? real : real + 60_000));

    const response = await route.GET(
      new Request("https://example.test/api/cron/steam-library-sync", {
        headers: { authorization: "Bearer s3cret" },
      })
    );
    expect(response.status).toBe(200);

    const processed = refreshMock.mock.calls.map(([userId]) => ids.get(userId as string));
    expect(processed.sort()).toEqual(["never", "old", "older"].sort());
  });
});
