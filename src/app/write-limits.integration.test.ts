import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const getCurrentUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/current-user", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

/** Garde statique : ces actions d'écriture, sans limite jusqu'à l'audit du 23/11/2026, appellent `checkSharedRateLimit`. */
describe("écritures à limite partagée (garde statique)", () => {
  it.each([
    ["src/app/calendrier/actions.ts", "communityDateWrite"],
    ["src/app/charte/actions.ts", "fairPlayCharter"],
    ["src/app/profil/family-import-actions.ts", "familyImportBatch"],
  ])("%s applique la limite partagée « %s »", (file, key) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("checkSharedRateLimit");
    expect(source).toContain(key);
  });
  it("le calendrier affiche le message de limite après un refus", () => {
    const page = readFileSync("src/app/calendrier/page.tsx", "utf8");
    expect(page).toContain('sp.error === "rate"');
    expect(page).toContain("RATE_LIMIT_MESSAGE");
  });
});

describe.skipIf(!TEST_DATABASE_URL)("écritures du calendrier et de la charte : plafond par minute (Postgres)", () => {
  type Db = import("@prisma/client").PrismaClient;
  let db: Db;
  const COMMUNITY = "wlimit-a";

  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  async function redirected(action: (data: FormData) => Promise<unknown>, data: FormData): Promise<string | null> {
    try { await action(data); return null; } catch (error) {
      if (error instanceof Error && error.message.startsWith("REDIRECT:")) return error.message.slice("REDIRECT:".length);
      throw error;
    }
  }

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as Db;
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "Membership", "Community", "User", "RateLimitWindow" CASCADE');
    await db.community.create({ data: { id: COMMUNITY, slug: COMMUNITY, name: "Serveur", status: "ACTIVE", fairPlayCharter: "Charte 0" } });
    await db.user.createMany({ data: [
      { id: "wl-admin", discordId: "wl-1", discordName: "Admin", activeCommunityId: COMMUNITY },
      { id: "wl-other", discordId: "wl-2", discordName: "Autre", activeCommunityId: COMMUNITY },
    ] });
    await db.membership.createMany({ data: [
      { userId: "wl-admin", communityId: COMMUNITY, status: "ACTIVE", role: "ADMIN" },
      { userId: "wl-other", communityId: COMMUNITY, status: "ACTIVE", role: "ADMIN" },
    ] });
    getCurrentUserMock.mockResolvedValue({ id: "wl-admin", discordId: "wl-1", discordName: "Admin" });
  });

  it("calendrier : la 31e date de la minute est refusée avec ?error=rate et n'écrit rien ; un autre membre garde son quota", async () => {
    const { createCommunityDateAction } = await import("./calendrier/actions");
    for (let i = 1; i <= 30; i++) {
      const target = await redirected(createCommunityDateAction, form({ date: "2027-03-01", title: "Date " + i }));
      expect(target).toBe("/calendrier?date=2027-03-01");
    }
    expect(await db.communityDate.count()).toBe(30);
    const refused = await redirected(createCommunityDateAction, form({ date: "2027-03-01", title: "Trop" }));
    expect(refused).toBe("/calendrier?date=2027-03-01&error=rate");
    expect(await db.communityDate.count()).toBe(30);

    getCurrentUserMock.mockResolvedValue({ id: "wl-other", discordId: "wl-2", discordName: "Autre" });
    expect(await redirected(createCommunityDateAction, form({ date: "2027-03-02", title: "Autre membre" }))).toBe("/calendrier?date=2027-03-02");
    expect(await db.communityDate.count()).toBe(31);
  });

  it("charte : la 11e écriture de la minute est ignorée, la charte garde la dixième valeur", async () => {
    const { saveFairPlayCharterAction } = await import("./charte/actions");
    for (let i = 1; i <= 11; i++) await saveFairPlayCharterAction(form({ charter: "Charte " + i }));
    expect(await db.community.findUniqueOrThrow({ where: { id: COMMUNITY } })).toMatchObject({ fairPlayCharter: "Charte 10" });
  });
});
