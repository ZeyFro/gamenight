import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveActiveCommunityId, membershipFindFirst, userFindFirst, scopedPrisma, updateMany, sessionFindMany } = vi.hoisted(() => ({
  resolveActiveCommunityId: vi.fn(),
  membershipFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  scopedPrisma: vi.fn(),
  updateMany: vi.fn(),
  sessionFindMany: vi.fn(),
}));

vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId }));
vi.mock("@/lib/prisma", () => ({ prisma: { membership: { findFirst: membershipFindFirst }, user: { findFirst: userFindFirst } } }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma }));
vi.mock("@/lib/session-access", () => ({ accessibleSessionWhere: vi.fn() }));
vi.mock("@/lib/wallclock", () => ({ wallClockNow: vi.fn() }));
vi.mock("@/lib/ical-calendar", () => ({ buildIcalCalendar: vi.fn() }));

import { createCalendarFeedToken, isCalendarFeedEnabled, readCalendarFeed, revokeCalendarFeedToken } from "./calendar-feed";
import { accessibleSessionWhere } from "@/lib/session-access";
import { wallClockNow } from "@/lib/wallclock";
import { buildIcalCalendar } from "@/lib/ical-calendar";

describe("calendar feed configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("is enabled only by the exact true value", () => {
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "true");
    expect(isCalendarFeedEnabled()).toBe(true);
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "TRUE");
    expect(isCalendarFeedEnabled()).toBe(false);
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "1");
    expect(isCalendarFeedEnabled()).toBe(false);
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "");
    expect(isCalendarFeedEnabled()).toBe(false);
  });

  it("treats revocation as successful when the current member has no active token", async () => {
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "true");
    resolveActiveCommunityId.mockResolvedValue("community");
    membershipFindFirst.mockResolvedValue({ community: { id: "community", name: "Serveur", slug: "default" } });
    updateMany.mockResolvedValue({ count: 0 });
    scopedPrisma.mockReturnValue({ calendarFeedToken: { updateMany } });

    await expect(revokeCalendarFeedToken("owner")).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("does not revoke when subscriptions are disabled", async () => {
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "false");

    await expect(revokeCalendarFeedToken("owner")).resolves.toBe(false);
    expect(resolveActiveCommunityId).not.toHaveBeenCalled();
  });

  it("ne lit ni n’émet de jeton lorsque le flag est éteint", async () => {
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "false");
    expect(await createCalendarFeedToken("owner")).toBeNull();
    expect(await readCalendarFeed("A".repeat(43), "https://gamenight.test")).toBeNull();
    expect(resolveActiveCommunityId).not.toHaveBeenCalled();
  });

  it("ne demande que les soirées futures encore actives, jamais une date passée ni une annulation (C042)", async () => {
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "true");
    const now = new Date("2026-11-26T10:00:00Z");
    vi.mocked(wallClockNow).mockReturnValue(now);
    vi.mocked(accessibleSessionWhere).mockReturnValue({ OR: [] });
    vi.mocked(buildIcalCalendar).mockReturnValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    userFindFirst.mockResolvedValue({
      id: "owner",
      calendarFeedTokens: [{ community: { id: "community", name: "Serveur", slug: "default", status: "ACTIVE" } }],
    });
    membershipFindFirst.mockResolvedValue({ id: "membership" });
    sessionFindMany.mockResolvedValue([]);
    scopedPrisma.mockReturnValue({ session: { findMany: sessionFindMany } });

    await expect(readCalendarFeed("A".repeat(43), "https://gamenight.test")).resolves.toContain("BEGIN:VCALENDAR");

    // C'est la requête, et elle seule, qui écarte les soirées passées et annulées :
    // le flux ne post-filtre aucune ligne. Une date passée ou un statut CANCELLED/DONE
    // ajouté ici réapparaîtrait dans l'ICS.
    const query = sessionFindMany.mock.calls[0][0];
    expect(query.where.AND).toContainEqual({ date: { gte: now }, status: { in: ["VOTING", "SCHEDULED"] } });
    expect(query.orderBy).toEqual({ date: "asc" });
    expect(accessibleSessionWhere).toHaveBeenCalledWith("owner", { communityIds: ["community"], includesDefault: true });
  });

  it("rejette un bearer malformé avant toute lecture de données", async () => {
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "true");
    for (const token of ["", "short", "A".repeat(44), "/".repeat(43)]) {
      expect(await readCalendarFeed(token, "https://gamenight.test")).toBeNull();
    }
  });
});
