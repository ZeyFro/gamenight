import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveActiveCommunityId, membershipFindFirst, scopedPrisma, updateMany } = vi.hoisted(() => ({
  resolveActiveCommunityId: vi.fn(),
  membershipFindFirst: vi.fn(),
  scopedPrisma: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId }));
vi.mock("@/lib/prisma", () => ({ prisma: { membership: { findFirst: membershipFindFirst } } }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma }));
vi.mock("@/lib/session-access", () => ({ accessibleSessionWhere: vi.fn() }));
vi.mock("@/lib/wallclock", () => ({ wallClockNow: vi.fn() }));
vi.mock("@/lib/ical-calendar", () => ({ buildIcalCalendar: vi.fn() }));

import { createCalendarFeedToken, isCalendarFeedEnabled, readCalendarFeed, revokeCalendarFeedToken } from "./calendar-feed";

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

  it("rejette un bearer malformé avant toute lecture de données", async () => {
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "true");
    for (const token of ["", "short", "A".repeat(44), "/".repeat(43)]) {
      expect(await readCalendarFeed(token, "https://gamenight.test")).toBeNull();
    }
  });
});
