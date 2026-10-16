import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), users: vi.fn(), query: vi.fn(), scope: vi.fn(), members: vi.fn(), lock: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedTransactionPrisma: () => ({ session: { findFirst: m.find, update: m.update }, user: { findMany: m.users }, $queryRaw: m.query }) }));
vi.mock("@/lib/community-isolation", async original => ({ ...await original<typeof import("@/lib/community-isolation")>(), getIsolationScope: m.scope, communityMemberUserWhere: m.members }));
vi.mock("@/lib/creation-intent", () => ({ lockCreationMembers: m.lock }));
import { changeSessionPreparation, readSessionPreparation } from "./session-preparation";
const input = { sessionId: "s", field: "installed", checked: true };
const session = () => ({ id: "s", communityId: "c", createdById: "me", status: "SCHEDULED", decidedGameId: "g", attendanceCapacity: null, seats: [], invites: [{ userId: "guest" }], proposals: [{ gameId: "g", votes: [{ userId: "me" }, { userId: "guest" }] }] });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("SESSION_PREPARATION_ENABLED", "true");
  m.transaction.mockImplementation(fn => fn({})); m.scope.mockResolvedValue({ communityIds: ["c"], includesDefault: false });
  m.members.mockResolvedValue({ memberships: { some: { communityId: "c", status: "ACTIVE" } } });
  m.users.mockResolvedValue([{ id: "me", discordName: "Moi" }, { id: "guest", discordName: "Invité" }]);
  m.find.mockResolvedValueOnce({ id: "s" }).mockResolvedValueOnce(session()).mockResolvedValue({ preparations: [] });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["false", "TRUE", "", undefined])("OFF (%s) : aucune transaction", async value => {
  vi.stubEnv("SESSION_PREPARATION_ENABLED", value);
  expect(await readSessionPreparation("me", "s")).toBeNull(); expect(await changeSessionPreparation("me", input)).toBe(false);
  expect(m.transaction).not.toHaveBeenCalled();
});
it("refuse identité forgée, champ inconnu et booléen ambigu", async () => {
  for (const raw of [{ ...input, userId: "victim" }, { ...input, field: "admin" }, { ...input, checked: "true" }]) expect(await changeSessionPreparation("me", raw)).toBe(false);
  expect(m.transaction).not.toHaveBeenCalled();
});
it("un parent inaccessible (étranger ou révoqué) ne lit aucun enfant", async () => {
  m.find.mockReset().mockResolvedValue(null);
  expect(await readSessionPreparation("me", "foreign")).toBeNull();
  expect(m.users).not.toHaveBeenCalled(); expect(m.query).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  expect(m.find.mock.calls[0][0].where).toMatchObject({ id: "foreign", AND: expect.any(Array) });
});
it("revalide le parent sous verrou avant toute donnée collective", async () => {
  m.find.mockReset().mockResolvedValueOnce({ id: "s" }).mockResolvedValue(null);
  expect(await changeSessionPreparation("me", input)).toBe(false); expect(m.users).not.toHaveBeenCalled();
});
it("conserve la portée communautaire, les invitations actives et le jeu dans l'écriture", async () => {
  expect(await changeSessionPreparation("me", input)).toBe(true);
  expect(m.lock).toHaveBeenCalledWith(expect.anything(), "c", ["me"]);
  expect(m.users.mock.calls[0][0].where).toMatchObject({ AND: [{ id: { in: ["me", "guest"] } }, { id: { in: ["me", "guest"] } }], memberships: { some: { communityId: "c", status: "ACTIVE" } } });
  expect(m.update.mock.calls[0][0]).toMatchObject({ where: { id: "s" }, data: { preparations: { upsert: {
    where: { sessionId_userId_gameId: { sessionId: "s", userId: "me", gameId: "g" } }, create: { userId: "me", gameId: "g", installed: true }, update: { installed: true },
  } } } });
});
it("un invité non participant peut consulter mais ne peut pas cocher", async () => {
  m.users.mockResolvedValue([{ id: "guest", discordName: "Invité" }]);
  expect(await changeSessionPreparation("me", input)).toBe(false); expect(m.update).not.toHaveBeenCalled();
});
it("la capacité sélectionne uniquement les places confirmées", async () => {
  m.find.mockReset().mockResolvedValueOnce({ id: "s" }).mockResolvedValueOnce({ ...session(), attendanceCapacity: 2, seats: [{ userId: "guest" }] }).mockResolvedValue({ preparations: [] });
  await readSessionPreparation("me", "s");
  expect(m.users.mock.calls[0][0].where.AND[0]).toEqual({ id: { in: ["guest"] } });
});
it.each(["VOTING", "DONE", "CANCELLED"])("aucune checklist pour %s", async status => {
  m.find.mockReset().mockResolvedValueOnce({ id: "s" }).mockResolvedValueOnce({ ...session(), status });
  expect(await changeSessionPreparation("me", input)).toBe(false); expect(m.update).not.toHaveBeenCalled();
});
it("une ligne absente vaut quatre cases décochées", async () => {
  expect((await readSessionPreparation("me", "s"))?.[0]).toEqual({ id: "me", discordName: "Moi", installed: false, updated: false, microphone: false, lobby: false });
});

it("sans jeu retenu aucune écriture", async () => {
  m.find.mockReset().mockResolvedValueOnce({ id: "s" }).mockResolvedValueOnce({ ...session(), decidedGameId: null });
  expect(await changeSessionPreparation("me", input)).toBe(false); expect(m.update).not.toHaveBeenCalled();
});
it("une appartenance révoquée bloque avant la lecture collective", async () => {
  m.lock.mockRejectedValueOnce(new Error("membership revoked"));
  await expect(readSessionPreparation("me", "s")).rejects.toThrow("membership revoked");
  expect(m.users).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it("permet de décocher et ne change que le champ demandé", async () => {
  expect(await changeSessionPreparation("me", { ...input, checked: false })).toBe(true);
  expect(m.update.mock.calls[0][0].data.preparations.upsert.update).toEqual({ installed: false });
});
it("conserve l'accès privé même isolation OFF", async () => {
  m.scope.mockResolvedValue(null); await readSessionPreparation("me", "s");
  expect(m.find.mock.calls[0][0].where).toEqual({ id: "s", OR: [{ createdById: "me" }, { invites: { some: { userId: "me", status: "ACTIVE" } } }] });
});
it("restreint les cases collectives au jeu courant et au roster autorisé", async () => {
  m.find.mockReset().mockResolvedValueOnce({ id: "s" }).mockResolvedValueOnce(session()).mockResolvedValue({ preparations: [{ userId: "guest", installed: true, updated: true, microphone: true, lobby: true }] });
  const rows = await readSessionPreparation("me", "s");
  expect(rows?.[1]).toMatchObject({ id: "guest", installed: true, lobby: true });
  expect(m.find.mock.calls[2][0].select.preparations.where).toEqual({ gameId: "g", userId: { in: ["me", "guest"] } });
});
