import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  delivery: { count: vi.fn(), findMany: vi.fn() },
  event: vi.fn(),
  scoped: {
    teamApplication: { count: vi.fn() },
    towerChallengeAppeal: { count: vi.fn() },
    discordTeamSpace: { findMany: vi.fn() },
  },
  listRoles: vi.fn(),
  listChannels: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { community: { findMany: mocks.community }, notificationDelivery: mocks.delivery, notificationEvent: { count: mocks.event } },
}));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: () => mocks.scoped }));
vi.mock("@/lib/discord-rest", () => ({ listGuildRoles: mocks.listRoles, listSetupChannels: mocks.listChannels }));

import { adminDashboardV2Enabled, capacityOf, loadAdminDashboardV2, readDiscordCounts } from "./admin-dashboard-v2";

const NOW = new Date("2026-11-19T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.community.mockResolvedValue([{ id: "c1", name: "The Tower", slug: "tower", discordGuildId: "100000000000000001" }]);
  mocks.scoped.teamApplication.count.mockResolvedValue(3);
  mocks.scoped.towerChallengeAppeal.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
  mocks.scoped.discordTeamSpace.findMany.mockResolvedValue([{ updatedAt: new Date("2026-11-10T10:00:00Z"), team: { name: "Les Dragons" } }]);
  mocks.delivery.count.mockResolvedValue(4);
  mocks.delivery.findMany.mockResolvedValue([{ errorClass: "auth_or_permission", attempts: 5, createdAt: NOW, event: { eventType: "TEAM_SPACE_SYNC", communityId: "c1" } }]);
  mocks.event.mockResolvedValue(2);
  vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
});
afterEach(() => vi.unstubAllEnvs());

describe("capacityOf", () => {
  it("alerte à 80 % des limites Discord, plein à la limite, indisponible sans lecture", () => {
    expect(capacityOf(199, 250).level).toBe("ok");
    expect(capacityOf(200, 250).level).toBe("alert");
    expect(capacityOf(250, 250).level).toBe("full");
    expect(capacityOf(399, 500).level).toBe("ok");
    expect(capacityOf(400, 500).level).toBe("alert");
    expect(capacityOf(null, 250)).toEqual({ count: null, limit: 250, level: "unavailable" });
  });
});

describe("loadAdminDashboardV2", () => {
  it("agrège candidatures, contestations, espaces archivés, échecs et capacités", async () => {
    const result = await loadAdminDashboardV2({ now: NOW, discordCounts: async () => ({ roles: 210, channels: 120 }) });
    expect(result.communities[0]).toMatchObject({
      name: "The Tower",
      pendingApplications: 3,
      openAppeals: 2,
      overdueAppeals: 1,
      failedOperations: 4,
      archivedSpaces: [{ teamName: "Les Dragons" }],
      roles: { count: 210, limit: 250, level: "alert" },
      channels: { count: 120, limit: 500, level: "ok" },
    });
    expect(result.failedOperations).toEqual([
      expect.objectContaining({ communityName: "The Tower", eventType: "TEAM_SPACE_SYNC", errorClass: "auth_or_permission", attempts: 5 }),
    ]);
    expect(result.totals).toEqual({ pendingApplications: 3, openAppeals: 2, overdueAppeals: 1, archivedSpaces: 1, failedOperations: 4 });
    expect(result.roleCapacityAlerts).toBe(2);
  });

  it("n'expose ni identifiant de destinataire, ni contenu, ni secret", async () => {
    const json = JSON.stringify(await loadAdminDashboardV2({ now: NOW, discordCounts: async () => ({ roles: 1, channels: 1 }) }));
    expect(json).not.toContain("faux-jeton");
    expect(json).not.toMatch(/recipientKey|payload|targetSlot|discordGuildId/);
  });

  it("Discord indisponible : capacités « indisponible », jamais zéro ; sans jeton, aucun appel", async () => {
    const down = await loadAdminDashboardV2({ now: NOW, discordCounts: async () => Promise.reject(new Error("réseau")) });
    expect(down.communities[0].roles.level).toBe("unavailable");
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    const reader = vi.fn();
    mocks.scoped.towerChallengeAppeal.count.mockResolvedValue(0);
    const noToken = await loadAdminDashboardV2({ now: NOW, discordCounts: reader });
    expect(reader).not.toHaveBeenCalled();
    expect(noToken.communities[0].channels.level).toBe("unavailable");
  });

  it("lit seulement : aucune méthode d'écriture n'est appelée sur la base", async () => {
    await loadAdminDashboardV2({ now: NOW, discordCounts: async () => ({ roles: 1, channels: 1 }) });
    for (const mock of [mocks.delivery, mocks.scoped.teamApplication, mocks.scoped.towerChallengeAppeal, mocks.scoped.discordTeamSpace]) {
      expect(Object.keys(mock).filter((key) => /create|update|delete|upsert/.test(key))).toEqual([]);
    }
  });
});

describe("readDiscordCounts", () => {
  it("compte rôles et salons ; une lecture en échec donne null", async () => {
    mocks.listRoles.mockResolvedValue({ ok: true, data: { roles: [{}, {}, {}] } });
    mocks.listChannels.mockResolvedValue({ ok: false, kind: "auth_or_permission", message: "x", retryable: false });
    expect(await readDiscordCounts("100000000000000001")).toEqual({ roles: 3, channels: null });
  });
});

describe("garde statique : lecture seule", () => {
  it("le module et la page n'écrivent rien (base, Discord, action serveur)", () => {
    for (const file of ["./admin-dashboard-v2.ts", "../app/admin/tableau-de-bord/page.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
      expect(source, file).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
      expect(source, file).not.toMatch(/["']use server["']|createGuildRole|createSetupChannel|addGuildMemberRole|removeGuildMemberRole|sendChannelMessage|enqueueDelivery|createNotificationEvent/);
    }
  });
});

describe("drapeau", () => {
  it("OFF sans la valeur exacte `true`", () => {
    expect(adminDashboardV2Enabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(adminDashboardV2Enabled({ ADMIN_DASHBOARD_V2_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(adminDashboardV2Enabled({ ADMIN_DASHBOARD_V2_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
