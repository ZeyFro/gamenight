import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[session-preparation.integration] TEST_DATABASE_URL absente — tests Postgres SKIPPÉS.");

// Comme les autres suites test-postgres : uniquement une base jetable dédiée,
// migrée au préalable, un fichier à la fois (le fixture fait TRUNCATE).
describe.skipIf(!TEST_DATABASE_URL)("préparation : persistance et isolation Postgres", () => {
  let db: import("@prisma/client").PrismaClient;
  let change: typeof import("./session-preparation").changeSessionPreparation;
  let read: typeof import("./session-preparation").readSessionPreparation;
  const input = { sessionId: "s", field: "installed", checked: true };
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    ({ changeSessionPreparation: change, readSessionPreparation: read } = await import("./session-preparation"));
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("SESSION_PREPARATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "Community", "User", "Game" CASCADE');
    await db.community.createMany({ data: [
      { id: "a", slug: "default", name: "A", status: "ACTIVE" },
      { id: "b", slug: "b", name: "B", status: "ACTIVE" },
    ] });
    await db.user.createMany({ data: ["host", "alice", "bob", "spectator", "outsider", "foreign"].map(id => ({
      id, discordId: id, discordName: id, activeCommunityId: id === "foreign" ? "b" : "a",
    })) });
    await db.membership.createMany({ data: [
      ...["host", "alice", "bob", "spectator", "outsider"].map(userId => ({ userId, communityId: "a", status: "ACTIVE" as const })),
      { userId: "foreign", communityId: "b", status: "ACTIVE" },
    ] });
    await db.game.createMany({ data: ["game", "other-game"].map(id => ({ id, name: id, source: "MANUAL" as const, addedById: "host" })) });
    await db.session.create({ data: {
      id: "s", communityId: "a", createdById: "host", status: "SCHEDULED",
      date: new Date("2099-01-01T20:00:00Z"), votingDeadline: new Date("2099-01-01T18:00:00Z"),
      decidedTime: new Date("2099-01-01T20:00:00Z"), decidedGameId: "game",
      customReminderMessage: "Message conservé", reminderTimings: [120, 30], remindersSent: ["120"], notifiedUserIds: ["alice", "bob"],
    } });
    await db.sessionInvite.createMany({ data: ["alice", "bob", "spectator", "foreign"].map(userId => ({ sessionId: "s", userId, invitedById: "host", status: "ACTIVE" as const })) });
    await db.proposal.create({ data: { id: "p", sessionId: "s", gameId: "game", proposedById: "host" } });
    await db.vote.createMany({ data: ["host", "alice", "bob", "foreign"].map(userId => ({ proposalId: "p", userId })) });
  });
  const row = (userId: string) => db.sessionPreparation.findUnique({ where: { sessionId_userId_gameId: { sessionId: "s", userId, gameId: "game" } } });

  it("crée sa checklist, persiste les quatre cases et permet de les effacer sans toucher au voisin", async () => {
    expect(await db.sessionPreparation.count()).toBe(0);
    expect((await read("alice", "s"))?.find(person => person.id === "alice")).toMatchObject({ installed: false, updated: false, microphone: false, lobby: false });
    expect(await db.sessionPreparation.count()).toBe(0); // Lecture sans création implicite.
    await change("bob", { ...input, field: "lobby" });
    for (const field of ["installed", "updated", "microphone", "lobby"]) expect(await change("alice", { ...input, field })).toBe(true);
    expect(await row("alice")).toMatchObject({ installed: true, updated: true, microphone: true, lobby: true });
    expect((await read("bob", "s"))?.find(person => person.id === "alice")).toMatchObject({ installed: true, updated: true, microphone: true, lobby: true });
    for (const field of ["installed", "updated", "microphone", "lobby"]) expect(await change("alice", { ...input, field, checked: false })).toBe(true);
    expect(await row("alice")).toMatchObject({ installed: false, updated: false, microphone: false, lobby: false });
    expect(await row("bob")).toMatchObject({ installed: false, lobby: true });
    expect(await db.sessionPreparation.count()).toBe(2);
  });
  it("une identité tierce forgée ne modifie aucune checklist", async () => {
    await change("bob", { ...input, field: "microphone" }); const before = await row("bob");
    expect(await change("alice", { ...input, userId: "bob" })).toBe(false);
    expect(await change("outsider", { ...input, userId: "bob" })).toBe(false);
    expect(await row("bob")).toEqual(before); expect(await row("alice")).toBeNull();
  });
  it("un invité non participant voit le collectif mais ne peut pas le modifier ; un tiers ne voit rien", async () => {
    await change("alice", input);
    expect((await read("spectator", "s"))?.map(person => person.id).sort()).toEqual(["alice", "bob", "host"]);
    expect(await change("spectator", input)).toBe(false);
    expect(await read("outsider", "s")).toBeNull(); expect(await change("outsider", input)).toBe(false);
    expect(await db.sessionPreparation.count()).toBe(1);
  });
  it("une invitation révoquée bloque lecture/écriture et retire la personne du collectif sans effacer son historique", async () => {
    await change("alice", input); const before = await row("alice");
    await db.sessionInvite.updateMany({ where: { sessionId: "s", userId: "alice" }, data: { status: "REVOKED" } });
    expect(await read("alice", "s")).toBeNull(); expect(await change("alice", { ...input, checked: false })).toBe(false);
    expect((await read("host", "s"))?.some(person => person.id === "alice")).toBe(false);
    expect(await row("alice")).toEqual(before);
  });
  it("un membre retiré perd l'accès même si invitation et vote restent présents", async () => {
    await change("alice", input); const before = await row("alice");
    await db.membership.updateMany({ where: { userId: "alice", communityId: "a" }, data: { status: "REMOVED" } });
    expect(await read("alice", "s")).toBeNull(); expect(await change("alice", { ...input, checked: false })).toBe(false);
    expect((await read("host", "s"))?.some(person => person.id === "alice")).toBe(false);
    expect(await row("alice")).toEqual(before);
  });
  it("une invitation et un vote de B ne donnent aucun accès à A, et les états des deux soirées sont isolés", async () => {
    expect(await read("foreign", "s")).toBeNull(); expect(await change("foreign", input)).toBe(false);
    await db.session.create({ data: { id: "s-b", communityId: "b", createdById: "foreign", status: "SCHEDULED", date: new Date("2099-01-01T20:00:00Z"), decidedGameId: "game" } });
    await db.proposal.create({ data: { id: "p-b", sessionId: "s-b", gameId: "game", proposedById: "foreign", votes: { create: { userId: "foreign" } } } });
    expect(await change("foreign", { ...input, sessionId: "s-b", field: "lobby" })).toBe(true);
    expect(await read("alice", "s-b")).toBeNull(); expect(await change("alice", { ...input, sessionId: "s-b" })).toBe(false);
    expect(await change("alice", input)).toBe(true);
    expect((await read("alice", "s"))?.every(person => person.id !== "foreign" && !person.lobby)).toBe(true);
    expect(await db.sessionPreparation.findMany({ where: { sessionId: "s-b" } })).toMatchObject([{ userId: "foreign", lobby: true, installed: false }]);
  });
  it("la capacité retient les confirmés, jamais une place en attente même si elle a voté", async () => {
    await db.session.update({ where: { id: "s" }, data: { attendanceCapacity: 1 } });
    await db.sessionSeat.createMany({ data: [{ sessionId: "s", userId: "alice", status: "CONFIRMED" }, { sessionId: "s", userId: "bob", status: "WAITLIST" }] });
    expect((await read("host", "s"))?.map(person => person.id)).toEqual(["alice"]);
    expect(await change("host", input)).toBe(false); expect(await change("bob", input)).toBe(false); expect(await change("alice", input)).toBe(true);
  });
  it("conserve toutes les métadonnées de soirée, invitations, votes et jeu", async () => {
    const snapshot = async () => ({
      session: await db.session.findUniqueOrThrow({ where: { id: "s" }, include: { invites: { orderBy: { userId: "asc" } }, proposals: { include: { votes: { orderBy: { userId: "asc" } } } } } }),
      game: await db.game.findUniqueOrThrow({ where: { id: "game" } }),
    });
    const before = await snapshot();
    await change("alice", input); await change("alice", { ...input, field: "updated" }); await change("alice", { ...input, checked: false });
    expect(await snapshot()).toEqual(before);
    expect(await db.notificationEvent.count()).toBe(0); expect(await db.notificationDelivery.count()).toBe(0);
  });
  it("un changement de jeu sépare les cases, désactiver le flag conserve les données", async () => {
    await change("alice", input);
    await db.proposal.create({ data: { sessionId: "s", gameId: "other-game", proposedById: "host", votes: { create: { userId: "alice" } } } });
    await db.session.update({ where: { id: "s" }, data: { decidedGameId: "other-game" } });
    expect((await read("alice", "s"))?.[0]).toMatchObject({ id: "alice", installed: false });
    await change("alice", { ...input, field: "lobby" });
    expect(await row("alice")).toMatchObject({ installed: true, lobby: false });
    vi.stubEnv("SESSION_PREPARATION_ENABLED", "false");
    expect(await read("alice", "s")).toBeNull(); expect(await change("alice", input)).toBe(false);
    expect(await db.sessionPreparation.count()).toBe(2);
  });
  it("supprime les checklists en cascade avec l'utilisateur puis la soirée", async () => {
    await change("alice", input); await change("bob", input);
    await db.user.delete({ where: { id: "alice" } }); expect(await row("alice")).toBeNull(); expect(await row("bob")).not.toBeNull();
    await db.session.delete({ where: { id: "s" } }); expect(await db.sessionPreparation.count()).toBe(0);
  });
});
