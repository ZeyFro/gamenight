import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sécurité — reconnexion forcée globale : tests d'intégration Postgres
 * isolée pour `getValidSession` (voir `src/lib/valid-session.ts`), la garde
 * légère utilisée par les routes API qui n'appellent pas `getCurrentUser`
 * (Steam link/callback, recherche IGDB). Réel moteur Postgres requis (pas
 * de mock Prisma) : la garantie testée ici est que `forceReloginAt` est
 * relu en base à CHAQUE appel, pas mise en cache — un mock ne prouverait
 * que l'appel de méthodes, jamais la fraîcheur réelle de la valeur lue.
 * Même dérogation déjà établie pour les autres suites d'intégration de ce
 * dépôt (voir leurs commentaires de fichier, notamment
 * `session-access.integration.test.ts`).
 *
 * Nécessite `TEST_DATABASE_URL` — voir le README. Suite entièrement
 * SKIPPÉE si absente. `auth()` (Auth.js/Discord) est mocké : aucun flux
 * OAuth réel n'est testable ici, seule l'interaction avec Prisma et
 * `shouldForceRelogin` l'est.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[valid-session.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "La garantie de fraîcheur de forceReloginAt N'EST PAS validée par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("getValidSession (intégration Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let getValidSession: typeof import("./valid-session").getValidSession;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    getValidSession = (await import("./valid-session")).getValidSession;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.$executeRawUnsafe(`TRUNCATE "User" CASCADE`);
  });

  let counter = 0;
  function uniq(label: string): string {
    counter += 1;
    return `${label}-${counter}`;
  }

  async function makeUser(forceReloginAt: Date | null = null) {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id, forceReloginAt } });
  }

  it("pas de session → null", async () => {
    authMock.mockResolvedValue(null);
    expect(await getValidSession()).toBeNull();
  });

  it("session sans discordId → null", async () => {
    authMock.mockResolvedValue({ user: {} });
    expect(await getValidSession()).toBeNull();
  });

  it("forceReloginAt jamais posé → session valide", async () => {
    const user = await makeUser(null);
    const session = { user: { discordId: user.discordId, sessionCreatedAt: Date.now() - 1000 } };
    authMock.mockResolvedValue(session);
    expect(await getValidSession()).toBe(session);
  });

  it("forceReloginAt postérieur à sessionCreatedAt → null (déconnecté)", async () => {
    const now = new Date();
    const user = await makeUser(now);
    authMock.mockResolvedValue({
      user: { discordId: user.discordId, sessionCreatedAt: now.getTime() - 1000 },
    });
    expect(await getValidSession()).toBeNull();
  });

  it("forceReloginAt antérieur à sessionCreatedAt → session valide (reconnexion OAuth déjà faite)", async () => {
    const now = new Date();
    const user = await makeUser(now);
    const session = {
      user: { discordId: user.discordId, sessionCreatedAt: now.getTime() + 1000 },
    };
    authMock.mockResolvedValue(session);
    expect(await getValidSession()).toBe(session);
  });

  it("forceReloginAt posé mais sessionCreatedAt absent (JWT pré-feature) → null, fail-closed", async () => {
    const user = await makeUser(new Date());
    authMock.mockResolvedValue({ user: { discordId: user.discordId } });
    expect(await getValidSession()).toBeNull();
  });

  it("discordId sans utilisateur correspondant en base (forgé) → null", async () => {
    authMock.mockResolvedValue({
      user: { discordId: "discord-id-invente-qui-nexiste-pas", sessionCreatedAt: Date.now() },
    });
    expect(await getValidSession()).toBeNull();
  });
});
