import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  request: { findFirst: vi.fn(), updateMany: vi.fn() },
  event: vi.fn(),
  delivery: vi.fn(),
  sync: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findUnique: mocks.community } } }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: () => ({ discordRoleRequest: mocks.request }) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: mocks.event, enqueueDelivery: mocks.delivery }));
vi.mock("@/lib/discord-role-sync", () => ({ syncGameRoleToProfile: mocks.sync }));
vi.mock("@/lib/discord-role-lock", () => ({ withRoleCreationLock: mocks.lock }));

import {
  ROLE_ALERT_THRESHOLD,
  enqueueRoleCreation,
  recordRoleCapacityAlert,
  requestRoleCreation,
  roleAutocreateEnabled,
  roleAutocreateQueueReady,
  roleCapacity,
  roleCreationCap,
  roleCreationResolver,
  runRoleCreationAction,
  type RoleCreationApi,
  type RoleRequestRow,
  type RoleRequestStore,
} from "./discord-role-autocreate";

const GUILD = "100000000000000001";
const PLAYER = "100000000000000022";
const NOW = new Date("2026-11-18T12:00:00Z");

function enableAll() {
  vi.stubEnv("DISCORD_ROLE_AUTOCREATE_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockImplementation(async ({ run }: { run: () => Promise<unknown> }) => ({ status: "acquired", value: await run() }));
  mocks.event.mockResolvedValue({ id: "event-1" });
  mocks.delivery.mockResolvedValue({ id: "delivery-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("verrous et plafond", () => {
  it("fermé sans la valeur exacte `true`", () => {
    expect(roleAutocreateEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(roleAutocreateEnabled({ DISCORD_ROLE_AUTOCREATE_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(roleAutocreateEnabled({ DISCORD_ROLE_AUTOCREATE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("exige aussi l'executor et le bot pour la file", () => {
    const base = { DISCORD_ROLE_AUTOCREATE_ENABLED: "true" };
    expect(roleAutocreateQueueReady(base as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(roleAutocreateQueueReady({ ...base, NOTIFICATION_EXECUTOR_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(roleAutocreateQueueReady({ ...base, NOTIFICATION_EXECUTOR_ENABLED: "true", DISCORD_BOT_TOKEN: "x" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("plafond configurable, jamais au-delà de 250, défaut 200", () => {
    expect(roleCreationCap({} as NodeJS.ProcessEnv)).toBe(200);
    expect(roleCreationCap({ DISCORD_ROLE_MAX_GUILD_ROLES: "120" } as unknown as NodeJS.ProcessEnv)).toBe(120);
    expect(roleCreationCap({ DISCORD_ROLE_MAX_GUILD_ROLES: "900" } as unknown as NodeJS.ProcessEnv)).toBe(250);
    expect(roleCreationCap({ DISCORD_ROLE_MAX_GUILD_ROLES: "abc" } as unknown as NodeJS.ProcessEnv)).toBe(200);
  });

  it("alerte à 80 % de 250 (200 rôles), refus au plafond", () => {
    expect(ROLE_ALERT_THRESHOLD).toBe(200);
    expect(roleCapacity(199, 250)).toBe("ok");
    expect(roleCapacity(200, 250)).toBe("alert");
    expect(roleCapacity(249, 250)).toBe("alert");
    expect(roleCapacity(250, 250)).toBe("full");
    expect(roleCapacity(120, 120)).toBe("full");
  });
});

function memoryStore(rows: Array<RoleRequestRow & { nameKey: string }> = []): RoleRequestStore & { rows: typeof rows } {
  return {
    rows,
    async findByName(_guild, nameKey) {
      return rows.find((row) => row.nameKey === nameKey) ?? null;
    },
    async countActiveSince(discordId, since, staleBefore) {
      const mine = rows
        .filter((row) => row.requesterDiscordId === discordId && row.requestedAt >= since)
        .filter((row) => row.status === "CREATED" || (row.status === "PENDING" && row.requestedAt > staleBefore))
        .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
      return { count: mine.length, oldest: mine[0]?.requestedAt ?? null };
    },
    async countPending(_guild, staleBefore) {
      return rows.filter((row) => row.status === "PENDING" && row.requestedAt > staleBefore).length;
    },
    async upsertPending(input) {
      const existing = rows.find((row) => row.nameKey === input.nameKey);
      if (existing) {
        Object.assign(existing, { status: "PENDING", requesterDiscordId: input.requesterDiscordId, requestedAt: input.now });
        return { id: existing.id };
      }
      rows.push({ id: `req-${rows.length + 1}`, nameKey: input.nameKey, requesterDiscordId: input.requesterDiscordId, status: "PENDING", requestedAt: input.now });
      return { id: `req-${rows.length}` };
    },
    async markFailed(id) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.status = "FAILED";
    },
  };
}

describe("requestRoleCreation", () => {
  const base = { communityId: "c1", guildId: GUILD, discordId: PLAYER, name: "Deep Rock Galactic", roleCount: 40, now: NOW };

  it("indisponible, sans rien écrire, quand la file est fermée", async () => {
    const store = memoryStore();
    expect(await requestRoleCreation({ ...base, store })).toEqual({ status: "unavailable" });
    expect(store.rows).toHaveLength(0);
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it("enregistre la demande et l'enfile (aucun appel Discord)", async () => {
    enableAll();
    const store = memoryStore();
    const enqueue = vi.fn().mockResolvedValue(true);
    expect(await requestRoleCreation({ ...base, store, enqueue })).toEqual({ status: "queued", requestId: "req-1" });
    expect(enqueue).toHaveBeenCalledWith({ requestId: "req-1", communityId: "c1", guildId: GUILD, requestedAt: NOW });
    expect(store.rows[0]).toMatchObject({ status: "PENDING", requesterDiscordId: PLAYER });
  });

  it("verrouille par joueur", async () => {
    enableAll();
    await requestRoleCreation({ ...base, store: memoryStore(), enqueue: vi.fn().mockResolvedValue(true) });
    expect(mocks.lock).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, key: `request:${PLAYER}` }));
  });

  it("refuse une deuxième création dans la semaine, avec la date de la prochaine", async () => {
    enableAll();
    const first = new Date("2026-11-15T12:00:00Z");
    const store = memoryStore([{ id: "old", nameKey: "valorant", requesterDiscordId: PLAYER, status: "CREATED", requestedAt: first }]);
    const enqueue = vi.fn();
    const result = await requestRoleCreation({ ...base, store, enqueue });
    expect(result).toEqual({ status: "quota", nextAt: new Date("2026-11-22T12:00:00Z") });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("une demande en échec ou vieille de plus d'une semaine ne bloque pas", async () => {
    enableAll();
    const store = memoryStore([
      { id: "a", nameKey: "valorant", requesterDiscordId: PLAYER, status: "FAILED", requestedAt: new Date("2026-11-17T12:00:00Z") },
      { id: "b", nameKey: "halo", requesterDiscordId: PLAYER, status: "CREATED", requestedAt: new Date("2026-11-10T11:00:00Z") },
    ]);
    const result = await requestRoleCreation({ ...base, store, enqueue: vi.fn().mockResolvedValue(true) });
    expect(result.status).toBe("queued");
  });

  it("une demande PENDING abandonnée (> 2 h) ne bloque ni le quota ni le nom", async () => {
    enableAll();
    const stale = new Date(NOW.getTime() - 3 * 60 * 60_000);
    const store = memoryStore([{ id: "s", nameKey: "deep rock galactic", requesterDiscordId: PLAYER, status: "PENDING", requestedAt: stale }]);
    const result = await requestRoleCreation({ ...base, store, enqueue: vi.fn().mockResolvedValue(true) });
    expect(result).toEqual({ status: "queued", requestId: "s" });
  });

  it("même nom déjà en cours : pas de doublon, pas de quota consommé", async () => {
    enableAll();
    const recent = new Date(NOW.getTime() - 5 * 60_000);
    const store = memoryStore([{ id: "p", nameKey: "deep rock galactic", requesterDiscordId: "100000000000000099", status: "PENDING", requestedAt: recent }]);
    const enqueue = vi.fn();
    expect(await requestRoleCreation({ ...base, name: "DEEP  rock galactic", store, enqueue })).toEqual({ status: "already_pending" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuse au plafond et enregistre l'alerte staff, sans consommer le quota", async () => {
    enableAll();
    vi.stubEnv("DISCORD_ROLE_MAX_GUILD_ROLES", "250");
    const store = memoryStore();
    const alert = vi.fn();
    const result = await requestRoleCreation({ ...base, roleCount: 250, store, alert, enqueue: vi.fn() });
    expect(result).toEqual({ status: "guild_full" });
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, roleCount: 250 }));
    expect(store.rows).toHaveLength(0);
  });

  it("alerte dès 200 rôles mais accepte la demande sous un plafond de 250", async () => {
    enableAll();
    vi.stubEnv("DISCORD_ROLE_MAX_GUILD_ROLES", "250");
    const alert = vi.fn();
    const result = await requestRoleCreation({ ...base, roleCount: 205, store: memoryStore(), alert, enqueue: vi.fn().mockResolvedValue(true) });
    expect(result.status).toBe("queued");
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("compte les demandes en cours dans la capacité", async () => {
    enableAll();
    const recent = new Date(NOW.getTime() - 60_000);
    const store = memoryStore([{ id: "p", nameKey: "halo", requesterDiscordId: "100000000000000099", status: "PENDING", requestedAt: recent }]);
    vi.stubEnv("DISCORD_ROLE_MAX_GUILD_ROLES", "41");
    expect(await requestRoleCreation({ ...base, roleCount: 40, store, alert: vi.fn(), enqueue: vi.fn() })).toEqual({ status: "guild_full" });
  });

  it("marque la demande FAILED si l'enfilage échoue (quota libéré)", async () => {
    enableAll();
    const store = memoryStore();
    expect(await requestRoleCreation({ ...base, store, enqueue: vi.fn().mockResolvedValue(false) })).toEqual({ status: "unavailable" });
    expect(store.rows[0].status).toBe("FAILED");
  });

  it("verrou occupé : busy, rien n'est écrit", async () => {
    enableAll();
    mocks.lock.mockResolvedValue({ status: "busy" });
    const store = memoryStore();
    expect(await requestRoleCreation({ ...base, store })).toEqual({ status: "busy" });
    expect(store.rows).toHaveLength(0);
  });

  it("table absente : indisponible (migration requise), jamais d'exception", async () => {
    enableAll();
    const store = memoryStore();
    store.findByName = async () => {
      throw Object.assign(new Error("relation does not exist"), { code: "P2021" });
    };
    expect(await requestRoleCreation({ ...base, store })).toEqual({ status: "unavailable" });
  });
});

describe("enqueueRoleCreation et alerte", () => {
  it("événement ADMIN ROLE_AUTOCREATE + livraison BOT, sans message", async () => {
    expect(await enqueueRoleCreation({ requestId: "req-1", communityId: "c1", guildId: GUILD, requestedAt: NOW })).toBe(true);
    expect(mocks.event).toHaveBeenCalledWith({
      communityId: "c1",
      category: "ADMIN",
      eventType: "ROLE_AUTOCREATE",
      sourceId: "req-1",
      occurrence: String(NOW.getTime()),
      payload: { requestId: "req-1" },
    });
    expect(mocks.delivery).toHaveBeenCalledWith({
      eventId: "event-1",
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "role-request:req-1",
      targetSlot: `${GUILD}:ADMIN:req-1:role-create`,
    });
  });

  it("renvoie false (journalisé) si la file échoue", async () => {
    mocks.event.mockRejectedValue(new Error("db"));
    expect(await enqueueRoleCreation({ requestId: "req-1", communityId: "c1", guildId: GUILD, requestedAt: NOW })).toBe(false);
  });

  it("l'alerte est un événement ADMIN dédupliqué par jour, sans livraison", async () => {
    await recordRoleCapacityAlert({ communityId: "c1", guildId: GUILD, roleCount: 210, now: NOW });
    expect(mocks.event).toHaveBeenCalledWith(
      expect.objectContaining({ category: "ADMIN", eventType: "ROLE_CAPACITY_ALERT", sourceId: GUILD, occurrence: "2026-11-18" })
    );
    expect(mocks.delivery).not.toHaveBeenCalled();
  });
});

describe("roleCreationResolver", () => {
  const event = { category: "ADMIN", eventType: "ROLE_AUTOCREATE", sourceId: "req-1", communityId: "c1", payload: { requestId: "req-1" } };
  const delivery = {
    operation: "SEND",
    channel: "DISCORD_CHANNEL",
    transport: "BOT",
    recipientKey: "role-request:req-1",
    targetSlot: `${GUILD}:ADMIN:req-1:role-create`,
  };
  const resolve = (overrides: Record<string, unknown> = {}) =>
    roleCreationResolver.resolve({ event: { ...event, ...overrides }, delivery } as never);

  beforeEach(() => {
    mocks.community.mockResolvedValue({ status: "ACTIVE", discordGuildId: GUILD });
    mocks.request.findFirst.mockResolvedValue({ status: "PENDING" });
  });

  it("éligible : action create_game_role", async () => {
    enableAll();
    expect(await resolve()).toEqual({ eligible: true, action: { kind: "create_game_role", requestId: "req-1", communityId: "c1" } });
  });

  it("refuse flag fermé, bot absent, communauté inactive, demande déjà traitée, slot altéré", async () => {
    expect(await resolve()).toEqual({ eligible: false, reason: "not_configured" });
    vi.stubEnv("DISCORD_ROLE_AUTOCREATE_ENABLED", "true");
    expect(await resolve()).toEqual({ eligible: false, reason: "configuration_unavailable" });
    enableAll();
    mocks.community.mockResolvedValueOnce({ status: "SUSPENDED", discordGuildId: GUILD });
    expect(await resolve()).toEqual({ eligible: false, reason: "expired" });
    mocks.request.findFirst.mockResolvedValueOnce({ status: "CREATED" });
    expect(await resolve()).toEqual({ eligible: false, reason: "expired" });
    expect(await roleCreationResolver.resolve({ event, delivery: { ...delivery, targetSlot: "autre" } } as never)).toEqual({
      eligible: false,
      reason: "unresolvable",
    });
    expect(await resolve({ eventType: "AUTRE" })).toEqual({ eligible: false, reason: "unresolvable" });
  });
});

describe("runRoleCreationAction", () => {
  const request = { id: "req-1", guildId: GUILD, name: "Deep Rock Galactic", requesterDiscordId: PLAYER, status: "PENDING", roleId: null };
  const deadline = new Date(NOW.getTime() + 20_000);
  const role = (id: string, name: string, extra: Partial<{ permissions: string; managed: boolean; position: number }> = {}) => ({
    id,
    name,
    position: 3,
    permissions: "0",
    managed: false,
    ...extra,
  });
  function fakeApi(roles = [role("r1", "Valorant")]): RoleCreationApi & { created: string[]; added: string[][] } {
    const api = {
      created: [] as string[],
      added: [] as string[][],
      listRoles: vi.fn(async () => ({ ok: true as const, data: { roles } })),
      createRole: vi.fn(async (_guild: string, name: string) => {
        api.created.push(name);
        return { ok: true as const, data: { id: "200000000000000001", name } };
      }),
      addMemberRole: vi.fn(async (guild: string, user: string, roleId: string) => {
        api.added.push([guild, user, roleId]);
        return { ok: true as const, data: { added: true as const } };
      }),
    };
    return api;
  }

  beforeEach(() => {
    mocks.request.findFirst.mockResolvedValue(request);
    mocks.request.updateMany.mockResolvedValue({ count: 1 });
    mocks.sync.mockResolvedValue({ status: "synced", tagName: "Deep Rock Galactic" });
  });

  it("crée le rôle sans permission, l'attribue au demandeur, marque CREATED et synchronise le profil", async () => {
    const api = fakeApi();
    expect(await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, api, NOW)).toEqual({ ok: true, data: {} });
    expect(api.created).toEqual(["Deep Rock Galactic"]);
    expect(api.added).toEqual([[GUILD, PLAYER, "200000000000000001"]]);
    expect(mocks.request.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CREATED", roleId: "200000000000000001" }) })
    );
    expect(mocks.sync).toHaveBeenCalledWith({ discordId: PLAYER, gameName: "Deep Rock Galactic" });
  });

  it("réutilise un rôle existant au même nom normalisé (jamais de doublon)", async () => {
    const api = fakeApi([role("300000000000000001", "deep rock  GALACTIC")]);
    await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, api, NOW);
    expect(api.created).toEqual([]);
    expect(api.added[0][2]).toBe("300000000000000001");
  });

  it("rejeu après création : le roleId persisté évite toute nouvelle création", async () => {
    mocks.request.findFirst.mockResolvedValue({ ...request, roleId: "200000000000000001" });
    const api = fakeApi();
    await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, api, NOW);
    expect(api.listRoles).not.toHaveBeenCalled();
    expect(api.created).toEqual([]);
    expect(api.added[0][2]).toBe("200000000000000001");
  });

  it("n'attribue jamais un rôle existant sensible : échec définitif, demande FAILED", async () => {
    const api = fakeApi([role("300000000000000001", "Deep Rock Galactic", { permissions: String(1 << 3) })]);
    const result = await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, api, NOW);
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(api.added).toEqual([]);
    expect(mocks.request.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", failureReason: "sensitive" }) }));
  });

  it("serveur plein : échec définitif, alerte, aucune création", async () => {
    const roles = Array.from({ length: 200 }, (_, index) => role(`4${String(index).padStart(17, "0")}`, `Jeu ${index}`));
    const api = fakeApi(roles);
    const result = await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, api, NOW);
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(api.created).toEqual([]);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ eventType: "ROLE_CAPACITY_ALERT" }));
  });

  it("échec Discord retentable propagé, demande laissée PENDING", async () => {
    const api = fakeApi();
    const failure = { ok: false as const, kind: "rate_limited" as const, message: "x", retryable: true };
    api.createRole = vi.fn(async () => failure);
    expect(await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, api, NOW)).toEqual(failure);
    expect(mocks.request.updateMany).not.toHaveBeenCalled();
  });

  it("joueur parti du serveur : rôle créé, demande CREATED avec raison, pas de synchro profil", async () => {
    const api = fakeApi();
    api.addMemberRole = vi.fn(async () => ({ ok: false as const, kind: "not_found" as const, message: "x", retryable: false }));
    expect(await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, api, NOW)).toEqual({ ok: true, data: {} });
    expect(mocks.request.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CREATED", failureReason: "member_not_found" }) })
    );
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("demande absente : échec définitif ; demande déjà FAILED : rien à faire", async () => {
    mocks.request.findFirst.mockResolvedValueOnce(null);
    expect(await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, fakeApi(), NOW)).toMatchObject({ ok: false, retryable: false });
    mocks.request.findFirst.mockResolvedValueOnce({ ...request, status: "FAILED" });
    const api = fakeApi();
    expect(await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, api, NOW)).toEqual({ ok: true, data: {} });
    expect(api.created).toEqual([]);
  });

  it("exception inattendue : échec retentable journalisé", async () => {
    mocks.request.findFirst.mockRejectedValueOnce(new Error("db"));
    expect(await runRoleCreationAction({ requestId: "req-1", communityId: "c1" }, deadline, fakeApi(), NOW)).toMatchObject({ ok: false, retryable: true });
  });
});
