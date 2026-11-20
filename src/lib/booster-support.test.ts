import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  communityUnique: vi.fn(),
  membership: vi.fn(),
  support: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  space: { findFirst: vi.fn() },
  event: vi.fn(),
  delivery: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { community: { findMany: mocks.community, findUnique: mocks.communityUnique }, membership: { findMany: mocks.membership } },
}));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: () => ({ boosterSupport: mocks.support, boosterSupportSpace: mocks.space }) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: mocks.event, enqueueDelivery: mocks.delivery }));

import {
  boosterQueueReady,
  boosterSyncResolver,
  boosterTransition,
  boostersEnabled,
  enqueueBoosterSync,
  loadSupportWall,
  needsRoleSync,
  readStoredBoosterState,
  runBoosterSync,
} from "./booster-support";

const GUILD = "100000000000000001";
const U1 = "100000000000000011";
const U2 = "100000000000000012";
const SINCE = "2026-10-01T10:00:00.000Z";

function open() {
  vi.stubEnv("DISCORD_BOOSTERS_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.community.mockResolvedValue([{ id: "c1", discordGuildId: GUILD }]);
  mocks.membership.mockResolvedValue([
    { userId: "u1", user: { discordId: U1 } },
    { userId: "u2", user: { discordId: U2 } },
  ]);
  mocks.support.findMany.mockResolvedValue([]);
  mocks.support.upsert.mockResolvedValue({});
  mocks.support.updateMany.mockResolvedValue({ count: 1 });
  mocks.space.findFirst.mockResolvedValue(null);
  mocks.event.mockResolvedValue({ id: "ev" });
  mocks.delivery.mockResolvedValue({ id: "d" });
});
afterEach(() => vi.unstubAllEnvs());

describe("verrous et règles pures", () => {
  it("fermé sans la valeur exacte `true` ; file exige executor et bot", () => {
    expect(boostersEnabled({ DISCORD_BOOSTERS_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(boosterQueueReady({ DISCORD_BOOSTERS_ENABLED: "true", DISCORD_BOT_TOKEN: "x" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(boosterQueueReady({ DISCORD_BOOSTERS_ENABLED: "true", DISCORD_BOT_TOKEN: "x", NOTIFICATION_EXECUTOR_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("transitions de boost", () => {
    expect(boosterTransition(false, SINCE)).toBe("start");
    expect(boosterTransition(true, null)).toBe("end");
    expect(boosterTransition(true, SINCE)).toBe("unchanged");
    expect(boosterTransition(false, null)).toBe("unchanged");
    expect(boosterTransition(false, "n'importe quoi")).toBe("unchanged");
  });
  it("le rôle est à synchroniser quand il diverge du boost", () => {
    expect(needsRoleSync({ boosting: true, roleGranted: false })).toBe(true);
    expect(needsRoleSync({ boosting: false, roleGranted: true })).toBe(true);
    expect(needsRoleSync({ boosting: true, roleGranted: true })).toBe(false);
  });
});

describe("runBoosterSync", () => {
  it("fermé : ne lit rien", async () => {
    const readProfile = vi.fn();
    expect(await runBoosterSync({ readProfile })).toMatchObject({ communities: 0, checked: 0 });
    expect(readProfile).not.toHaveBeenCalled();
    expect(mocks.community).not.toHaveBeenCalled();
  });

  it("nouveau booster : état enregistré, rôle enfilé, espace à créer une fois", async () => {
    open();
    const readProfile = vi.fn(async (_g: string, discordId: string) => ({ ok: true as const, premiumSince: discordId === U1 ? SINCE : null }));
    const enqueue = vi.fn().mockResolvedValue(true);
    const summary = await runBoosterSync({ readProfile, enqueue });
    expect(summary).toMatchObject({ checked: 2, started: 1, ended: 0, queued: 2 });
    expect(mocks.support.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: "u1", boosting: true }) }));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ intent: "member", discordId: U1 }), expect.any(Date));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ intent: "provision" }), expect.any(Date));
    expect(enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ discordId: U2 }), expect.anything());
  });

  it("n'enfile aucune création d'espace sans booster, ni quand l'espace existe", async () => {
    open();
    const enqueue = vi.fn().mockResolvedValue(true);
    await runBoosterSync({ readProfile: async () => ({ ok: true, premiumSince: null }), enqueue });
    expect(enqueue).not.toHaveBeenCalled();
    mocks.space.findFirst.mockResolvedValue({ id: "s" });
    await runBoosterSync({ readProfile: async () => ({ ok: true, premiumSince: SINCE }), enqueue });
    expect(enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ intent: "provision" }), expect.anything());
  });

  it("fin de boost : endedAt posé, retrait du rôle enfilé", async () => {
    open();
    mocks.support.findMany.mockResolvedValue([{ id: "r1", userId: "u1", discordId: U1, boosting: true, roleGranted: true, checkedAt: new Date(0) }]);
    mocks.space.findFirst.mockResolvedValue({ id: "s" });
    const enqueue = vi.fn().mockResolvedValue(true);
    const summary = await runBoosterSync({ readProfile: async () => ({ ok: true, premiumSince: null }), enqueue });
    expect(summary.ended).toBe(1);
    expect(mocks.support.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ boosting: false, endedAt: expect.any(Date) }) }));
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ intent: "member", discordId: U1 }), expect.any(Date));
  });

  it("membre parti du serveur (404) : fin de soutien ; autre erreur : état inchangé", async () => {
    open();
    mocks.support.findMany.mockResolvedValue([{ id: "r1", userId: "u1", discordId: U1, boosting: true, roleGranted: true, checkedAt: new Date(0) }]);
    mocks.space.findFirst.mockResolvedValue({ id: "s" });
    const readProfile = vi.fn(async (_g: string, discordId: string) =>
      discordId === U1 ? ({ ok: false as const, kind: "not_found" }) : ({ ok: false as const, kind: "server_error" })
    );
    const summary = await runBoosterSync({ readProfile, enqueue: vi.fn().mockResolvedValue(true) });
    expect(summary).toMatchObject({ ended: 1, errors: 1, checked: 1 });
    expect(mocks.support.upsert).toHaveBeenCalledTimes(1);
  });

  it("limite de débit : arrêt du passage", async () => {
    open();
    const readProfile = vi.fn(async () => ({ ok: false as const, kind: "rate_limited" }));
    const summary = await runBoosterSync({ readProfile, enqueue: vi.fn() });
    expect(summary).toMatchObject({ stoppedEarly: true, errors: 1 });
    expect(readProfile).toHaveBeenCalledTimes(1);
  });

  it("membre devenu inactif alors qu'il boostait : fin de soutien", async () => {
    open();
    mocks.membership.mockResolvedValue([]);
    mocks.support.findMany.mockResolvedValue([{ id: "r1", userId: "gone", discordId: U1, boosting: true, roleGranted: true, checkedAt: new Date() }]);
    const enqueue = vi.fn().mockResolvedValue(true);
    const summary = await runBoosterSync({ readProfile: vi.fn(), enqueue });
    expect(summary.ended).toBe(1);
    expect(mocks.support.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ boosting: false }) }));
  });

  it("les moins récemment vérifiés passent d'abord", async () => {
    open();
    mocks.support.findMany.mockResolvedValue([
      { id: "a", userId: "u1", discordId: U1, boosting: false, roleGranted: false, checkedAt: new Date("2026-11-18T10:00:00Z") },
    ]);
    const order: string[] = [];
    await runBoosterSync({ readProfile: async (_g, id) => (order.push(id), { ok: true, premiumSince: null }), enqueue: vi.fn() });
    expect(order).toEqual([U2, U1]);
  });
});

describe("enqueueBoosterSync", () => {
  it("fermé : rien n'est écrit", async () => {
    expect(await enqueueBoosterSync({ communityId: "c1", guildId: GUILD, intent: "provision" })).toBe(false);
    expect(mocks.event).not.toHaveBeenCalled();
  });
  it("événement ADMIN + livraison BOT, créneau par membre", async () => {
    open();
    expect(await enqueueBoosterSync({ communityId: "c1", guildId: GUILD, intent: "member", discordId: U1 })).toBe(true);
    expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ category: "ADMIN", eventType: "BOOSTER_SUPPORT_SYNC", sourceId: "c1" }));
    expect(mocks.delivery).toHaveBeenCalledWith(expect.objectContaining({ transport: "BOT", targetSlot: `${GUILD}:ADMIN:c1:booster-member-${U1}` }));
  });
  it("refuse un identifiant de membre invalide et renvoie false si la file échoue", async () => {
    open();
    expect(await enqueueBoosterSync({ communityId: "c1", guildId: GUILD, intent: "member", discordId: "abc" })).toBe(false);
    mocks.event.mockRejectedValueOnce(new Error("db"));
    expect(await enqueueBoosterSync({ communityId: "c1", guildId: GUILD, intent: "provision" })).toBe(false);
  });
});

describe("boosterSyncResolver", () => {
  const event = { category: "ADMIN", eventType: "BOOSTER_SUPPORT_SYNC", sourceId: "c1", communityId: "c1", payload: { intent: "member", discordId: U1 } };
  const delivery = { operation: "SEND", channel: "DISCORD_CHANNEL", transport: "BOT", recipientKey: "booster:c1", targetSlot: `${GUILD}:ADMIN:c1:booster-member-${U1}` };
  beforeEach(() => mocks.communityUnique.mockResolvedValue({ status: "ACTIVE", discordGuildId: GUILD }));

  it("éligible : action sync_booster_support", async () => {
    open();
    expect(await boosterSyncResolver.resolve({ event, delivery } as never)).toEqual({
      eligible: true,
      action: { kind: "sync_booster_support", intent: "member", communityId: "c1", discordId: U1 },
    });
  });
  it("refuse flag fermé, bot absent, communauté inactive, slot altéré", async () => {
    expect(await boosterSyncResolver.resolve({ event, delivery } as never)).toEqual({ eligible: false, reason: "not_configured" });
    vi.stubEnv("DISCORD_BOOSTERS_ENABLED", "true");
    expect(await boosterSyncResolver.resolve({ event, delivery } as never)).toEqual({ eligible: false, reason: "configuration_unavailable" });
    open();
    mocks.communityUnique.mockResolvedValueOnce({ status: "SUSPENDED", discordGuildId: GUILD });
    expect(await boosterSyncResolver.resolve({ event, delivery } as never)).toEqual({ eligible: false, reason: "expired" });
    expect(await boosterSyncResolver.resolve({ event, delivery: { ...delivery, targetSlot: "autre" } } as never)).toEqual({ eligible: false, reason: "unresolvable" });
  });
});

describe("mur et état stocké", () => {
  it("le mur ne liste que les soutiens actifs, profils masqués exclus", async () => {
    mocks.support.findMany.mockResolvedValue([{ userId: "u1", since: new Date(SINCE), user: { discordName: "Sarah", discordAvatar: null } }]);
    expect(await loadSupportWall("c1")).toEqual([{ userId: "u1", name: "Sarah", image: null, since: new Date(SINCE) }]);
    expect(mocks.support.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ boosting: true, user: expect.objectContaining({ profileVisibility: { is: null } }) }) })
    );
  });
  it("état stocké : null fermé, sinon la ligne ; table absente : null", async () => {
    expect(await readStoredBoosterState({ userId: "u1", communityId: "c1" })).toBeNull();
    open();
    mocks.support.findFirst.mockResolvedValueOnce({ boosting: true, since: new Date(SINCE) });
    expect(await readStoredBoosterState({ userId: "u1", communityId: "c1" })).toEqual({ boosting: true, since: new Date(SINCE) });
    mocks.support.findFirst.mockRejectedValueOnce(new Error("does not exist"));
    expect(await readStoredBoosterState({ userId: "u1", communityId: "c1" })).toBeNull();
  });
});
