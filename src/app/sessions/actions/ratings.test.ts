import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getSessionAccessRole, getScopedPrisma, checkRateLimit, sessionFindUnique, ratingUpsert, revalidatePath } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getSessionAccessRole: vi.fn(),
  getScopedPrisma: vi.fn(),
  checkRateLimit: vi.fn(),
  sessionFindUnique: vi.fn(),
  ratingUpsert: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/session-access", () => ({ getSessionAccessRole }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { rateSessionAction } from "./ratings";

function form(rating: string, sessionId = "s1") {
  const data = new FormData();
  data.set("sessionId", sessionId);
  data.set("rating", rating);
  return data;
}

describe("rateSessionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "u1" });
    checkRateLimit.mockReturnValue(true);
    getSessionAccessRole.mockResolvedValue("guest");
    sessionFindUnique.mockResolvedValue({ status: "DONE", communityId: "c1" });
    getScopedPrisma.mockResolvedValue({ session: { findUnique: sessionFindUnique }, sessionRating: { upsert: ratingUpsert } });
  });

  it("upserts one private rating for an authorized completed session", async () => {
    await rateSessionAction(form("4"));
    expect(ratingUpsert).toHaveBeenCalledWith({
      where: { sessionId_userId: { sessionId: "s1", userId: "u1" } },
      create: { sessionId: "s1", userId: "u1", communityId: "c1", rating: 4 },
      update: { rating: 4 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/sessions/s1");
  });

  it.each(["0", "6", "1.5", "NaN"])("rejects invalid rating %s", async (value) => {
    await rateSessionAction(form(value));
    expect(getSessionAccessRole).not.toHaveBeenCalled();
    expect(ratingUpsert).not.toHaveBeenCalled();
  });

  it("rejects users without session access and sessions that are not DONE", async () => {
    getSessionAccessRole.mockResolvedValueOnce(null);
    await rateSessionAction(form("5"));
    sessionFindUnique.mockResolvedValueOnce({ status: "SCHEDULED", communityId: "c1" });
    await rateSessionAction(form("5"));
    expect(ratingUpsert).not.toHaveBeenCalled();
  });
});
