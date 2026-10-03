import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR A — point de contrôle `community-access.ts` : un
 * accès exige un Membership ACTIVE dans une communauté ACTIVE, relus en base
 * à chaque appel (jamais depuis le JWT : un départ coupe l'accès à la
 * requête suivante). Tout refus est un 404 indistinct (comme
 * `session-access` : « la communauté existe mais tu n'en es pas » serait
 * déjà une fuite). Postgres réel requis.
 *
 * Nécessite `TEST_DATABASE_URL` — suite SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUserMock, NOT_FOUND } = vi.hoisted(() => ({
  currentUserMock: vi.fn(),
  NOT_FOUND: "NEXT_HTTP_ERROR_FALLBACK;404",
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[community-access.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "Le contrôle d'accès aux communautés N'EST PAS validé par cette exécution."
  );
}

type Role = "OWNER" | "ADMIN" | "MEMBER";
type CStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "LEFT" | "ARCHIVED";
type MStatus = "ACTIVE" | "LEFT" | "REMOVED";

describe.skipIf(!TEST_DATABASE_URL)("community-access (Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let access: typeof import("./community-access");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    access = await import("./community-access");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.$executeRawUnsafe(`TRUNCATE "Membership", "CommunityChannelConfig", "Community", "User" CASCADE`);
  });

  let n = 0;
  async function setup(opts: { community?: CStatus; membership?: MStatus | null; role?: Role } = {}) {
    n += 1;
    const user = await db.user.create({ data: { discordId: `u${n}`, discordName: `u${n}` } });
    const community = await db.community.create({
      data: { slug: `c${n}`, name: `C${n}`, status: opts.community ?? "ACTIVE" },
    });
    if (opts.membership !== null) {
      await db.membership.create({
        data: {
          communityId: community.id,
          userId: user.id,
          role: opts.role ?? "MEMBER",
          status: opts.membership ?? "ACTIVE",
        },
      });
    }
    currentUserMock.mockResolvedValue(user);
    return { user, community };
  }

  describe("requireMembership", () => {
    it("membre ACTIVE d'une communauté ACTIVE : accès, renvoie user / membership / community", async () => {
      const { user, community } = await setup();

      const result = await access.requireMembership(community.id);

      expect(result.user.id).toBe(user.id);
      expect(result.community.id).toBe(community.id);
      expect(result.membership).toMatchObject({ role: "MEMBER", status: "ACTIVE" });
    });

    it("non connecté → 404", async () => {
      const { community } = await setup();
      currentUserMock.mockResolvedValue(null);
      await expect(access.requireMembership(community.id)).rejects.toThrow(NOT_FOUND);
    });

    it("non membre → 404", async () => {
      const { community } = await setup({ membership: null });
      await expect(access.requireMembership(community.id)).rejects.toThrow(NOT_FOUND);
    });

    it("membre d'une AUTRE communauté → 404", async () => {
      await setup();
      const other = await db.community.create({ data: { slug: "autre", name: "Autre", status: "ACTIVE" } });
      await expect(access.requireMembership(other.id)).rejects.toThrow(NOT_FOUND);
    });

    it("communauté inexistante → 404", async () => {
      await setup();
      await expect(access.requireMembership("inexistante")).rejects.toThrow(NOT_FOUND);
    });

    it.each<MStatus>(["LEFT", "REMOVED"])("Membership %s → 404", async (status) => {
      const { community } = await setup({ membership: status });
      await expect(access.requireMembership(community.id)).rejects.toThrow(NOT_FOUND);
    });

    it.each<CStatus>(["PENDING", "SUSPENDED", "LEFT", "ARCHIVED"])(
      "communauté %s → 404, même pour son OWNER",
      async (status) => {
        const { community } = await setup({ community: status, role: "OWNER" });
        await expect(access.requireMembership(community.id)).rejects.toThrow(NOT_FOUND);
      }
    );

    it("départ pris en compte à l'appel suivant (lecture en base, rien en cache)", async () => {
      const { user, community } = await setup();
      await access.requireMembership(community.id);
      await db.membership.update({
        where: { communityId_userId: { communityId: community.id, userId: user.id } },
        data: { status: "LEFT" },
      });
      await expect(access.requireMembership(community.id)).rejects.toThrow(NOT_FOUND);
    });
  });

  describe("requireCommunityRole", () => {
    it.each<[Role, Role, boolean]>([
      ["MEMBER", "MEMBER", true],
      ["MEMBER", "ADMIN", false],
      ["MEMBER", "OWNER", false],
      ["ADMIN", "MEMBER", true],
      ["ADMIN", "ADMIN", true],
      ["ADMIN", "OWNER", false],
      ["OWNER", "MEMBER", true],
      ["OWNER", "ADMIN", true],
      ["OWNER", "OWNER", true],
    ])("rôle %s, minimum %s → autorisé : %s", async (role, min, allowed) => {
      const { community } = await setup({ role });
      const call = access.requireCommunityRole(community.id, min);
      if (allowed) await expect(call).resolves.toMatchObject({ membership: { role } });
      else await expect(call).rejects.toThrow(NOT_FOUND);
    });

    it("ADMIN dont le Membership est REMOVED → 404", async () => {
      const { community } = await setup({ role: "ADMIN", membership: "REMOVED" });
      await expect(access.requireCommunityRole(community.id, "MEMBER")).rejects.toThrow(NOT_FOUND);
    });
  });
});
