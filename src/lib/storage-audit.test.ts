import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-10-04T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const mockDb = vi.hoisted(() => ({
  notification: { count: vi.fn() },
  notificationDelivery: { count: vi.fn(), groupBy: vi.fn() },
  chatMessage: { count: vi.fn() },
  session: { count: vi.fn(), findMany: vi.fn() },
  tournament: { count: vi.fn(), findMany: vi.fn() },
  instantSession: { count: vi.fn(), findMany: vi.fn() },
  sessionResult: { count: vi.fn() },
  proposal: { count: vi.fn() },
  vote: { count: vi.fn() },
  tournamentMatch: { count: vi.fn() },
  xpEvent: { count: vi.fn() },
  levelUpEvent: { count: vi.fn() },
  seasonSnapshot: { count: vi.fn() },
  userBadge: { count: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockDb }));
vi.mock("@/lib/wallclock", () => ({ wallClockNow: () => NOW }));
vi.mock("@/lib/seasons", () => ({ getActiveSeason: vi.fn().mockResolvedValue(null) }));

import { generateStorageAuditReport } from "./storage-audit";

beforeEach(() => {
  for (const model of Object.values(mockDb)) {
    for (const [name, fn] of Object.entries(model)) {
      fn.mockReset();
      if (name === "count") fn.mockResolvedValue(0);
      else fn.mockResolvedValue([]);
    }
  }
});

describe("generateStorageAuditReport", () => {
  it("rend un rapport à zéro sur une base vide, sans cycle de saison", async () => {
    const report = await generateStorageAuditReport();
    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.notifications).toEqual({ total: 0, read: 0, eligibleForPurge: null, seasonCycleAvailable: false });
    expect(report.notificationDelivery).toEqual({ total: 0, byStatus: {}, terminalRetrySafe: 0 });
    expect(report.sessions.eligibleForPurge).toBe(0);
    expect(report.instantSessions.eligibleForPurge).toBe(0);
  });

  it("agrège les livraisons par statut", async () => {
    mockDb.notificationDelivery.groupBy.mockResolvedValue([
      { status: "SENT", _count: { _all: 3 } },
      { status: "FAILED", _count: { _all: 1 } },
    ]);
    const report = await generateStorageAuditReport();
    expect(report.notificationDelivery.byStatus).toEqual({ SENT: 3, FAILED: 1 });
  });

  it("ne compte que les tournois et sessions instantanées terminés hors fenêtre de rétention", async () => {
    mockDb.tournament.findMany.mockResolvedValue([
      { status: "CANCELLED", cancelledAt: new Date(NOW.getTime() - 400 * DAY), matches: [] },
      { status: "CANCELLED", cancelledAt: new Date(NOW.getTime() - 1 * DAY), matches: [] },
      { status: "CANCELLED", cancelledAt: null, matches: [] },
    ]);
    mockDb.instantSession.findMany.mockResolvedValue([
      { status: "ENDED", endedAt: new Date(NOW.getTime() - 400 * DAY) },
      { status: "ENDED", endedAt: new Date(NOW.getTime() - 1 * DAY) },
      { status: "ENDED", endedAt: null },
    ]);
    const report = await generateStorageAuditReport();
    expect(report.tournaments).toMatchObject({ eligibleForPurge: 1, noReliableDate: 1 });
    expect(report.instantSessions).toMatchObject({ eligibleForPurge: 1, noReliableDate: 1 });
  });
});
