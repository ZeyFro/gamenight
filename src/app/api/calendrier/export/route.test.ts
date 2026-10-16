import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-scoped-client", () => ({ getActiveScopedPrisma: vi.fn(async () => ({ session: { findMany: mocks.findMany } })) }));
vi.mock("@/lib/session-access", () => ({ accessibleSessionWhereFor: mocks.access }));
vi.mock("@/lib/wallclock", () => ({ wallClockNow: () => new Date("2026-01-01T12:00:00Z") }));

import { GET } from "./route";

describe("/api/calendrier/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "viewer" });
    mocks.access.mockResolvedValue({ OR: [{ createdById: "viewer" }, { invites: { some: { userId: "viewer", status: "ACTIVE" } } }] });
    mocks.findMany.mockResolvedValue([{ id: "session-1", date: new Date("2026-07-15T20:30:00Z"), status: "SCHEDULED", decidedGame: { name: "Game" } }]);
  });

  it("refuse l'export anonyme avant toute lecture", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await GET(new Request("https://gamenight.test/api/calendrier/export"));
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("limite la requête aux soirées futures accessibles et renvoie un ICS privé", async () => {
    const response = await GET(new Request("https://gamenight.test/api/calendrier/export"));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toContain("SUMMARY:Soirée GameNight — Game");
    expect(body).toContain("STATUS:CONFIRMED");
    expect(body).toContain("DTSTART;TZID=Europe/Paris:20260715T203000");
    expect(mocks.access).toHaveBeenCalledWith("viewer");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        date: { gte: new Date("2026-01-01T12:00:00Z") },
        status: { in: ["VOTING", "SCHEDULED"] },
        OR: expect.any(Array),
      }),
      select: { id: true, date: true, status: true, decidedGame: { select: { name: true } } },
    }));
  });
});
