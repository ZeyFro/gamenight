import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  membershipCount: vi.fn(),
  support: { findFirst: vi.fn(), updateMany: vi.fn() },
  space: { findFirst: vi.fn(), upsert: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findUnique: mocks.community }, membership: { count: mocks.membershipCount } } }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: () => ({ boosterSupport: mocks.support, boosterSupportSpace: mocks.space }) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { isPrivateToEveryone, runBoosterSyncAction, type BoosterDiscordApi } from "./booster-support-runner";

const GUILD = "100000000000000001";
const USER = "100000000000000011";
const ROLE = "200000000000000001";
const deadline = new Date(Date.now() + 20_000);
const VIEW = String(2 ** 10);
const ok = <T,>(data: T) => ({ ok: true as const, data });
const role = (id: string, name: string, permissions = "0") => ({ id, name, position: 2, permissions, managed: false });

function fakeApi(over: Partial<{ roles: ReturnType<typeof role>[]; channels: Array<{ id: string; name: string; type: number; permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }> }> }> = {}) {
  const calls: string[] = [];
  const api: BoosterDiscordApi = {
    listRoles: async () => ok({ roles: over.roles ?? [] }),
    listChannels: async () => ok(over.channels ?? []),
    createRole: async () => (calls.push("createRole"), ok({ id: ROLE, name: "Soutien de la Tour" })),
    createChannel: async (_g, name, type) => (calls.push(`createChannel:${type}:${name}`), ok({ id: type === 0 ? "300000000000000001" : "300000000000000002" })),
    addRole: async (_g, user, roleId) => (calls.push(`add:${user}:${roleId}`), ok({})),
    removeRole: async (_g, user, roleId) => (calls.push(`remove:${user}:${roleId}`), ok({})),
  };
  return { api, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.community.mockResolvedValue({ status: "ACTIVE", discordGuildId: GUILD });
  mocks.membershipCount.mockResolvedValue(1);
  mocks.support.findFirst.mockResolvedValue({ id: "b1", userId: "u1", boosting: true, roleGranted: false });
  mocks.support.updateMany.mockResolvedValue({ count: 1 });
  mocks.space.findFirst.mockResolvedValue({ guildId: GUILD, roleId: ROLE });
  mocks.space.upsert.mockResolvedValue({});
});

describe("provision", () => {
  it("crée le rôle sans permission et deux salons privés, une seule fois", async () => {
    mocks.space.findFirst.mockResolvedValueOnce(null);
    const { api, calls } = fakeApi();
    expect(await runBoosterSyncAction({ intent: "provision", communityId: "c1" }, deadline, api)).toEqual({ ok: true, data: {} });
    expect(calls).toEqual(["createRole", "createChannel:0:soutiens-de-la-tour", "createChannel:2:Soutiens de la Tour"]);
    expect(mocks.space.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ roleId: ROLE, channelId: "300000000000000001", voiceChannelId: "300000000000000002" }) }));
  });

  it("espace déjà enregistré : aucun appel Discord", async () => {
    const { api, calls } = fakeApi();
    await runBoosterSyncAction({ intent: "provision", communityId: "c1" }, deadline, api);
    expect(calls).toEqual([]);
  });

  it("retrouve rôle et salons privés par nom (rejeu sans doublon)", async () => {
    mocks.space.findFirst.mockResolvedValueOnce(null);
    const priv = [{ id: GUILD, type: 0, allow: "0", deny: VIEW }];
    const { api, calls } = fakeApi({
      roles: [role(ROLE, "soutien de la tour")],
      channels: [
        { id: "300000000000000001", name: "soutiens-de-la-tour", type: 0, permission_overwrites: priv },
        { id: "300000000000000002", name: "Soutiens de la Tour", type: 2, permission_overwrites: priv },
      ],
    });
    await runBoosterSyncAction({ intent: "provision", communityId: "c1" }, deadline, api);
    expect(calls).toEqual([]);
    expect(mocks.space.upsert).toHaveBeenCalled();
  });

  it("n'adopte jamais un salon homonyme public, ni un rôle homonyme avec permissions", async () => {
    mocks.space.findFirst.mockResolvedValue(null);
    const publicChannel = fakeApi({ channels: [{ id: "300000000000000001", name: "soutiens-de-la-tour", type: 0 }] });
    expect(await runBoosterSyncAction({ intent: "provision", communityId: "c1" }, deadline, publicChannel.api)).toMatchObject({ ok: false, retryable: false });
    expect(mocks.space.upsert).not.toHaveBeenCalled();
    const powerful = fakeApi({ roles: [role(ROLE, "Soutien de la Tour", "8")] });
    expect(await runBoosterSyncAction({ intent: "provision", communityId: "c1" }, deadline, powerful.api)).toMatchObject({ ok: false, retryable: false });
  });

  it("refuse (capacity) à 250 rôles ou 500 salons", async () => {
    mocks.space.findFirst.mockResolvedValue(null);
    const fullRoles = fakeApi({ roles: Array.from({ length: 250 }, (_, i) => role(`4${String(i).padStart(17, "0")}`, `Jeu ${i}`)) });
    expect(await runBoosterSyncAction({ intent: "provision", communityId: "c1" }, deadline, fullRoles.api)).toMatchObject({ ok: false, retryable: false });
    const fullChannels = fakeApi({ channels: Array.from({ length: 499 }, (_, i) => ({ id: `5${String(i).padStart(17, "0")}`, name: `c${i}`, type: 0 })) });
    expect(await runBoosterSyncAction({ intent: "provision", communityId: "c1" }, deadline, fullChannels.api)).toMatchObject({ ok: false, retryable: false });
    expect(fullRoles.calls).toEqual([]);
  });
});

describe("member", () => {
  const input = { intent: "member" as const, communityId: "c1", discordId: USER };

  it("soutien actif : rôle ajouté, état confirmé", async () => {
    const { api, calls } = fakeApi();
    expect(await runBoosterSyncAction(input, deadline, api)).toEqual({ ok: true, data: {} });
    expect(calls).toEqual([`add:${USER}:${ROLE}`]);
    expect(mocks.support.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleGranted: true }) }));
  });

  it("fin de boost : rôle retiré automatiquement", async () => {
    mocks.support.findFirst.mockResolvedValue({ id: "b1", userId: "u1", boosting: false, roleGranted: true });
    const { api, calls } = fakeApi();
    await runBoosterSyncAction(input, deadline, api);
    expect(calls).toEqual([`remove:${USER}:${ROLE}`]);
    expect(mocks.support.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleGranted: false }) }));
  });

  it("membre devenu inactif : rôle retiré même si le boost continue", async () => {
    mocks.membershipCount.mockResolvedValue(0);
    mocks.support.findFirst.mockResolvedValue({ id: "b1", userId: "u1", boosting: true, roleGranted: true });
    const { api, calls } = fakeApi();
    await runBoosterSyncAction(input, deadline, api);
    expect(calls).toEqual([`remove:${USER}:${ROLE}`]);
  });

  it("rien à faire quand le rôle n'a jamais été attribué (aucun appel Discord)", async () => {
    mocks.support.findFirst.mockResolvedValue({ id: "b1", userId: "u1", boosting: false, roleGranted: false });
    const { api, calls } = fakeApi();
    await runBoosterSyncAction(input, deadline, api);
    expect(calls).toEqual([]);
  });

  it("sans espace : le retrait ne crée rien ; l'ajout le crée d'abord", async () => {
    mocks.space.findFirst.mockResolvedValue(null);
    mocks.support.findFirst.mockResolvedValue({ id: "b1", userId: "u1", boosting: false, roleGranted: true });
    const removal = fakeApi();
    await runBoosterSyncAction(input, deadline, removal.api);
    expect(removal.calls).toEqual([]);
    mocks.support.findFirst.mockResolvedValue({ id: "b1", userId: "u1", boosting: true, roleGranted: false });
    mocks.space.findFirst.mockResolvedValue(null);
    const addition = fakeApi();
    await runBoosterSyncAction(input, deadline, addition.api);
    expect(addition.calls[0]).toBe("createRole");
    expect(addition.calls.at(-1)).toBe(`add:${USER}:${ROLE}`);
  });

  it("retrait rejoué (404) idempotent ; échec retentable propagé sans changer l'état", async () => {
    mocks.support.findFirst.mockResolvedValue({ id: "b1", userId: "u1", boosting: false, roleGranted: true });
    const gone = fakeApi();
    gone.api.removeRole = async () => ({ ok: false, kind: "not_found", message: "x", retryable: false });
    expect(await runBoosterSyncAction(input, deadline, gone.api)).toEqual({ ok: true, data: {} });
    const limited = fakeApi();
    const failure = { ok: false as const, kind: "rate_limited" as const, message: "x", retryable: true };
    limited.api.removeRole = async () => failure;
    mocks.support.updateMany.mockClear();
    expect(await runBoosterSyncAction(input, deadline, limited.api)).toEqual(failure);
    expect(mocks.support.updateMany).not.toHaveBeenCalled();
  });

  it("ligne absente, communauté inactive, exception : sans effet ou échec explicite", async () => {
    mocks.support.findFirst.mockResolvedValueOnce(null);
    expect(await runBoosterSyncAction(input, deadline, fakeApi().api)).toEqual({ ok: true, data: {} });
    mocks.community.mockResolvedValueOnce({ status: "SUSPENDED", discordGuildId: GUILD });
    expect(await runBoosterSyncAction(input, deadline, fakeApi().api)).toMatchObject({ ok: false, retryable: false });
    mocks.community.mockRejectedValueOnce(new Error("db"));
    expect(await runBoosterSyncAction(input, deadline, fakeApi().api)).toMatchObject({ ok: false, retryable: true });
  });
});

describe("isPrivateToEveryone", () => {
  it("exige un refus de « Voir le salon » pour @everyone", () => {
    expect(isPrivateToEveryone({ id: "1", name: "x", type: 0, permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: VIEW }] }, GUILD)).toBe(true);
    expect(isPrivateToEveryone({ id: "1", name: "x", type: 0, permission_overwrites: [{ id: GUILD, type: 0, allow: VIEW, deny: "0" }] }, GUILD)).toBe(false);
    expect(isPrivateToEveryone({ id: "1", name: "x", type: 0 }, GUILD)).toBe(false);
  });
});
