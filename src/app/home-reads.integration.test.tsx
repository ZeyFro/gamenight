import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Accueil `/` — preuve d'intégration Postgres que les lectures lancées en
 * parallèle gardent le comportement d'avant : une soirée au vote échu est
 * clôturée AVANT l'affichage (jamais l'état d'avant), et la page se charge pour
 * un membre sans aucune soirée. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => { throw new Error(`REDIRECT:${location}`); },
  notFound: () => { throw new Error("NOTFOUND"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[home-reads] Postgres absent : tests de l'accueil SKIPPÉS.");

function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => texts(child, out));
  else if (node && typeof node === "object" && "props" in node) texts((node as { props: { children?: unknown } }).props.children, out);
  return out;
}

describe.skipIf(!TEST_DATABASE_URL)("accueil : lectures en parallèle, même comportement", () => {
  let db: import("@prisma/client").PrismaClient;
  let Home: (props: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
  let communityId: string;
  let userId: string;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    Home = (await import("./page")).default as unknown as typeof Home;
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "User", "Community" CASCADE');
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    communityId = (await db.community.create({ data: { slug: "default", name: "default", status: "ACTIVE", discordGuildId: "g-default" } })).id;
    userId = (await db.user.create({ data: { discordId: "me", discordName: "Moi", activeCommunityId: communityId } })).id;
    await db.membership.create({ data: { userId, communityId, status: "ACTIVE" } });
    auth.mockResolvedValue({ user: { discordId: "me", sessionCreatedAt: Date.now() - 1000 } });
  });

  it("membre sans soirée : la page se charge", async () => {
    expect(texts(await Home({ searchParams: Promise.resolve({}) })).join(" ")).toContain("Moi");
  });

  it("soirée au vote échu : clôturée avant l'affichage, jamais « Vote en cours »", async () => {
    const session = await db.session.create({ data: {
      date: new Date(Date.now() - 2 * 3600_000), votingDeadline: new Date(Date.now() - 3 * 3600_000),
      status: "VOTING", createdById: userId, communityId,
    } });
    const rendered = texts(await Home({ searchParams: Promise.resolve({}) })).join(" ");
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).not.toBe("VOTING");
    expect(rendered).not.toContain("Vote en cours");
  });

  it("soirée à venir en cours de vote : affichée avec son statut", async () => {
    await db.session.create({ data: {
      date: new Date(Date.now() + 48 * 3600_000), votingDeadline: new Date(Date.now() + 24 * 3600_000),
      status: "VOTING", createdById: userId, communityId,
    } });
    expect(texts(await Home({ searchParams: Promise.resolve({}) })).join(" ")).toContain("Vote en cours");
  });
});
