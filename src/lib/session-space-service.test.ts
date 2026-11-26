import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  cleanupSessionSpace,
  provisionSessionSpace,
  syncSessionSpaceMember,
  type SessionSpaceApi,
  type SessionSpaceLink,
  type SessionSpaceSession,
  type SessionSpaceSource,
  type SessionSpaceStore,
} from "./session-space-service";
import { fromSessionSpaceStatus } from "./session-space-runner";

const ENV = { SESSION_VISIBILITY_ENABLED: "true" };
const GUILD = "100000000000000001";
const PARENT = "100000000000000002";
const A = "200000000000000001";
const B = "200000000000000002";
const C = "200000000000000003";
const START = new Date("2026-11-20T20:00:00.000Z");
const BEFORE_START = new Date(START.getTime() - 20 * 60_000);
const AFTER_END = new Date(START.getTime() + 7 * 3_600_000);

function makeSession(overrides: Partial<SessionSpaceSession> = {}): SessionSpaceSession {
  return {
    id: "s1", visibility: "APPLICATION", status: "SCHEDULED", date: START, communityId: "c1",
    destination: { guildId: GUILD, channelId: PARENT }, roster: [A, B], ...overrides,
  };
}

function memorySource(session: SessionSpaceSession | null): SessionSpaceSource {
  return { load: async () => session };
}

function memoryStore(seed: SessionSpaceLink | null = null): SessionSpaceStore & { row: SessionSpaceLink | null } {
  const store = {
    row: seed,
    async find() { return store.row ? { ...store.row } : null; },
    async save(link: Parameters<SessionSpaceStore["save"]>[0]) {
      const { sessionId, communityId, guildId, parentChannelId, ...rest } = link;
      store.row = {
        threadId: null, voiceChannelId: null, cleanedAt: null, ...(store.row ?? {}),
        sessionId, communityId, guildId, parentChannelId,
        ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined && value !== null)),
      };
    },
  };
  return store;
}

function fakeApi(overrides: Partial<SessionSpaceApi> = {}) {
  const calls: string[] = [];
  const api: SessionSpaceApi = {
    createPrivateThread: vi.fn(async (parent: string) => { calls.push(`thread:${parent}`); return "300000000000000001"; }),
    addThreadMember: vi.fn(async (_t: string, id: string) => { calls.push(`thread-add:${id}`); }),
    removeThreadMember: vi.fn(async (_t: string, id: string) => { calls.push(`thread-remove:${id}`); }),
    createVoiceChannel: vi.fn(async (_g: string, _n: string, members: string[]) => { calls.push(`voice:${members.join(",")}`); return "400000000000000001"; }),
    allowVoiceMember: vi.fn(async (_c: string, id: string) => { calls.push(`voice-allow:${id}`); }),
    denyVoiceMember: vi.fn(async (_c: string, id: string) => { calls.push(`voice-deny:${id}`); }),
    memberVoiceChannel: vi.fn(async () => null),
    deleteChannel: vi.fn(async (id: string) => { calls.push(`delete:${id}`); }),
    ...overrides,
  };
  return { api, calls };
}

const fullLink = (overrides: Partial<SessionSpaceLink> = {}): SessionSpaceLink => ({
  sessionId: "s1", communityId: "c1", guildId: GUILD, parentChannelId: PARENT,
  threadId: "300000000000000001", voiceChannelId: "400000000000000001", cleanedAt: null, ...overrides,
});

describe("provisionSessionSpace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flag éteint : aucune lecture, aucun appel Discord", async () => {
    const { api, calls } = fakeApi();
    const source = { load: vi.fn() };
    const result = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(), source, env: {}, now: BEFORE_START });
    expect(result.status).toBe("disabled");
    expect(source.load).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("crée fil privé puis vocal privé à 30 min du début, et persiste chaque identifiant", async () => {
    const { api, calls } = fakeApi();
    const store = memoryStore();
    const result = await provisionSessionSpace({ sessionId: "s1", api, store, source: memorySource(makeSession()), env: ENV, now: BEFORE_START });
    expect(result).toEqual({ status: "created", threadId: "300000000000000001", voiceChannelId: "400000000000000001" });
    expect(calls).toEqual([`thread:${PARENT}`, `thread-add:${A}`, `thread-add:${B}`, `voice:${A},${B}`]);
    expect(store.row).toMatchObject({ threadId: "300000000000000001", voiceChannelId: "400000000000000001", guildId: GUILD });
  });

  it.each(["APPLICATION", "PRIVATE"] as const)("crée des espaces temporaires pour le mode %s", async visibility => {
    const { api, calls } = fakeApi();
    const result = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(), source: memorySource(makeSession({ visibility })), env: ENV, now: BEFORE_START });
    expect(result.status).toBe("created");
    expect(calls).toContain(`thread:${PARENT}`);
    expect(calls).toContain(`voice:${A},${B}`);
  });

  it("ne crée pas de salon temporaire pour une soirée publique", async () => {
    const { api, calls } = fakeApi();
    const result = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(), source: memorySource(makeSession({ visibility: "PUBLIC" })), env: ENV, now: BEFORE_START });
    expect(result.status).toBe("nothing_to_do");
    expect(calls).toEqual([]);
  });

  it("n'est pas dû plus de 30 min avant, ni pour une soirée non planifiée", async () => {
    const { api, calls } = fakeApi();
    const early = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(), source: memorySource(makeSession()), env: ENV, now: new Date(START.getTime() - 45 * 60_000) });
    const voting = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(), source: memorySource(makeSession({ status: "VOTING" })), env: ENV, now: BEFORE_START });
    expect([early.status, voting.status]).toEqual(["not_due", "not_due"]);
    expect(calls).toEqual([]);
  });

  it("ne crée rien sans salon configuré ni pour une soirée solo", async () => {
    const { api, calls } = fakeApi();
    const noChannel = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(), source: memorySource(makeSession({ destination: null })), env: ENV, now: BEFORE_START });
    const solo = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(), source: memorySource(makeSession({ roster: [A] })), env: ENV, now: BEFORE_START });
    expect([noChannel.status, solo.status]).toEqual(["not_configured", "too_small"]);
    expect(calls).toEqual([]);
  });

  it("rejeu : un espace complet est réutilisé sans aucun appel Discord", async () => {
    const { api, calls } = fakeApi();
    const result = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(fullLink()), source: memorySource(makeSession()), env: ENV, now: BEFORE_START });
    expect(result.status).toBe("reused");
    expect(calls).toEqual([]);
  });

  it("reprise après un échec du vocal : le fil déjà créé n'est pas recréé", async () => {
    const store = memoryStore();
    const failing = fakeApi({ createVoiceChannel: vi.fn(async () => { throw new Error("discord_server_error"); }) });
    const first = await provisionSessionSpace({ sessionId: "s1", api: failing.api, store, source: memorySource(makeSession()), env: ENV, now: BEFORE_START });
    expect(first.status).toBe("failed");
    expect(store.row?.threadId).toBe("300000000000000001");
    expect(store.row?.voiceChannelId).toBeNull();

    const retry = fakeApi();
    const second = await provisionSessionSpace({ sessionId: "s1", api: retry.api, store, source: memorySource(makeSession()), env: ENV, now: BEFORE_START });
    expect(second.status).toBe("reused");
    expect(retry.api.createPrivateThread).not.toHaveBeenCalled();
    expect(retry.api.createVoiceChannel).toHaveBeenCalledOnce();
  });

  it("un espace déjà nettoyé n'est jamais recréé", async () => {
    const { api, calls } = fakeApi();
    const result = await provisionSessionSpace({ sessionId: "s1", api, store: memoryStore(fullLink({ cleanedAt: new Date() })), source: memorySource(makeSession()), env: ENV, now: BEFORE_START });
    expect(result.status).toBe("nothing_to_do");
    expect(calls).toEqual([]);
  });
});

describe("cleanupSessionSpace", () => {
  it("ne supprime rien tant que la soirée n'est pas finie", async () => {
    const { api, calls } = fakeApi();
    const result = await cleanupSessionSpace({ sessionId: "s1", api, store: memoryStore(fullLink()), source: memorySource(makeSession()), env: ENV, now: new Date(START.getTime() + 3_600_000) });
    expect(result.status).toBe("not_ended");
    expect(calls).toEqual([]);
  });

  it("retire les accès à la fin même si un participant reste dans le vocal, puis attend avant suppression", async () => {
    const { api, calls } = fakeApi({ memberVoiceChannel: vi.fn(async (_g: string, id: string) => (id === C ? "400000000000000001" : null)) });
    const store = memoryStore(fullLink());
    const result = await cleanupSessionSpace({ sessionId: "s1", api, store, source: memorySource(makeSession({ cleanupRoster: [A, B, C] })), env: ENV, now: AFTER_END });
    expect(result.status).toBe("occupied");
    expect(calls).toEqual([
      `thread-remove:${A}`, `voice-deny:${A}`, `thread-remove:${B}`, `voice-deny:${B}`, `thread-remove:${C}`, `voice-deny:${C}`,
    ]);
    expect(store.row?.cleanedAt).toBeNull();
  });

  it("un participant dans un AUTRE vocal ne bloque pas la suppression", async () => {
    const { api, calls } = fakeApi({ memberVoiceChannel: vi.fn(async () => "999999999999999999") });
    const result = await cleanupSessionSpace({ sessionId: "s1", api, store: memoryStore(fullLink()), source: memorySource(makeSession()), env: ENV, now: AFTER_END });
    expect(result.status).toBe("cleaned");
    expect(calls).toEqual([
      `thread-remove:${A}`, `voice-deny:${A}`, `thread-remove:${B}`, `voice-deny:${B}`,
      "delete:400000000000000001", "delete:300000000000000001",
    ]);
  });

  it("vocal vide après la fin : supprime vocal puis fil et marque l'espace nettoyé", async () => {
    const { api, calls } = fakeApi();
    const store = memoryStore(fullLink());
    const result = await cleanupSessionSpace({ sessionId: "s1", api, store, source: memorySource(makeSession()), env: ENV, now: AFTER_END });
    expect(result.status).toBe("cleaned");
    expect(calls).toEqual([
      `thread-remove:${A}`, `voice-deny:${A}`, `thread-remove:${B}`, `voice-deny:${B}`,
      "delete:400000000000000001", "delete:300000000000000001",
    ]);
    expect(store.row?.cleanedAt).toBeInstanceOf(Date);
    const replay = await cleanupSessionSpace({ sessionId: "s1", api, store, source: memorySource(makeSession()), env: ENV, now: AFTER_END });
    expect(replay.status).toBe("nothing_to_do");
  });

  it("une soirée annulée est nettoyée sans attendre la fin présumée", async () => {
    const { api } = fakeApi();
    const result = await cleanupSessionSpace({ sessionId: "s1", api, store: memoryStore(fullLink()), source: memorySource(makeSession({ status: "CANCELLED" })), env: ENV, now: BEFORE_START });
    expect(result.status).toBe("cleaned");
  });

  it("lecture de l'état vocal impossible : on ne supprime pas (échec rejouable)", async () => {
    const { api, calls } = fakeApi({ memberVoiceChannel: vi.fn(async () => { throw new Error("discord_server_error"); }) });
    const store = memoryStore(fullLink());
    const result = await cleanupSessionSpace({ sessionId: "s1", api, store, source: memorySource(makeSession()), env: ENV, now: AFTER_END });
    expect(result.status).toBe("failed");
    expect(calls).toEqual([`thread-remove:${A}`, `voice-deny:${A}`, `thread-remove:${B}`, `voice-deny:${B}`]);
    expect(store.row?.cleanedAt).toBeNull();
  });

  it("sans espace ou flag éteint : rien", async () => {
    const { api, calls } = fakeApi();
    expect((await cleanupSessionSpace({ sessionId: "s1", api, store: memoryStore(), source: memorySource(makeSession()), env: ENV, now: AFTER_END })).status).toBe("nothing_to_do");
    expect((await cleanupSessionSpace({ sessionId: "s1", api, store: memoryStore(fullLink()), source: memorySource(makeSession()), env: {}, now: AFTER_END })).status).toBe("disabled");
    expect(calls).toEqual([]);
  });
});

describe("syncSessionSpaceMember", () => {
  it("ajoute au fil et au vocal un participant actuel", async () => {
    const { api, calls } = fakeApi();
    const result = await syncSessionSpaceMember({ sessionId: "s1", discordId: B, api, store: memoryStore(fullLink()), source: memorySource(makeSession()), env: ENV });
    expect(result.status).toBe("updated");
    expect(calls).toEqual([`thread-add:${B}`, `voice-allow:${B}`]);
  });

  it("retire l'accès d'un ancien participant (état courant, pas l'état d'enqueue)", async () => {
    const { api, calls } = fakeApi();
    const outsider = "200000000000000009";
    await syncSessionSpaceMember({ sessionId: "s1", discordId: outsider, api, store: memoryStore(fullLink()), source: memorySource(makeSession()), env: ENV });
    expect(calls).toEqual([`thread-remove:${outsider}`, `voice-deny:${outsider}`]);
  });

  it("sans espace créé : aucun appel", async () => {
    const { api, calls } = fakeApi();
    const result = await syncSessionSpaceMember({ sessionId: "s1", discordId: A, api, store: memoryStore(), source: memorySource(makeSession()), env: ENV });
    expect(result.status).toBe("nothing_to_do");
    expect(calls).toEqual([]);
  });
});

describe("fromSessionSpaceStatus", () => {
  it("les états terminaux réussis et sans objet sont des succès", () => {
    for (const status of ["created", "reused", "updated", "cleaned", "nothing_to_do", "not_due", "too_small"]) {
      expect(fromSessionSpaceStatus(status).ok).toBe(true);
    }
  });
  it("occupé, pas fini et échec sont rejouables", () => {
    for (const status of ["occupied", "not_ended", "failed", "partial"]) {
      const result = fromSessionSpaceStatus(status);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.retryable).toBe(true);
    }
  });
  it("flag éteint et configuration absente sont définitifs", () => {
    for (const status of ["disabled", "not_configured", "not_found"]) {
      const result = fromSessionSpaceStatus(status);
      expect(!result.ok && result.retryable).toBe(false);
    }
  });
});
