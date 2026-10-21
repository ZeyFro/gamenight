import { describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => {
  const rows = () => ({ findMany: vi.fn(async () => []) });
  return { db: { user: rows(), weeklyAvailability: rows(), availabilityOverride: rows(), session: rows(), roulette: rows(), communityDate: rows(), gameWishlist: rows() } };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/community-scoped-client", () => ({ getActiveScopedPrisma: vi.fn(async () => db) }));
vi.mock("@/lib/community-isolation", () => ({ creationMemberUserWhere: vi.fn(async () => ({})), resolveActiveCommunityId: vi.fn(async () => "community") }));
vi.mock("@/lib/session-access", () => ({ accessibleSessionWhereFor: vi.fn(async () => ({})) }));

import { getCalendarData } from "./calendar";

describe("calendrier : repères Steam sans service externe", () => {
  it("répartit le début et la fin sur leurs jours, y compris après le nouvel an", async () => {
    const { days } = await getCalendarData(new Date("2026-12-17T00:00:00Z"), new Date("2027-01-05T00:00:00Z"), "viewer");
    const sales = days.flatMap((day) => day.communityDates.filter(({ kind }) => kind === "STEAM_SALE").map((event) => ({ day: day.date.toISOString(), event: event.date.toISOString() })));
    expect(sales).toEqual([
      { day: "2026-12-17T00:00:00.000Z", event: "2026-12-17T00:00:00.000Z" },
      { day: "2027-01-04T00:00:00.000Z", event: "2027-01-04T00:00:00.000Z" },
    ]);
  });
});
