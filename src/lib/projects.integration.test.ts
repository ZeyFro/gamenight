import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Projets à organisateur — intégration Postgres (CI uniquement, jamais en local : base partagée).
 * Nécessite `TEST_DATABASE_URL`. Suite entièrement SKIPPÉE si absente.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }));

if (!TEST_DATABASE_URL) {
  console.warn("[projects.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. Les règles d'entrées, de clôture et d'archivage ne sont PAS validées par cette exécution.");
}

describe.skipIf(!TEST_DATABASE_URL)("projets à organisateur (intégration Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let projects: typeof import("./projects");
  let queue: typeof import("./project-space-queue");
  let communityId: string;
  const H = 3_600_000;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    projects = await import("./projects");
    queue = await import("./project-space-queue");
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    vi.stubEnv("PROJECT_ORGANIZER_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "ProjectEntry", "Project", "User" CASCADE`);
    const community = await db.community.upsert({
      where: { slug: "default" },
      create: { slug: "default", name: "Défaut", status: "ACTIVE" },
      update: { status: "ACTIVE" },
      select: { id: true },
    });
    communityId = community.id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  let counter = 0;
  async function makeUser(inCommunity = communityId) {
    const id = `user-${++counter}`;
    const user = await db.user.create({ data: { discordId: id, discordName: id } });
    await db.membership.create({ data: { communityId: inCommunity, userId: user.id, status: "ACTIVE" } });
    return user;
  }
  const input = { name: "Expédition Valheim", description: "Finir la campagne ensemble" };
  const inDays = (days: number) => new Date(Date.now() + days * 24 * H);

  async function makeProject(organizerId: string, maxEntries?: number) {
    const result = await projects.createProject(organizerId, communityId, { ...input, maxEntries }, inDays(10), new Date());
    if (!result.ok) throw new Error(result.reason);
    return result.projectId;
  }

  it("création : valide la date de fin et la saisie, flag éteint refusé", async () => {
    const organizer = await makeUser();
    expect(await projects.createProject(organizer.id, communityId, input, new Date(Date.now() + 1000), new Date())).toEqual({ ok: false, reason: "too_soon" });
    expect(await projects.createProject(organizer.id, communityId, { ...input, name: "x" }, inDays(5), new Date())).toEqual({ ok: false, reason: "invalid" });
    vi.stubEnv("PROJECT_ORGANIZER_ENABLED", "");
    expect(await projects.createProject(organizer.id, communityId, input, inDays(5), new Date())).toEqual({ ok: false, reason: "disabled" });
    expect(await db.project.count()).toBe(0);
  });

  it("l'organisateur valide : une candidature ne donne la participation qu'après acceptation", async () => {
    const organizer = await makeUser();
    const player = await makeUser();
    const projectId = await makeProject(organizer.id);
    expect(await projects.applyToProject(player.id, communityId, projectId, "Je viens")).toEqual({ ok: true });
    let detail = await projects.getProject(player.id, communityId, projectId);
    expect(detail?.participants).toEqual([]);
    expect(detail?.myEntry).toBe("PENDING");
    expect(detail?.pending).toEqual([]); // le candidat ne voit pas les candidatures
    const orgView = await projects.getProject(organizer.id, communityId, projectId);
    const entryId = orgView!.pending[0].id;
    expect(await projects.decideProjectEntry(organizer.id, communityId, entryId, "ACCEPT")).toEqual({ ok: true });
    detail = await projects.getProject(player.id, communityId, projectId);
    expect(detail?.participants.map((participant) => participant.userId)).toEqual([player.id]);
  });

  it("seul l'organisateur décide ; une décision n'est prise qu'une fois", async () => {
    const organizer = await makeUser();
    const player = await makeUser();
    const other = await makeUser();
    const projectId = await makeProject(organizer.id);
    await projects.applyToProject(player.id, communityId, projectId, "");
    const entry = await db.projectEntry.findFirstOrThrow({ where: { projectId } });
    expect(await projects.decideProjectEntry(player.id, communityId, entry.id, "ACCEPT")).toEqual({ ok: false, reason: "forbidden" });
    expect(await projects.decideProjectEntry(other.id, communityId, entry.id, "ACCEPT")).toEqual({ ok: false, reason: "forbidden" });
    expect(await projects.decideProjectEntry(organizer.id, communityId, entry.id, "DECLINE")).toEqual({ ok: true });
    expect(await projects.decideProjectEntry(organizer.id, communityId, entry.id, "ACCEPT")).toEqual({ ok: false, reason: "not_pending" });
    expect(await projects.applyToProject(player.id, communityId, projectId, "")).toEqual({ ok: false, reason: "declined" });
  });

  it("participation illimitée : un joueur peut entrer dans plusieurs projets", async () => {
    const organizer = await makeUser();
    const player = await makeUser();
    const first = await makeProject(organizer.id);
    const second = await makeProject(organizer.id);
    for (const id of [first, second]) {
      await projects.applyToProject(player.id, communityId, id, "");
      const entry = await db.projectEntry.findFirstOrThrow({ where: { projectId: id } });
      expect(await projects.decideProjectEntry(organizer.id, communityId, entry.id, "ACCEPT")).toEqual({ ok: true });
    }
    expect(await db.projectEntry.count({ where: { userId: player.id, status: "ACCEPTED" } })).toBe(2);
  });

  it("limite de places et organisateur refusé comme candidat", async () => {
    const organizer = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const projectId = await makeProject(organizer.id, 2);
    expect(await projects.applyToProject(organizer.id, communityId, projectId, "")).toEqual({ ok: false, reason: "own" });
    for (const player of [a, b]) await projects.applyToProject(player.id, communityId, projectId, "");
    const c = await makeUser();
    await projects.applyToProject(c.id, communityId, projectId, "");
    const entries = await db.projectEntry.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
    expect(await projects.decideProjectEntry(organizer.id, communityId, entries[0].id, "ACCEPT")).toEqual({ ok: true });
    expect(await projects.decideProjectEntry(organizer.id, communityId, entries[1].id, "ACCEPT")).toEqual({ ok: true });
    expect(await projects.decideProjectEntry(organizer.id, communityId, entries[2].id, "ACCEPT")).toEqual({ ok: false, reason: "full" });
  });

  it("un membre d'une autre communauté ne voit ni ne rejoint le projet", async () => {
    const organizer = await makeUser();
    const projectId = await makeProject(organizer.id);
    const other = await db.community.create({ data: { slug: `autre-${++counter}`, name: "Autre", status: "ACTIVE" } });
    const outsider = await makeUser(other.id);
    expect(await projects.getProject(outsider.id, communityId, projectId)).toBeNull();
    expect(await projects.applyToProject(outsider.id, communityId, projectId, "")).toEqual({ ok: false, reason: "missing" });
    expect(await projects.listProjects(outsider.id, communityId)).toEqual([]);
  });

  it("retrait volontaire d'un participant puis redépôt possible", async () => {
    const organizer = await makeUser();
    const player = await makeUser();
    const projectId = await makeProject(organizer.id);
    await projects.applyToProject(player.id, communityId, projectId, "");
    expect(await projects.withdrawFromProject(player.id, communityId, projectId)).toEqual({ ok: true });
    expect(await projects.withdrawFromProject(player.id, communityId, projectId)).toEqual({ ok: false, reason: "no_entry" });
    expect(await projects.applyToProject(player.id, communityId, projectId, "")).toEqual({ ok: true });
  });

  it("clôture par l'organisateur : plus aucune entrée", async () => {
    const organizer = await makeUser();
    const player = await makeUser();
    const projectId = await makeProject(organizer.id);
    expect(await projects.closeProject(player.id, communityId, projectId)).toEqual({ ok: false, reason: "forbidden" });
    expect(await projects.closeProject(organizer.id, communityId, projectId)).toEqual({ ok: true });
    expect(await projects.applyToProject(player.id, communityId, projectId, "")).toEqual({ ok: false, reason: "closed" });
  });

  it("C083 — projet daté : deux candidats, décision de l'organisateur, isolation, clôture puis archivage", async () => {
    const organizer = await makeUser();
    const alice = await makeUser();
    const bob = await makeUser();
    const projectId = await makeProject(organizer.id, 2);
    const created = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(created.endsAt.getTime()).toBeGreaterThan(Date.now());
    expect(await projects.applyToProject(alice.id, communityId, projectId, "Disponible")).toEqual({ ok: true });
    expect(await projects.applyToProject(bob.id, communityId, projectId, "Motivé")).toEqual({ ok: true });

    const organizerView = await projects.getProject(organizer.id, communityId, projectId);
    expect(organizerView).toMatchObject({ name: input.name, description: input.description, status: "OPEN" });
    expect(organizerView!.pending).toHaveLength(2);
    const aliceEntry = await db.projectEntry.findFirstOrThrow({ where: { projectId, userId: alice.id } });
    const bobEntry = await db.projectEntry.findFirstOrThrow({ where: { projectId, userId: bob.id } });
    expect(await projects.decideProjectEntry(organizer.id, communityId, aliceEntry.id, "ACCEPT")).toEqual({ ok: true });
    expect(await projects.decideProjectEntry(organizer.id, communityId, bobEntry.id, "DECLINE")).toEqual({ ok: true });

    const aliceView = await projects.getProject(alice.id, communityId, projectId);
    expect(aliceView?.participants.map((participant) => participant.userId)).toEqual([alice.id]);
    expect(await db.projectEntry.findFirstOrThrow({ where: { projectId, userId: bob.id } })).toMatchObject({ status: "DECLINED" });
    expect((await projects.listProjects(alice.id, communityId)).map((project) => project.id)).toContain(projectId);

    const outsider = await db.community.create({ data: { slug: `c083-${++counter}`, name: "Autre", status: "ACTIVE" } });
    const foreign = await makeUser(outsider.id);
    expect(await projects.getProject(foreign.id, communityId, projectId)).toBeNull();
    expect(await projects.applyToProject(foreign.id, communityId, projectId, "")).toEqual({ ok: false, reason: "missing" });

    expect(await projects.closeProject(organizer.id, communityId, projectId)).toEqual({ ok: true });
    expect(await projects.applyToProject(alice.id, communityId, projectId, "Encore" )).toEqual({ ok: false, reason: "closed" });
    await db.project.update({ where: { id: projectId }, data: { endsAt: new Date(Date.now() - 8 * 24 * H) } });
    expect(await queue.runProjectLifecycle(new Date(), new Date(Date.now() + 8 * 24 * H))).toMatchObject({ enabled: true, archivedWithoutDiscord: 1 });
    const archived = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();
  });

  it("cycle de vie : clôture à la date de fin puis archivage 7 jours après (sans fil : direct)", async () => {
    const organizer = await makeUser();
    const ended = await db.project.create({
      data: { communityId, organizerId: organizer.id, name: "Fini", description: "Projet terminé", endsAt: new Date(Date.now() - H) },
    });
    const running = await db.project.create({
      data: { communityId, organizerId: organizer.id, name: "En cours", description: "Projet en cours", endsAt: new Date(Date.now() + 5 * H) },
    });
    const wallNow = new Date();
    const first = await queue.runProjectLifecycle(wallNow, new Date());
    expect(first).toMatchObject({ enabled: true, closed: 1, archivedWithoutDiscord: 0 });
    expect((await db.project.findUniqueOrThrow({ where: { id: ended.id } })).status).toBe("CLOSED");
    expect((await db.project.findUniqueOrThrow({ where: { id: running.id } })).status).toBe("OPEN");

    const sixDays = await queue.runProjectLifecycle(wallNow, new Date(Date.now() + 6 * 24 * H));
    expect(sixDays.archivedWithoutDiscord).toBe(0);
    const eightDays = await queue.runProjectLifecycle(wallNow, new Date(Date.now() + 8 * 24 * H));
    expect(eightDays.archivedWithoutDiscord).toBe(1);
    const archived = await db.project.findUniqueOrThrow({ where: { id: ended.id } });
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).not.toBeNull();
  });

  it("cycle de vie : flag éteint, aucune écriture", async () => {
    vi.stubEnv("PROJECT_ORGANIZER_ENABLED", "");
    const organizer = await makeUser();
    await db.project.create({ data: { communityId, organizerId: organizer.id, name: "Fini", description: "Projet terminé", endsAt: new Date(Date.now() - H) } });
    expect(await queue.runProjectLifecycle(new Date())).toMatchObject({ enabled: false });
    expect(await db.project.count({ where: { status: "OPEN" } })).toBe(1);
  });
});
