import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  archiveProjectSpace,
  provisionProjectSpace,
  syncProjectSpaceMember,
  type ProjectSpaceApi,
  type ProjectSpacePatch,
  type ProjectSpacePort,
  type ProjectSpaceProject,
} from "./project-space-service";
import { fromProjectSpaceStatus } from "./project-space-runner";

const ENV = { PROJECT_ORGANIZER_ENABLED: "true" };
const A = "200000000000000001";
const B = "200000000000000002";
const CLOSED_AT = new Date("2026-11-10T12:00:00.000Z");
const DAY = 24 * 3_600_000;

function project(overrides: Partial<ProjectSpaceProject> = {}): ProjectSpaceProject {
  return {
    id: "p1", name: "Expédition", status: "OPEN", closedAt: null, communityId: "c1",
    destination: { guildId: "100000000000000001", channelId: "100000000000000002" },
    roster: [A, B], publicThreadId: null, privateThreadId: null, ...overrides,
  };
}

function memoryPort(initial: ProjectSpaceProject | null) {
  const port = {
    row: initial,
    async load() { return port.row ? { ...port.row } : null; },
    async save(_id: string, patch: ProjectSpacePatch) {
      if (!port.row) return;
      const { status, publicThreadId, privateThreadId } = patch;
      port.row = {
        ...port.row,
        ...(status ? { status } : {}),
        ...(publicThreadId ? { publicThreadId } : {}),
        ...(privateThreadId ? { privateThreadId } : {}),
      };
    },
  };
  return port satisfies ProjectSpacePort & { row: ProjectSpaceProject | null };
}

function fakeApi(overrides: Partial<ProjectSpaceApi> = {}) {
  const calls: string[] = [];
  const api: ProjectSpaceApi = {
    createPublicThread: vi.fn(async () => { calls.push("public"); return "300000000000000001"; }),
    createPrivateThread: vi.fn(async () => { calls.push("private"); return "300000000000000002"; }),
    addThreadMember: vi.fn(async (_t: string, id: string) => { calls.push(`add:${id}`); }),
    removeThreadMember: vi.fn(async (_t: string, id: string) => { calls.push(`remove:${id}`); }),
    archiveThread: vi.fn(async (id: string) => { calls.push(`archive:${id}`); }),
    ...overrides,
  };
  return { api, calls };
}

describe("provisionProjectSpace", () => {
  it("flag éteint : aucun chargement, aucun appel", async () => {
    const { api, calls } = fakeApi();
    const port = { load: vi.fn(), save: vi.fn() };
    expect((await provisionProjectSpace({ projectId: "p1", api, port, env: {} })).status).toBe("disabled");
    expect(port.load).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("crée le fil public, le fil privé, puis ajoute organisateur et participants au privé seulement", async () => {
    const { api, calls } = fakeApi();
    const port = memoryPort(project());
    const result = await provisionProjectSpace({ projectId: "p1", api, port, env: ENV });
    expect(result).toEqual({ status: "created", publicThreadId: "300000000000000001", privateThreadId: "300000000000000002" });
    expect(calls).toEqual(["public", "private", `add:${A}`, `add:${B}`]);
  });

  it("rejeu complet : aucun appel Discord", async () => {
    const { api, calls } = fakeApi();
    const port = memoryPort(project({ publicThreadId: "300000000000000001", privateThreadId: "300000000000000002" }));
    expect((await provisionProjectSpace({ projectId: "p1", api, port, env: ENV })).status).toBe("reused");
    expect(calls).toEqual([]);
  });

  it("reprise après échec du fil privé : le fil public n'est pas recréé", async () => {
    const port = memoryPort(project());
    const failing = fakeApi({ createPrivateThread: vi.fn(async () => { throw new Error("discord_server_error"); }) });
    expect((await provisionProjectSpace({ projectId: "p1", api: failing.api, port, env: ENV })).status).toBe("failed");
    expect(port.row?.publicThreadId).toBe("300000000000000001");
    const retry = fakeApi();
    expect((await provisionProjectSpace({ projectId: "p1", api: retry.api, port, env: ENV })).status).toBe("reused");
    expect(retry.api.createPublicThread).not.toHaveBeenCalled();
    expect(retry.api.createPrivateThread).toHaveBeenCalledOnce();
  });

  it("projet clos, sans salon configuré ou introuvable : rien", async () => {
    const { api, calls } = fakeApi();
    expect((await provisionProjectSpace({ projectId: "p1", api, port: memoryPort(project({ status: "CLOSED" })), env: ENV })).status).toBe("not_open");
    expect((await provisionProjectSpace({ projectId: "p1", api, port: memoryPort(project({ destination: null })), env: ENV })).status).toBe("not_configured");
    expect((await provisionProjectSpace({ projectId: "p1", api, port: memoryPort(null), env: ENV })).status).toBe("not_found");
    expect(calls).toEqual([]);
  });
});

describe("syncProjectSpaceMember", () => {
  const live = () => memoryPort(project({ publicThreadId: "300000000000000001", privateThreadId: "300000000000000002" }));
  it("ajoute un participant actuel, retire un ancien (état courant)", async () => {
    const { api, calls } = fakeApi();
    await syncProjectSpaceMember({ projectId: "p1", discordId: B, api, port: live(), env: ENV });
    await syncProjectSpaceMember({ projectId: "p1", discordId: "200000000000000009", api, port: live(), env: ENV });
    expect(calls).toEqual([`add:${B}`, "remove:200000000000000009"]);
  });
  it("sans fil privé ou projet archivé : aucun appel", async () => {
    const { api, calls } = fakeApi();
    await syncProjectSpaceMember({ projectId: "p1", discordId: A, api, port: memoryPort(project()), env: ENV });
    await syncProjectSpaceMember({ projectId: "p1", discordId: A, api, port: memoryPort(project({ status: "ARCHIVED", privateThreadId: "3" })), env: ENV });
    expect(calls).toEqual([]);
  });
});

describe("archiveProjectSpace", () => {
  const closed = () => memoryPort(project({ status: "CLOSED", closedAt: CLOSED_AT, publicThreadId: "300000000000000001", privateThreadId: "300000000000000002" }));

  it("n'archive pas avant 7 jours après la clôture", async () => {
    const { api, calls } = fakeApi();
    const result = await archiveProjectSpace({ projectId: "p1", api, port: closed(), env: ENV, now: new Date(CLOSED_AT.getTime() + 7 * DAY - 1) });
    expect(result.status).toBe("not_due");
    expect(calls).toEqual([]);
  });

  it("archive les deux fils à J+7 (jamais de suppression) et marque ARCHIVED, une seule fois", async () => {
    const { api, calls } = fakeApi();
    const port = closed();
    const now = new Date(CLOSED_AT.getTime() + 7 * DAY);
    expect((await archiveProjectSpace({ projectId: "p1", api, port, env: ENV, now })).status).toBe("archived");
    expect(calls).toEqual(["archive:300000000000000002", "archive:300000000000000001"]);
    expect(port.row?.status).toBe("ARCHIVED");
    expect((await archiveProjectSpace({ projectId: "p1", api, port, env: ENV, now })).status).toBe("nothing_to_do");
    expect(calls).toHaveLength(2);
  });

  it("un échec d'archivage laisse le projet CLOSED (rejouable)", async () => {
    const { api } = fakeApi({ archiveThread: vi.fn(async () => { throw new Error("discord_server_error"); }) });
    const port = closed();
    expect((await archiveProjectSpace({ projectId: "p1", api, port, env: ENV, now: new Date(CLOSED_AT.getTime() + 8 * DAY) })).status).toBe("failed");
    expect(port.row?.status).toBe("CLOSED");
  });
});

describe("fromProjectSpaceStatus", () => {
  it("succès, rejouable, définitif", () => {
    for (const status of ["created", "reused", "updated", "archived", "nothing_to_do", "not_open", "not_due"]) expect(fromProjectSpaceStatus(status).ok).toBe(true);
    const failed = fromProjectSpaceStatus("failed");
    expect(!failed.ok && failed.retryable).toBe(true);
    for (const status of ["disabled", "not_configured", "not_found"]) {
      const result = fromProjectSpaceStatus(status);
      expect(!result.ok && result.retryable).toBe(false);
    }
  });
});
